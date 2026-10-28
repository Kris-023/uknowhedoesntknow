import * as THREE from 'three';
import { getVoice, type Voice } from './audio/voice';
import type { PersonState } from './characters/person';
import { CAMERA, HEAD, LIGHT_PRESETS, LIGHTS, NET, VOICE } from './config';
import { SharedClock } from './core/clock';
import { DebugPanel } from './debug/panel';
import { sceneTree } from './debug/sceneTree';
import { setSightMode } from './debug/sight';
import { randomState } from './game/players';
import { parseName, trainDistance } from './net/protocol';
import { Session } from './net/session';
import { trysteroTransport } from './net/trystero';
import { Pipeline } from './render/pipeline';
import { World } from './scene/world';
import { el } from './ui/dom';
import { BenchPanel } from './ui/benchPanel';
import { MainMenu, PauseMenu } from './ui/menu';
import { MicHud } from './ui/micHud';
import { NameTags } from './ui/nametags';
import { initUiScale } from './ui/scale';
import { loadProfile, onSettings, saveProfile, settings } from './ui/store';
import './style.css';

// The prototype's palette was tuned on r128, where hex colours went into the shader unconverted.
// Turning colour management off keeps those hex values looking the same; textures still decode sRGB.
THREE.ColorManagement.enabled = false;

const stage = document.getElementById('stage')!;
const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
/** Debug panel only for development, or on request with ?debug. */
const debug = import.meta.env.DEV || params.has('debug');

const saved = loadProfile();
let profile: PersonState = saved ?? { ...randomState(Math.random), name: '' };
const setProfile = (p: PersonState) => {
  profile = p;
  if (parseName(p.name)) saveProfile(p);
};

initUiScale();

const applyLight = () => Object.assign(LIGHTS, LIGHT_PRESETS[settings.light]);
applyLight();
onSettings(applyLight);

void start();

/**
 * Menu first: a joiner only learns seed and start time from the host's welcome, and the whole
 * world (tunnel, flicker, fake peers) is built from that seed.
 */
async function start(): Promise<void> {
  document.getElementById('boot')?.remove();
  // ?seed=… skips the menu: deterministic solo scene for screenshots and debugging.
  if (seedParam) {
    launch(new SharedClock(+seedParam | 0, performance.timeOrigin + performance.now()), null, 'wagon');
    return;
  }
  const menu = new MainMenu(document.body, profile, setProfile);
  const choice = await menu.choose();
  saveProfile(profile);
  // Still within the click's user activation: audio may start and the mic may be asked for now.
  const voice = getVoice(true);
  voice?.resume();
  if (voice && settings.micOn && voice.micState !== 'on') void voice.startMic();
  const clock = SharedClock.local();
  if (choice.kind === 'bench') {
    menu.close();
    launch(clock, null, 'pov', '', voice, true);
    return;
  }
  const { code } = choice;
  history.replaceState(null, '', `#${code}`);
  const net = trysteroTransport(code, (msg) => console.warn('Trystero:', msg));
  voice?.bind(net);
  const session = new Session(net, clock, choice.kind === 'create', profile);
  addEventListener('pagehide', () => session.leave());
  // Pings and hello retries keep running while the tab is in the background.
  setInterval(() => session.tick(), 50);

  const go = () => {
    menu.close();
    launch(clock, session, 'pov', code, voice);
  };
  if (session.welcomed) go();
  else {
    menu.connecting(code, () => session.takeOver());
    session.listen({
      welcome: go,
      status: (s) => {
        if (s === 'full' && !session.welcomed) menu.message(`Der Raum ist voll (${NET.maxPlayers} von ${NET.maxPlayers}).`);
      },
    });
  }
}

