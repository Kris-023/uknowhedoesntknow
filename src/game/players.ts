import * as THREE from 'three';
import { CAMERA, COLORS, HEAD, LIGHTS, NET, WHOAMI } from '../config';
import type { Spot } from '../maps/types';
import { mulberry32, type Rand } from '../core/rng';
import { ITEMS, ITEM_IDS, SLOT_CHANCE, SLOTS, type ItemId } from '../characters/accessories';
import { makeLook, type Look } from '../characters/look';
import { Person, type PersonState } from '../characters/person';
import { basic, group, tag } from '../scene/build';
import { fakePeer } from './fakePeers';

const START_LOOKS: Partial<Look>[] = [
  { female: false, hair: 'kurz' },
  { female: true, hair: 'lang' },
  { female: false, hair: 'locken' },
  { female: true, hair: 'dutt' },
];
const START_ITEMS: ItemId[][] = [['basecap'], ['gurke'], ['huhn'], ['jute']];
/** Names for the simulated passengers in solo mode. */
const FAKE_NAMES = ['Kalle', 'Deniz', 'Mo', 'Sascha'];

/** Height of the head centre above the seat root (torso 0.62 + head 0.19). */
const HEAD_Y = 0.81;
/** Name label sits between the head (with hats) and the marker diamond. */
const LABEL_Y = 1.36;

/** A random person for joining a room: random look, some random items. */
export function randomState(r: Rand): PersonState {
  const items: PersonState['items'] = {};
  for (const s of SLOTS) {
    if (r() >= SLOT_CHANCE[s]) continue;
    const ids = ITEM_IDS.filter((id) => ITEMS[id].slot === s);
    items[s] = ids[Math.floor(r() * ids.length) % ids.length];
  }
  return { name: '', look: makeLook(r), items };
}

/** Where the other seats get their heads from: scripted fake peers, or real players over the network. */
export type PlayerMode = 'fake' | 'net';

export type RemotePose = (seat: number) => { yaw: number; pitch: number } | null;

/**
 * The four players on their seats. One is "me" (`active`): its head follows `look`
 * (mouse in POV, slider/demo otherwise). The others are fake peers (solo test) or remote
 * players; in a network room, empty seats stay empty.
 */
export class Players {
  readonly people: Person[] = [];
  private markers: THREE.Mesh[] = [];
  /** yawTable[i][j]: head yaw for player i to face player j. Seats never move, so this is static. */
  private yawTable: number[][] = [];
  active = 0;
  /** Target head direction of the local player; pitch positive = looking down. */
  readonly look = { yaw: 0, pitch: 0.12 };
  /** Whether the local head should follow `look` instantly (POV) or slowly (slider). */
  instant = false;
  /** Debug: everyone talks at once, to inspect the mouth. */
  talkTest = false;
  private markerColors: THREE.Color[] = [];
  mode: PlayerMode = 'fake';
  remotePose: RemotePose = () => null;
  /** Real voice level per seat (mic or received audio); null = no voice there, use the script. */
  voiceLevel: (seat: number) => number | null = () => null;
  /** Seats with a player in them; all four in fake mode. */
  readonly occupied = [true, true, true, true];
  /** Last applied roster state per seat, to skip rebuilding bodies when nothing changed. */
  private applied: string[] = [];

  constructor(
    parent: THREE.Object3D,
    private seed: number,
    seats: readonly Spot[],
  ) {
    const rand = mulberry32(seed ^ 0x5eed);
    const markerGeo = new THREE.OctahedronGeometry(0.11, 0);
    seats.forEach((seat, i) => {
      const root = group(`player_${i + 1}`, parent);
      root.position.set(seat.x, seat.y, seat.z);
      root.rotation.y = seat.yaw;
      const look = { ...makeLook(rand), ...START_LOOKS[i], top: COLORS.players[i], glasses: false, beard: 'none' as const };
      const p = new Person(root, look, 'sit');
      p.name = FAKE_NAMES[i];
      for (const id of START_ITEMS[i]) p.equip(id);
      p.settle();
      this.people.push(p);

      this.markerColors.push(new THREE.Color(COLORS.players[i]));
      const mk = tag(new THREE.Mesh(markerGeo, basic(COLORS.players[i])), 'light');
      mk.scale.y = 1.4;
      mk.position.y = 1.55;
      mk.userData.keep = true;
      root.add(mk);
      this.markers.push(mk);
    });

    parent.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    this.yawTable = this.people.map((a) =>
      this.people.map((b) => {
        v.set(0, HEAD_Y, 0);
        b.root.localToWorld(v);
        a.root.worldToLocal(v);
        v.y = 0;
        return Math.max(-HEAD.maxYaw, Math.min(HEAD.maxYaw, Math.atan2(v.x, v.z)));
      }),
    );
  }

  get me(): Person {
    return this.people[this.active];
  }

  /** Whether this client may change the person (own player, or anyone in fake mode). */
  isLocal(i: number): boolean {
    return this.mode === 'fake' || i === this.active;
  }

  /**
   * Network roster -> seats. Own look and items are only taken once (seat colour from the host);
   * after that the local state is the truth and a stale roster must not undo a fresh change.
   */
  applyRoster(entries: { seat: number; state: PersonState }[], mySeat: number, includeMe: boolean): void {
    this.mode = 'net';
    if (mySeat >= 0) this.active = mySeat;
    this.occupied.fill(false);
    for (const e of entries) {
      this.occupied[e.seat] = true;
      if (e.seat === mySeat && !includeMe) continue;
      this.applyState(e.seat, e.state);
    }
  }

