import * as THREE from 'three';
import { COLORS } from '../config';
import type { Role } from '../scene/build';

// "Meine Sicht": swaps every tagged mesh for a wireframe coloured by role, to show the scene as
// structure (what is wall, light, player, prop) rather than as picture.

const wire: Record<Role, THREE.Material> = {
  struct: new THREE.MeshBasicMaterial({ color: 0x4fd8ff, wireframe: true, transparent: true, opacity: 0.55 }),
  light: new THREE.MeshBasicMaterial({ color: 0xffb224, wireframe: true, transparent: true, opacity: 0.9 }),
  player: new THREE.MeshBasicMaterial({ color: 0xff5fa8, wireframe: true, transparent: true, opacity: 0.8 }),
  npc: new THREE.MeshBasicMaterial({ color: 0x8aa0d8, wireframe: true, transparent: true, opacity: 0.55 }),
  prop: new THREE.MeshBasicMaterial({ color: 0xb8ff6a, wireframe: true, transparent: true, opacity: 0.9 }),
  outside: new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
  fx: new THREE.MeshBasicMaterial({ visible: false }),
};

export const ROLE_COLORS: Partial<Record<Role, string>> = {
  struct: '#4fd8ff',
  light: '#ffb224',
  player: '#ff5fa8',
  npc: '#8aa0d8',
  prop: '#b8ff6a',
  outside: '#ffffff',
};

export function setSightMode(scene: THREE.Scene, on: boolean): void {
  const bg = on ? COLORS.backgroundSight : COLORS.background;
  (scene.background as THREE.Color).setHex(bg);
  (scene.fog as THREE.Fog).color.setHex(bg);
  scene.traverse((o) => {
    const role = o.userData.role as Role | undefined;
    if (!(o instanceof THREE.Mesh) || !role) return;
    if (!o.userData.orig) o.userData.orig = o.material;
    o.material = on ? wire[role] : o.userData.orig;
  });
}
