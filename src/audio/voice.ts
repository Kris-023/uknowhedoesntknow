import * as THREE from 'three';
import { VOICE } from '../config';
import type { Transport } from '../net/transport';
import { onSettings, settings } from '../ui/store';

/** Mic RMS -> mouth level 0..1, gated so room noise keeps the mouth shut. */
export function rmsToLevel(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db - VOICE.gateDb) / (VOICE.fullDb - VOICE.gateDb)));
}

/**
 * How a voice sounds at distance `d`: close voices are dry and bright; walking away makes them
 * duller and more echoey, so someone leaving audibly "disappears" instead of just getting quieter.
 */
export function distanceMix(d: number): { lowpassHz: number; wet: number } {
  const x = Math.max(0, Math.min(1, (d - VOICE.nearM) / (VOICE.farM - VOICE.nearM)));
  const k = x * x * (3 - 2 * x);
  // Exponential sweep: equal steps in pitch perception, not in Hz.
  const lowpassHz = VOICE.lowpassNearHz * (VOICE.lowpassFarHz / VOICE.lowpassNearHz) ** k;
  return { lowpassHz, wet: VOICE.wetNear + (VOICE.wetFar - VOICE.wetNear) * k };
}

/**
 * One step of voice activation: open at the threshold, stay open until `hangMs` after the last loud
 * moment. Returns the new state and when it was last loud.
 */
export function gateStep(open: boolean, level: number, threshold: number, now: number, lastLoud: number, hangMs: number): { open: boolean; lastLoud: number } {
  const loud = level >= threshold;
  const last = loud ? now : lastLoud;
  return { open: loud || (open && now - last < hangMs), lastLoud: last };
}

export type MicState = 'off' | 'starting' | 'on' | 'blocked' | 'missing' | 'error';

interface Peer {
  stream: MediaStream;
  el: HTMLAudioElement;
  src: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  vol: GainNode;
  lowpass: BiquadFilterNode;
  panner: PannerNode;
  send: GainNode;
}

/** Decaying stereo noise: a cheap, convincing room echo without an audio file. */
function impulse(ctx: AudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * VOICE.reverbS);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** VOICE.reverbDecay;
  }
  return buf;
}

const rmsOf = (a: AnalyserNode, buf: Float32Array<ArrayBuffer>): number => {
  a.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
};

/**
 * Voice chat: own microphone into the WebRTC mesh, every remote voice through a panner at that
 * player's head. The mouth levels come from the audio itself (own mic, received streams), so
 * they need no network messages.
 */
export class Voice {
  readonly ctx = new AudioContext();
  private master: GainNode;
  private reverb: ConvolverNode;
  private outEl = new Audio();
  /** raw: the device stream; send: after our gain, this is what peers get. */
  private mic: { raw: MediaStream; send: MediaStream; gain: GainNode; delay: DelayNode; analyser: AnalyserNode } | null = null;
  /** Voice activation state (only used in 'auto' mode). */
  private gateOpen = false;
  private lastLoud = 0;
  private gateTimer = 0;
  private buf = new Float32Array(512);
  private peers = new Map<string, Peer>();
  private volumes = new Map<string, number>();
  private net: Transport | null = null;
  private listeners = new Set<() => void>();
  micState: MicState = 'off';
  muted = false;
  pttHeld = false;

  constructor() {
    this.master = this.ctx.createGain();
    this.master.gain.value = settings.voiceVolume;
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = impulse(this.ctx);
    this.reverb.connect(this.master);
    // Output through a media element instead of ctx.destination: Chrome's echo cancellation only
    // knows audio played that way, so without headphones the voices don't loop back into the mic.
    const out = this.ctx.createMediaStreamDestination();
    this.master.connect(out);
    this.outEl.srcObject = out.stream;

    let last = { ...settings };
    onSettings(() => {
      const s = settings;
      this.master.gain.setTargetAtTime(s.voiceVolume, this.ctx.currentTime, 0.05);
      this.mic?.gain.gain.setTargetAtTime(s.micGain, this.ctx.currentTime, 0.05);
      if (s.micOn !== last.micOn || (s.micOn && s.micDevice !== last.micDevice)) {
        if (s.micOn) void this.startMic();
        else this.stopMic();
      }
      if (s.voiceMode !== last.voiceMode) {
        this.applyLookahead();
        this.applyTransmit();
      }
      last = { ...s };
    });
  }

