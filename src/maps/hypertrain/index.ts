import * as THREE from 'three';
import { AMBIENCE, BLACKOUT, CAMERA, COLORS, HALT_CYCLE_S, NPC_DEFS, PLAYER_SEATS, RENDER, SEAT_X, SPEED, STATIONS, TRAIN } from '../../config';
import { coachPower, haltCountdown, nextStopIndex } from '../../core/motion';
import { hash01 } from '../../core/rng';
import { bakeCrowd, crowdMaterial } from '../../game/crowd';
import { buildCoach } from '../../scene/coach';
import { buildJunk } from '../../scene/junk';
import { buildLighting } from '../../scene/lighting';
import { buildNeighbours } from '../../scene/neighbours';
import { makeCoachTextures } from '../../scene/textures';
import { buildTunnel } from '../../scene/tunnel';
import type { MapDef, MapScene, MapSound, NpcSpot, SoundKit, Spot } from '../types';

const NO_BLACKOUTS = { ...BLACKOUT, chance: -1 };
/** Seated people face the aisle. */
const seatYaw = (side: number) => (side === -1 ? Math.PI / 2 : -Math.PI / 2);
const seatSpot = (side: number, z: number): Spot => ({ x: side * SEAT_X, y: 0.525, z, yaw: seatYaw(side) });

/** The hypertrain coach: neon, tunnel streaks, neighbour coaches, blackouts, stops. */
function build(scene: THREE.Scene, seed: number): MapScene {
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.Fog(COLORS.background, RENDER.fogNear, RENDER.fogFar);
  const tex = makeCoachTextures();
  const coach = buildCoach(scene, tex);
  const lighting = buildLighting(scene, coach.root, tex, seed);
  const tunnel = buildTunnel(scene, seed);
  // Baked after lighting, so the neon tubes are part of every neighbour copy; people are added
  // by the world afterwards and are not part of the copies.
  const crowds = Array.from({ length: TRAIN.crowdVariants }, (_, i) => bakeCrowd(seed + i * 101));
  const neighbours = buildNeighbours(scene, coach.root, coach.poweredMaterials, { geos: crowds, material: crowdMaterial, upTo: TRAIN.crowdedPerSide }, lighting.hemi);
  const junk = buildJunk(coach.root, seed);

  const npcs: NpcSpot[] = NPC_DEFS.map((d) => ({
    act: d.act,
    can: 'can' in d ? d.can : undefined,
    ...('seat' in d ? { pose: 'sit' as const, at: seatSpot(d.seat.side, d.seat.z) } : { pose: 'stand' as const, at: { x: d.stand.x, y: 0, z: d.stand.z, yaw: d.stand.yaw } }),
  }));

  const map: MapScene = {
    root: coach.root,
    seats: PLAYER_SEATS.map((s) => seatSpot(s.side, s.z)),
    npcs,
    scoldSpot(i) {
      const s = PLAYER_SEATS[i];
      // In the aisle beside the seat, turned towards it.
      const x = s.side * 0.42;
      const z = s.z + (s.z < 0 ? -0.55 : 0.55);
      return { x, y: 0, z, yaw: Math.atan2(s.side * SEAT_X - x, s.z - z) };
    },
    overview: { pos: CAMERA.wagonPos, look: CAMERA.wagonLook, fov: CAMERA.wagonFov },
    power: 1,
    shake: 1,
    speedFov: 6,
    events: () => [...(map.power < 0.98 ? ['Stromausfall'] : []), ...(lighting.passing ? ['Gegenzug'] : [])],
    update(f) {
      const sf = f.kmh / SPEED.maxKmh;
      map.power = coachPower(f.t, seed, f.blackouts ? BLACKOUT : NO_BLACKOUTS, f.forcedBlackoutAt);
      tunnel.update(f.t, f.distance, f.kmh);
      lighting.update(f.t, sf, map.power);
      coach.setPower(map.power);
      neighbours.update(f.t);
      coach.halt.draw(haltCountdown(f.t, HALT_CYCLE_S), STATIONS[nextStopIndex(f.t, HALT_CYCLE_S, STATIONS.length)]);
      junk.update(f.t);
      neighbours.cull(f.camera);
    },
  };
  return map;
}

