import * as THREE from 'three';
import { CAMERA, HEAD } from './config';
import { SharedClock } from './core/clock';
import { DebugPanel } from './debug/panel';
import { sceneTree } from './debug/sceneTree';
import { setSightMode } from './debug/sight';
import { Pipeline } from './render/pipeline';
import { World } from './scene/world';
import './style.css';

// The prototype's palette was tuned on r128, where hex colours went into the shader unconverted.
// Turning colour management off keeps those hex values looking the same; textures still decode sRGB.
THREE.ColorManagement.enabled = false;

const stage = document.getElementById('stage')!;
const hint = document.getElementById('hint')!;
const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const clock = seedParam ? new SharedClock(+seedParam | 0, performance.timeOrigin + performance.now()) : SharedClock.local();
const world = new World(clock);

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

const panel = new DebugPanel(document.body, world.players, {
  onSight: (on) => {
    setSightMode(world.scene, on);
    if (pipeline) pipeline.bloomOn = !on && panel.state.bloom;
  },
  onBloom: (on) => {
    if (pipeline) pipeline.bloomOn = on && !panel.state.sight;
  },
  onCam: (cam) => {
    world.cam = cam;
    world.players.instant = cam === 'pov';
    stage.classList.toggle('look', cam === 'pov');
    hint.textContent = cam === 'pov' ? HINT_POV : HINT_WAGON;
    if (cam !== 'pov' && document.pointerLockElement) document.exitPointerLock();
  },
  onBlackout: () => (world.forcedBlackoutAt = clock.now()),
  tree: () => sceneTree(world.scene),
});

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
  const look = world.players.look;
  look.yaw = Math.max(-HEAD.maxYaw, Math.min(HEAD.maxYaw, look.yaw - e.movementX * k));
  look.pitch = Math.max(HEAD.minPitch, Math.min(HEAD.maxPitch, look.pitch + e.movementY * k));
});

let last = performance.now();
let fps = 60;
let lastStat = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  if (document.hidden) return;
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  fps = fps * 0.92 + (1 / dt) * 0.08;
  const t = clock.now();
  panel.tick();
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
  Object.assign(window, { __hyper: { world, panel, pipeline, clock } });
}
