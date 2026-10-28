import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BLOOM, LIGHTS, RENDER } from '../config';

/**
 * Renderer plus optional bloom. With bloom on, the scene renders into an HDR target, bloom adds
 * glow to everything above the threshold, and OutputPass applies tone mapping + sRGB at the end.
 */
export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  bloomOn = true;

  constructor(
    host: HTMLElement,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.setPixelRatio(Math.min(devicePixelRatio || 1, RENDER.maxPixelRatio));
    // The composer renders several passes per frame; stats should count the whole frame.
    r.info.autoReset = false;
    host.prepend(r.domElement);
    this.renderer = r;

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), BLOOM.strength, BLOOM.radius, LIGHTS.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(): void {
    this.renderer.info.reset();
    // Follow the active light preset.
    this.renderer.toneMappingExposure = LIGHTS.exposure;
    this.bloom.threshold = LIGHTS.bloomThreshold;
    if (this.bloomOn) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