const LINES: Record<(typeof STATIONS)[number], string[]> = {
  Offenbach: ['Nächster Halt: Offenbach.', 'Nächster Halt: Offenbach. Bitte nicht an den Türen lehnen.'],
  Kaiserslautern: ['Nächster Halt: Kaiserslautern.', 'Nächster Halt: Kaiserslautern. Ausstieg in Fahrtrichtung rechts.'],
  Oranienburg: ['Nächster Halt: Oranienburg.', 'Nächster Halt: Oranienburg. Zurückbleiben bitte.'],
  'Alt Schauerberg': ['Nächster Halt: Alt Schauerberg.', 'Nächster Halt: Alt Schauerberg. Ausstieg in Fahrtrichtung links.'],
  KitKat: ['Nächster Halt: KitKat.', 'Nächster Halt: KitKat. Bitte achten Sie auf Ihr Gepäck. Und auf Ihre Gurke.'],
  Kreuzberg: ['Nächster Halt: Kreuzberg.', 'Nächster Halt: Kreuzberg. Ausstieg in Fahrtrichtung links.'],
  Alfteller: ['Nächster Halt: Alfteller.', 'Nächster Halt: Alfteller. Bitte nicht an den Türen lehnen.'],
  Gutach: ['Nächster Halt: Gutach. Endstation, bitte alle aussteigen.', 'Nächster Halt: Gutach. Dieser Zug endet dort. Wirklich.'],
};

/**
 * Train sounds: low rumble and motor hum with the speed, a relay clunk when the power drops, and
 * a gong + announcement before each stop. Rail-joint clicks and the oncoming-train whoosh were
 * tried and dropped on request (too present); the oncoming train is light only.
 */
function sound(kit: SoundKit, seed: number): MapSound {
  const { ctx } = kit;
  const src = new AudioBufferSourceNode(ctx, { buffer: kit.noise, loop: true });
  const rumbleLp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 150, Q: 0.7 });
  const rumble = new GainNode(ctx, { gain: 0 });
  src.connect(rumbleLp).connect(rumble).connect(kit.bed);
  src.start();
  const humOsc = new OscillatorNode(ctx, { type: 'sawtooth', frequency: 40 });
  const hum = new GainNode(ctx, { gain: 0 });
  humOsc.connect(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 220 })).connect(hum).connect(kit.bed);
  humOsc.start();
  let lastAnnounce = -1;
  return {
    update(t, power, kmh) {
      const now = ctx.currentTime;
      const sf = Math.min(1, kmh / SPEED.maxKmh);
      rumble.gain.setTargetAtTime(0.02 + 0.22 * Math.sqrt(sf), now, 0.3);
      rumbleLp.frequency.setTargetAtTime(110 + 260 * sf, now, 0.3);
      // The motor sings with the speed; it stops with the power, the rumble doesn't (the train rolls on).
      hum.gain.setTargetAtTime(0.035 * sf * power, now, 0.15);
      humOsc.frequency.setTargetAtTime(32 + 60 * sf, now, 0.3);
      const cycle = Math.floor(t / HALT_CYCLE_S);
      if (haltCountdown(t, HALT_CYCLE_S) === AMBIENCE.announceAt && cycle !== lastAnnounce) {
        lastAnnounce = cycle;
        const lines = LINES[STATIONS[nextStopIndex(t, HALT_CYCLE_S, STATIONS.length)]];
        kit.announce(lines[Math.floor(hash01(seed, cycle, 5) * lines.length) % lines.length]);
      }
    },
  };
}

export const HYPERTRAIN: MapDef = {
  id: 'hypertrain',
  name: 'Hypertrain',
  blurb: 'U-Bahn-Wagen mit 1200 km/h, Neon und Kotti-Besetzung.',
  build,
  sound,
};