  /** Must run inside a click or key press: browsers only start audio after a user gesture. */
  resume(): void {
    void this.ctx.resume();
    void this.outEl.play().catch(() => {});
  }

  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }

  /** Join a room's media: send our mic to everyone, now and to later joiners; play what arrives. */
  bind(net: Transport): void {
    this.net = net;
    net.onStream?.((stream, from) => this.addPeer(from, stream));
    net.onJoin((id) => {
      if (this.mic) net.addStream?.(this.mic.send, id);
    });
    net.onLeave((id) => this.removePeer(id));
  }

  async startMic(): Promise<void> {
    if (this.micState === 'starting') return;
    this.stopMic();
    this.micState = 'starting';
    this.emit();
    const audio = (deviceId?: string): MediaTrackConstraints => ({
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audio(settings.micDevice || undefined) });
      } catch (e) {
        // A remembered device that's gone (unplugged headset): fall back to the default one.
        if (!settings.micDevice || (e as DOMException).name !== 'OverconstrainedError') throw e;
        stream = await navigator.mediaDevices.getUserMedia({ audio: audio() });
      }
      if (!settings.micOn) {
        stream.getTracks().forEach((t) => t.stop());
        this.micState = 'off';
        this.emit();
        return;
      }
      // Mic -> gain -> (analyser, outgoing stream). The gain is the player's mic volume, so the test
      // meter shows exactly what the others will get. Never played back locally (no self-echo).
      const gain = new GainNode(this.ctx, { gain: settings.micGain });
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 512;
      const dest = this.ctx.createMediaStreamDestination();
      // Only the sent audio is delayed (for voice activation); the analyser sees it live.
      const delay = new DelayNode(this.ctx, { maxDelayTime: 0.2 });
      this.ctx.createMediaStreamSource(stream).connect(gain);
      gain.connect(analyser);
      gain.connect(delay).connect(dest);
      this.mic = { raw: stream, send: dest.stream, gain, delay, analyser };
      this.micState = 'on';
      this.applyLookahead();
      this.applyTransmit();
      // Own timer instead of the render loop: the gate must keep working in a background tab.
      clearInterval(this.gateTimer);
      this.gateTimer = window.setInterval(() => this.gate(), VOICE.vadPollMs);
      this.net?.addStream?.(dest.stream);
    } catch (e) {
      const name = (e as DOMException).name;
      this.micState = name === 'NotAllowedError' || name === 'SecurityError' ? 'blocked' : name === 'NotFoundError' ? 'missing' : 'error';
    }
    this.emit();
  }

  stopMic(): void {
    clearInterval(this.gateTimer);
    this.gateOpen = false;
    if (this.mic) {
      this.net?.removeStream?.(this.mic.send);
      this.mic.raw.getTracks().forEach((t) => t.stop());
      this.mic.gain.disconnect();
      this.mic = null;
    }
    if (this.micState !== 'starting') this.micState = 'off';
    this.emit();
  }

  /** Whether our voice goes out right now: not muted, and per mode always / above the threshold / key held. */
  get transmitting(): boolean {
    if (!this.mic || this.muted) return false;
    if (settings.voiceMode === 'auto') return this.gateOpen;
    return settings.voiceMode === 'open' || this.pttHeld;
  }

  /** Voice activation is open right now (for the meter and the HUD). */
  get gateIsOpen(): boolean {
    return this.gateOpen;
  }

  private gate(): void {
    if (!this.mic || settings.voiceMode !== 'auto') {
      this.gateOpen = false;
      return;
    }
    const level = rmsToLevel(rmsOf(this.mic.analyser, this.buf));
    const { open, lastLoud } = gateStep(this.gateOpen, level, settings.vadLevel, performance.now(), this.lastLoud, VOICE.vadHangMs);
    this.lastLoud = lastLoud;
    if (open !== this.gateOpen) {
      this.gateOpen = open;
      this.applyTransmit();
    }
  }

  private applyLookahead(): void {
    this.mic?.delay.delayTime.setValueAtTime(settings.voiceMode === 'auto' ? VOICE.vadLookaheadS : 0, this.ctx.currentTime);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyTransmit();
  }

  setPtt(held: boolean): void {
    if (this.pttHeld === held) return;
    this.pttHeld = held;
    this.applyTransmit();
  }

  /** A disabled track sends silence; the connection stays up, so unmuting is instant. */
  private applyTransmit(): void {
    const on = this.transmitting;
    this.mic?.send.getAudioTracks().forEach((t) => (t.enabled = on));
    this.emit();
  }

  /** Own mouth level; also feeds the mic test meter (`raw` ignores mute and push-to-talk). */
  micLevel(raw = false): number {
    if (!this.mic || (!raw && !this.transmitting)) return 0;
    return rmsToLevel(rmsOf(this.mic.analyser, this.buf));
  }

  /** Short two-tone chime at voice volume, to set the output level without anyone else in the room. */
  testTone(): void {
    this.resume();
    const t = this.ctx.currentTime + 0.02;
    [660, 880].forEach((f, i) => {
      const o = new OscillatorNode(this.ctx, { type: 'sine', frequency: f });
      const g = new GainNode(this.ctx, { gain: 0 });
      const t0 = t + i * 0.18;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
      o.connect(g).connect(this.master);
      o.start(t0);
      o.stop(t0 + 0.55);
    });
  }

  peerLevel(id: string): number {
    const p = this.peers.get(id);
    return p ? rmsToLevel(rmsOf(p.analyser, this.buf)) : 0;
  }

  hasPeer(id: string): boolean {
    return this.peers.has(id);
  }

  volumeOf(id: string): number {
    return this.volumes.get(id) ?? 1;
  }

  setVolume(id: string, v: number): void {
    this.volumes.set(id, v);
    const p = this.peers.get(id);
    if (p) p.vol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private addPeer(id: string, stream: MediaStream): void {
    this.removePeer(id);
    const ctx = this.ctx;
    // Chrome only feeds a remote WebRTC stream into Web Audio while a media element consumes it.
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const vol = new GainNode(ctx, { gain: this.volumeOf(id) });
    const lowpass = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: VOICE.lowpassNearHz, Q: 0.5 });
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: VOICE.refDistance,
      rolloffFactor: VOICE.rolloff,
    });
    const send = new GainNode(ctx, { gain: VOICE.wetNear });
    src.connect(analyser);
    src.connect(vol).connect(lowpass).connect(panner).connect(this.master);
    panner.connect(send).connect(this.reverb);
    this.peers.set(id, { stream, el, src, analyser, vol, lowpass, panner, send });
    this.emit();
  }

  private removePeer(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.src.disconnect();
    p.panner.disconnect();
    p.send.disconnect();
    p.el.srcObject = null;
    this.peers.delete(id);
    this.emit();
  }

  /**
   * Per frame: the listener sits at the camera (= your head in POV), each voice at its player's
   * head. Unknown positions (no seat yet) stay at the listener, i.e. unpositioned.
   */
  update(listener: THREE.Object3D, posOf: (id: string) => THREE.Vector3 | null): void {
    if (this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const L = this.ctx.listener;
    const lp = listener.getWorldPosition(tmpA);
    const fwd = listener.getWorldDirection(tmpB);
    const up = tmpC.set(0, 1, 0).applyQuaternion(listener.getWorldQuaternion(tmpQ));
    if (L.positionX) {
      L.positionX.setTargetAtTime(lp.x, t, 0.02);
      L.positionY.setTargetAtTime(lp.y, t, 0.02);
      L.positionZ.setTargetAtTime(lp.z, t, 0.02);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.02);
      L.forwardY.setTargetAtTime(fwd.y, t, 0.02);
      L.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      L.upX.setTargetAtTime(up.x, t, 0.02);
      L.upY.setTargetAtTime(up.y, t, 0.02);
      L.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      L.setPosition(lp.x, lp.y, lp.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    for (const [id, p] of this.peers) {
      const pos = posOf(id) ?? lp;
      p.panner.positionX.setTargetAtTime(pos.x, t, 0.02);
      p.panner.positionY.setTargetAtTime(pos.y, t, 0.02);
      p.panner.positionZ.setTargetAtTime(pos.z, t, 0.02);
      const mix = distanceMix(pos.distanceTo(lp));
      p.lowpass.frequency.setTargetAtTime(mix.lowpassHz, t, 0.1);
      p.send.gain.setTargetAtTime(mix.wet, t, 0.1);
    }
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

let instance: Voice | null = null;

/** The voice engine is created on the first user gesture that needs it (menu click). */
export function getVoice(create = false): Voice | null {
  if (!instance && create && typeof AudioContext !== 'undefined') {
    instance = new Voice();
    // Hook for Playwright checks; not shipped in the production bundle.
    if (import.meta.env.DEV) Object.assign(window, { __voice: instance });
  }
  return instance;
}