function launch(clock: SharedClock, session: Session | null, startCam: 'wagon' | 'pov', code = '', voice: Voice | null = null, bench = false): void {
  const world = new World(clock);
  const players = world.players;

  let pipeline: Pipeline | null = null;
  try {
    pipeline = new Pipeline(stage, world.scene, world.camera);
  } catch {
    const msg = document.createElement('div');
    msg.className = 'nogl';
    msg.textContent = 'WebGL ist in diesem Browser nicht verfügbar. uKnowHeDoesntKnow braucht WebGL 2.';
    stage.prepend(msg);
  }

  const hint = el('div', 'hint-bar');
  hint.setAttribute('role', 'status');
  document.body.append(hint);

  const panel = new DebugPanel(
    document.body,
    players,
    {
      onSight: (on) => {
        setSightMode(world.scene, on);
        applyBloom();
      },
      onCam: (cam) => {
        world.cam = cam;
        players.instant = cam === 'pov';
        stage.classList.toggle('look', cam === 'pov');
        syncHint();
        if (cam !== 'pov' && document.pointerLockElement) document.exitPointerLock();
      },
      onBlackout: () => {
        if (session) session.triggerBlackout(clock.now());
        else world.forcedBlackoutAt = clock.now();
      },
      onLocalChange: () => {
        if (!players.isLocal(players.active)) return;
        session?.setState(players.me.state());
      },
      tree: () => sceneTree(world.scene),
    },
    debug,
  );
  const applyBloom = () => {
    if (!pipeline) return;
    pipeline.bloomOn = settings.bloom && !panel.state.sight;
    pipeline.bloomStrength = settings.bloomStrength;
    pipeline.setRenderScale(settings.renderScale);
  };
  applyBloom();
  onSettings(applyBloom);

  // Your own character: the menu profile goes onto your seat (in a room it came with the hello).
  if (!session) players.applyState(players.active, profile);
  const pause = new PauseMenu(
    document.body,
    profile,
    (p) => {
      setProfile(p);
      players.applyState(players.active, p);
      session?.setState(p);
    },
    bench,
  );
  const toMenu = () => {
    history.replaceState(null, '', location.pathname + location.search);
    location.reload();
  };
  const benchPanel = bench ? new BenchPanel(document.body, toMenu) : null;
  if (bench) document.body.classList.add('benching');
  const tags = new NameTags(document.body, players, world.camera, stage);
  const micHud = voice ? new MicHud(document.body, voice) : null;

  // Voice levels: measured once per frame, read by mouths and name tags.
  const levels = [0, 0, 0, 0];
  const seatIds: (string | null)[] = [null, null, null, null];
  const idToSeat = new Map<string, number>();
  const refreshSeats = () => {
    seatIds.fill(null);
    idToSeat.clear();
    for (const e of session?.roster.values() ?? []) {
      seatIds[e.seat] = e.id;
      idToSeat.set(e.id, e.seat);
    }
  };
  const measureVoices = () => {
    for (let i = 0; i < levels.length; i++) {
      const id = seatIds[i];
      if (i === players.active) levels[i] = voice?.micState === 'on' ? voice.micLevel() : -1;
      else levels[i] = voice && id && voice.hasPeer(id) ? voice.peerLevel(id) : -1;
    }
  };
  // -1 = no real voice on that seat: solo fake peers keep their scripted mouths.
  players.voiceLevel = (seat) => (levels[seat] >= 0 ? levels[seat] : null);
  if (voice) {
    pause.volume = { get: (id) => voice.volumeOf(id), set: (id, v) => voice.setVolume(id, v) };
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (e.code === VOICE.pttKey) voice.setPtt(true);
      if (e.code === VOICE.muteKey && !e.repeat) voice.setMuted(!voice.muted);
    });
    addEventListener('keyup', (e) => {
      if (e.code === VOICE.pttKey) voice.setPtt(false);
    });
    // Releasing the key in another window would leave push-to-talk stuck open.
    addEventListener('blur', () => voice.setPtt(false));
  }
  const voicePos = new THREE.Vector3();

  if (session) connect(session, world, panel, pause, code, refreshSeats);
  panel.setCam(startCam);

  function resize(): void {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    world.camera.aspect = w / h;
    world.camera.updateProjectionMatrix();
    pipeline?.setSize(w, h);
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  function syncHint(): void {
    const locked = document.pointerLockElement === stage;
    hint.hidden = world.cam !== 'pov' || locked || pause.isOpen;
    hint.textContent = 'Klick ins Bild, um dich umzusehen · Esc öffnet das Menü';
  }
  syncHint();

  // Click into the scene to look around: the mouse turns your character's head (pointer lock).
  stage.addEventListener('click', () => {
    if (world.cam === 'pov' && !document.pointerLockElement) void stage.requestPointerLock();
  });
  let unlockedAt = -Infinity;
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === stage;
    document.body.classList.toggle('locked', locked);
    // Esc while looking around releases the mouse (browser rule); that's when the menu opens.
    // In the benchmark the side panel is the menu: releasing the mouse just frees it for the panel.
    if (!locked && world.cam === 'pov') {
      unlockedAt = performance.now();
      if (!bench) pause.open();
    }
    syncHint();
  });
  pause.onResume = () => {
    pause.close();
    syncHint();
    if (world.cam === 'pov') void stage.requestPointerLock();
  };
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || world.cam !== 'pov') return;
    // The Esc that just released the pointer lock already opened the menu.
    if (performance.now() - unlockedAt < 300) return;
    if (pause.isOpen) pause.close();
    else pause.open();
    syncHint();
  });

  // Hold the right mouse button in POV to zoom, e.g. to read the card on someone's head.
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('mousedown', (e) => {
    if (e.button === 2 && world.cam === 'pov') world.zoom = 1;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 2) world.zoom = 0;
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== stage) return;
    const k = CAMERA.mouseSensitivity * settings.mouseSens * world.fovFactor;
    const look = players.look;
    look.yaw = Math.max(-HEAD.maxYaw, Math.min(HEAD.maxYaw, look.yaw - e.movementX * k));
    const dy = (settings.invertY ? -1 : 1) * e.movementY;
    look.pitch = Math.max(HEAD.minPitch, Math.min(HEAD.maxPitch, look.pitch + dy * k));
  });

  let last = performance.now();
  let fps = 60;
  let lastStat = 0;
  const sent = { yaw: NaN, pitch: NaN, at: -Infinity };
  function frame(now: number): void {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const rawMs = now - last;
    const dt = Math.min(0.05, Math.max(0.001, rawMs / 1000));
    last = now;
    fps = fps * 0.92 + (1 / dt) * 0.08;
    const t = clock.now();
    panel.tick();

    // Speed: the host (or solo player) turns the slider into a new profile; clients follow the host.
    if (panel.state.kmh !== world.train.kmh) {
      if (!session) world.train = { kmh: panel.state.kmh, t0: t, d0: trainDistance(world.train, t) };
      else if (session.role === 'host') session.setSpeed(panel.state.kmh, t);
    }
    // Head pose: send the target (not the smoothed head), so remote smoothing is the only lag.
    if (session?.welcomed) {
      const { yaw, pitch } = players.look;
      const moved = Math.abs(yaw - sent.yaw) > NET.poseEpsilon || Math.abs(pitch - sent.pitch) > NET.poseEpsilon;
      if ((moved && now - sent.at >= 1000 / NET.poseHz) || now - sent.at >= NET.poseKeepAliveMs) {
        session.sendPose(yaw, pitch);
        Object.assign(sent, { yaw, pitch, at: now });
      }
    }

    measureVoices();
    world.update(t, dt, settings);
    tags.update(world.cam === 'pov', (i) => Math.max(0, levels[i]));
    micHud?.update(pause.isOpen || (!session && voice?.micState !== 'on'));
    voice?.update(world.camera, (id) => {
      const seat = idToSeat.get(id);
      return seat === undefined ? null : players.headPos(seat, voicePos);
    });
    if (!pipeline) return;
    pipeline.render();
    benchPanel?.update({ ms: Math.max(0.1, rawMs), calls: pipeline.renderer.info.render.calls, render: pipeline.renderSize });
    if (now - lastStat > 400) {
      lastStat = now;
      const info = pipeline.renderer.info.render;
      panel.showStats({ calls: info.calls, tris: info.triangles, fps, t, seed: clock.seed, power: world.power });
    }
  }
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // Hook for Playwright checks; not shipped in the production bundle.
    Object.assign(window, { __hyper: { world, panel, pipeline, clock, session, pause, voice } });
  }
}