  /**
   * Same room, new map: take over who sits where, who I am, where I look and what everyone looks
   * like (including debug changes). Seat indices stay; only the spots in the map differ.
   */
  adopt(prev: Players): void {
    this.active = prev.active;
    this.mode = prev.mode;
    this.instant = prev.instant;
    this.talkTest = prev.talkTest;
    this.showMarkers = prev.showMarkers;
    this.remotePose = prev.remotePose;
    this.voiceLevel = prev.voiceLevel;
    Object.assign(this.look, prev.look);
    prev.occupied.forEach((o, i) => (this.occupied[i] = o));
    prev.people.forEach((p, i) => {
      const key = JSON.stringify(p.state());
      // Same seed, same start looks: an untouched seat needs no rebuild.
      if (key === JSON.stringify(this.people[i].state())) this.applied[i] = prev.applied[i];
      else this.applyState(i, p.state());
      // Head where it was, so remote heads don't swing in from straight ahead.
      this.people[i].yaw = p.yaw;
      this.people[i].pitch = p.pitch;
    });
  }

  /** Put a full state (name, look, items) on a seat; skips the rebuild if nothing changed. */
  applyState(seat: number, state: PersonState): void {
    const key = JSON.stringify(state);
    if (this.applied[seat] === key) return;
    this.applied[seat] = key;
    const p = this.people[seat];
    p.name = state.name;
    p.setLook(state.look);
    for (const s of SLOTS) p.unequip(s);
    for (const id of Object.values(state.items)) p.equip(id);
  }

  /** World position of the head of seat `i`, where that player's voice comes from. */
  headPos(i: number, out: THREE.Vector3): THREE.Vector3 {
    return this.people[i].rig.head.localToWorld(out.set(0, 0.12, 0.05));
  }

  /** World position of the card above the head of seat `i` (follows the head when it turns). */
  cardPos(i: number, out: THREE.Vector3): THREE.Vector3 {
    const head = this.people[i].rig.head;
    head.localToWorld(out.set(0, 0, 0));
    out.y = this.people[i].root.localToWorld(this.tmp.set(0, WHOAMI.cardY, 0)).y;
    return out;
  }

  private tmp = new THREE.Vector3();
  /** Marker diamonds make room for the cards during a round. */
  showMarkers = true;

  /** World position for the name label of seat `i`. */
  labelPos(i: number, out: THREE.Vector3): THREE.Vector3 {
    return this.people[i].root.localToWorld(out.set(0, LABEL_Y, 0));
  }

  update(t: number, dt: number, pov: boolean): void {
    const n = this.people.length;
    this.people.forEach((p, i) => {
      p.root.visible = this.occupied[i];
      if (!this.occupied[i]) return;
      const fake = fakePeer(t, i, this.seed, (j) => this.yawTable[i][j], n);
      // Mouths follow real voices; in a room a silent seat stays silent, solo the script talks.
      const voice = this.voiceLevel(i);
      if (voice !== null) fake.level = voice;
      else if (this.mode === 'net') fake.level = 0;
      if (this.talkTest) fake.level = (0.5 + 0.5 * Math.sin(t * 14 + i)) * (0.6 + 0.4 * Math.sin(t * 4.3 + i));
      if (i === this.active) {
        const rate = this.instant ? CAMERA.povRate : HEAD.slowRate;
        p.update(dt, t, this.look.yaw, this.look.pitch, rate, fake.level);
      } else if (this.mode === 'net') {
        // Remote heads: the pose arrives ~20x per second; smoothing turns the steps into motion.
        const r = this.remotePose(i);
        p.update(dt, t, r?.yaw ?? p.yaw, r?.pitch ?? p.pitch, NET.remoteRate, fake.level);
      } else {
        // Slow turn: the head creeping towards a neighbour is the visual punchline.
        p.update(dt, t, fake.yaw, fake.pitch, 1.6, fake.level);
      }
      const self = pov && i === this.active;
      p.rig.povHide.visible = !self;
      const mk = this.markers[i];
      mk.visible = !self && this.showMarkers;
      mk.position.y = 1.55 + 0.04 * Math.sin(t * 2 + i);
      mk.rotation.y = t * 1.5;
      // Markers are UI, not light sources: keep them just under the bloom threshold so they never glow.
      const c = this.markerColors[i];
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      (mk.material as THREE.MeshBasicMaterial).color.copy(c).multiplyScalar(Math.min(1, (0.85 * LIGHTS.bloomThreshold) / lum));
    });
  }

  /** Random items, at least one if `force`. Hand items only when a hand is free. */
  randomItems(p: Person, r: Rand, force: boolean): void {
    for (const s of SLOTS) {
      p.unequip(s);
      if (s === 'hand' && !p.handSide) continue;
      if (r() < SLOT_CHANCE[s]) {
        const ids = ITEM_IDS.filter((id) => ITEMS[id].slot === s);
        p.equip(ids[Math.floor(r() * ids.length) % ids.length]);
      }
    }
    if (force && !SLOTS.some((s) => p.items[s])) p.equip(ITEM_IDS[Math.floor(r() * ITEM_IDS.length) % ITEM_IDS.length]);
  }

  randomLook(i: number, r: Rand): void {
    this.people[i].setLook({ ...makeLook(r), top: COLORS.players[i] });
  }
}
