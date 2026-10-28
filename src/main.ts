import * as THREE from 'three';
import { CAMERA, HEAD, NET } from './config';
import { SharedClock } from './core/clock';
import { DebugPanel } from './debug/panel';
import { sceneTree } from './debug/sceneTree';
import { setSightMode } from './debug/sight';
import { randomState } from './game/players';
import { trainDistance } from './net/protocol';
import { Session } from './net/session';
import { trysteroTransport } from './net/trystero';
import { Pipeline } from './render/pipeline';
import { World } from './scene/world';
import { Lobby, RoomBadge } from './ui/lobby';
import './style.css';

// The prototype's palette was tuned on r128, where hex colours went into the shader unconverted.
// Turning colour management off keeps those hex values looking the same; textures still decode sRGB.
THREE.ColorManagement.enabled = false;

const stage = document.getElementById('stage')!;
const hint = document.getElementById('hint')!;
const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');

void start();

/**
 * Lobby first: a joiner only learns seed and start time from the host's welcome, and the whole
 * world (tunnel, flicker, fake peers) is built from that seed.
 */
async function start(): Promise<void> {
  // ?seed=… skips the lobby: deterministic solo scene for screenshots and debugging.
  if (seedParam) {
    launch(new SharedClock(+seedParam | 0, performance.timeOrigin + performance.now()), null, 'wagon');
    return;
  }
  const lobby = new Lobby(document.body);
  const choice = await lobby.choose();
  const clock = SharedClock.local();
  if (choice.kind === 'solo') {
    lobby.hide();
    launch(clock, null, 'pov');
    return;
  }
  const { code } = choice;
  history.replaceState(null, '', `#${code}`);
  const net = trysteroTransport(code, (msg) => console.warn('Trystero:', msg));
  const session = new Session(net, clock, choice.kind === 'create', randomState(Math.random));
  addEventListener('pagehide', () => session.leave());
  // Pings and hello retries keep running while the tab is in the background.
  setInterval(() => session.tick(), 50);

  const go = () => {
    lobby.hide();
    launch(clock, session, 'pov', code);
  };
  if (session.welcomed) go();
  else {
    lobby.connecting(code, () => session.takeOver());
    session.listen({
      welcome: go,
      status: (s) => {
        if (s === 'full' && !session.welcomed) lobby.message(`Der Raum ist voll (${NET.maxPlayers} von ${NET.maxPlayers}).`);
      },
    });
  }
}

function launch(clock: SharedClock, session: Session | null, startCam: 'wagon' | 'pov', code = ''): void {
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

  const HINT_POV = 'Klicken zum Umsehen · rechte Maustaste zoomt · Esc lässt los · Debug: Taste ^';
  const HINT_WAGON = 'Debug: Taste ^';

  const panel = new DebugPanel(document.body, players, {
    onSight: (on) => {
      setSightMode(world.scene, on);
      if (pipeline) pipeline.bloomOn = !on && panel.state.bloom;
    },
    onBloom: (on) => {
      if (pipeline) pipeline.bloomOn = on && !panel.state.sight;
    },
    onCam: (cam) => {
      world.cam = cam;
      players.instant = cam === 'pov';
      stage.classList.toggle('look', cam === 'pov');
      hint.textContent = cam === 'pov' ? HINT_POV : HINT_WAGON;
      if (cam !== 'pov' && document.pointerLockElement) document.exitPointerLock();
    },
    onBlackout: () => {
      if (session) session.triggerBlackout(clock.now());
      else world.forcedBlackoutAt = clock.now();
    },
    onLocalChange: () => session?.setState(players.me.state()),
    tree: () => sceneTree(world.scene),
  });

  if (session) connect(session, world, panel, code);
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

  // Click into the scene to look around: the mouse turns your character's head (pointer lock).
  stage.addEventListener('click', () => {
    if (world.cam === 'pov' && !document.pointerLockElement) stage.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    document.body.classList.toggle('locked', document.pointerLockElement === stage);
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
    const k = CAMERA.mouseSensitivity * world.fovFactor;
    const look = players.look;
    look.yaw = Math.max(-HEAD.maxYaw, Math.min(HEAD.maxYaw, look.yaw - e.movementX * k));
    look.pitch = Math.max(HEAD.minPitch, Math.min(HEAD.maxPitch, look.pitch + e.movementY * k));
  });

  let last = performance.now();
  let fps = 60;
  let lastStat = 0;
  const sent = { yaw: NaN, pitch: NaN, at: -Infinity };
  function frame(now: number): void {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
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

    world.update(t, dt, panel.state);
    if (!pipeline) return;
    pipeline.render();
    if (now - lastStat > 400) {
      lastStat = now;
      const info = pipeline.renderer.info.render;
      panel.showStats({ calls: info.calls, tris: info.triangles, fps, t, seed: clock.seed, power: world.power });
    }
  }
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // Hook for Playwright checks; not shipped in the production bundle.
    Object.assign(window, { __hyper: { world, panel, pipeline, clock, session } });
  }
}

/** Wire a joined room into the scene: roster -> seats, poses -> heads, host speed and blackouts. */
function connect(session: Session, world: World, panel: DebugPanel, code: string): void {
  const players = world.players;
  const badge = new RoomBadge(document.body, code);
  const roster = (includeMe: boolean) => {
    players.applyRoster([...session.roster.values()], session.mySeat, includeMe);
    panel.setNetRole(session.role);
    badge.update(session.roster.size, session.role, world.clock.rttMs);
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
  setInterval(() => badge.update(session.roster.size, session.role, world.clock.rttMs), 1000);
}