/** Wire a joined room into the scene: roster -> seats, poses -> heads, host speed and blackouts. */
function connect(session: Session, world: World, panel: DebugPanel, pause: PauseMenu, code: string, onSeats: () => void): void {
  const players = world.players;
  const roomInfo = () =>
    pause.setRoom({
      code,
      role: session.role,
      rttMs: world.clock.rttMs,
      players: [...session.roster.values()].map((e) => ({ id: e.id, name: e.state.name, seat: e.seat, me: e.id === session.selfId, host: e.id === session.hostId })),
    });
  const roster = (includeMe: boolean) => {
    players.applyRoster([...session.roster.values()], session.mySeat, includeMe);
    panel.setNetRole(session.role);
    onSeats();
    roomInfo();
  };
  players.remotePose = (seat) => session.poseForSeat(seat);
  roster(true);
  // A fresh room starts with the host's slider speed; a joiner takes what the welcome said.
  if (session.role === 'host' && session.train.kmh === 0) session.setSpeed(panel.state.kmh, world.clock.now());
  world.train = session.train;
  panel.showTempo(session.train.kmh);
  if (session.blackoutAt !== null) world.forcedBlackoutAt = session.blackoutAt;
  session.listen({
    roster: () => roster(false),
    status: () => roster(false),
    train: (t) => {
      world.train = t;
      panel.showTempo(t.kmh);
    },
    blackout: (at) => (world.forcedBlackoutAt = at),
  });
  setInterval(roomInfo, 2000);
}
