import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Players } from '../src/game/players';
import type { Spot } from '../src/maps/types';
import { collectResources, disposeExcept } from '../src/scene/dispose';

const disposed = (o: THREE.EventDispatcher<{ dispose: object }>) => {
  const hit = { n: 0 };
  o.addEventListener('dispose', () => hit.n++);
  return hit;
};

describe('map change: freeing the old world', () => {
  it('frees what only the old scene used and keeps what the new one shares', () => {
    const sharedGeo = new THREE.BoxGeometry();
    const sharedMat = new THREE.MeshStandardMaterial();
    const ownTex = new THREE.Texture();
    const uniformTex = new THREE.Texture();
    const ownGeo = new THREE.SphereGeometry();
    const ownMat = new THREE.MeshStandardMaterial({ map: ownTex });
    const shaderMat = new THREE.ShaderMaterial({ uniforms: { tex: { value: uniformTex } } });
    const bg = new THREE.Texture();

    const old = new THREE.Scene();
    old.background = bg;
    old.add(new THREE.Mesh(sharedGeo, sharedMat), new THREE.Mesh(ownGeo, [ownMat, shaderMat]));
    const inst = new THREE.InstancedMesh(ownGeo, ownMat, 4);
    old.add(inst);
    const next = new THREE.Scene();
    next.add(new THREE.Mesh(sharedGeo, sharedMat));

    const hits = { sharedGeo: disposed(sharedGeo), sharedMat: disposed(sharedMat), ownGeo: disposed(ownGeo), ownMat: disposed(ownMat), shaderMat: disposed(shaderMat), ownTex: disposed(ownTex), uniformTex: disposed(uniformTex), bg: disposed(bg), inst: disposed(inst) };
    const n = disposeExcept(old, collectResources(next));

    expect(hits.sharedGeo.n).toBe(0);
    expect(hits.sharedMat.n).toBe(0);
    for (const k of ['ownGeo', 'ownMat', 'shaderMat', 'ownTex', 'uniformTex', 'bg', 'inst'] as const) expect(hits[k].n, k).toBe(1);
    expect(n).toEqual({ geometries: 1, materials: 2, textures: 3 });
  });
});

describe('map change: people carry over', () => {
  const seatsA: Spot[] = [0, 1, 2, 3].map((i) => ({ x: i, y: 0.525, z: 0, yaw: 0 }));
  const seatsB: Spot[] = [0, 1, 2, 3].map((i) => ({ x: 0, y: 0.525, z: i * 2, yaw: Math.PI / 2 }));

  it('keeps seat, mode, occupancy, head target and looks; seats move to the new spots', () => {
    const a = new Players(new THREE.Group(), 7, seatsA);
    a.applyRoster(
      [
        { seat: 2, state: { ...a.people[2].state(), name: 'Ich' } },
        { seat: 0, state: { ...a.people[0].state(), name: 'Host', items: {} } },
      ],
      2,
      true,
    );
    a.look.yaw = 0.4;
    a.look.pitch = -0.1;
    a.instant = true;
    const pose = () => ({ yaw: 0.3, pitch: 0 });
    a.remotePose = pose;
    a.randomLook(3, () => 0.25);

    const b = new Players(new THREE.Group(), 7, seatsB);
    b.adopt(a);
    expect(b.active).toBe(2);
    expect(b.mode).toBe('net');
    expect(b.occupied).toEqual([true, false, true, false]);
    expect(b.look).toEqual({ yaw: 0.4, pitch: -0.1 });
    expect(b.instant).toBe(true);
    expect(b.remotePose).toBe(pose);
    for (let i = 0; i < 4; i++) expect(b.people[i].state()).toEqual(a.people[i].state());
    expect(b.people[2].name).toBe('Ich');
    expect(b.people[1].root.position.z).toBe(2);
  });
});
