import * as THREE from 'three';
import { CAMERA } from './config';
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

const HINT_SEAT = 'Klicken zum Umsehen · Esc lässt los · Debug: Taste ^';
const HINT_WAGON = 'Debug: Taste ^';

const panel = new DebugPanel(document.body, {
  onSight: (on) => {
    setSightMode(world.scene, on);
    if (pipeline) pipeline.bloomOn = !on && panel.state.bloom;
  },
  onBloom: (on) => {
    if (pipeline) pipeline.bloomOn = on && !panel.state.sight;
  },
  onCam: (cam) => {
    world.cam = cam;
    world.seatYaw = 0;
    world.seatPitch = -0.12;
    stage.classList.toggle('look', cam.kind === 'seat');
    hint.textContent = cam.kind === 'seat' ? HINT_SEAT : HINT_WAGON;
    if (cam.kind !== 'seat' && document.pointerLockElement) document.exitPointerLock();
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

// Click into the scene to look around with the mouse (pointer lock), like the head POV will work in M2.
stage.addEventListener('click', () => {
  if (world.cam.kind === 'seat' && !document.pointerLockElement) stage.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  document.body.classList.toggle('locked', document.pointerLockElement === stage);
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== stage) return;
  const k = CAMERA.mouseSensitivity;
  world.seatYaw = Math.max(-CAMERA.maxYaw, Math.min(CAMERA.maxYaw, world.seatYaw - e.movementX * k));
  world.seatPitch = Math.max(-0.9, Math.min(0.7, world.seatPitch - e.movementY * k));
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
