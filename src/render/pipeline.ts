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
  /** Multiplier on BLOOM.strength (player setting). */
  bloomStrength = 1;
  private renderScale = 1;
  private size = { w: 1, h: 1 };

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

  /** Device pixels per CSS pixel actually rendered: screen density, capped, times the quality setting. */
  private pixelRatio(): number {
    return Math.min(devicePixelRatio || 1, RENDER.maxPixelRatio) * this.renderScale;
  }

  /** Lower render resolution; the canvas still fills the window (the browser upscales). */
  setRenderScale(k: number): void {
    if (k === this.renderScale) return;
    this.renderScale = k;
    this.setSize(this.size.w, this.size.h);
  }

  /** Rendered size in device pixels, for the benchmark readout. */
  get renderSize(): { w: number; h: number } {
    const k = this.pixelRatio();
    return { w: Math.round(this.size.w * k), h: Math.round(this.size.h * k) };
  }

  setSize(w: number, h: number): void {
    this.size = { w, h };
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(): void {
    this.renderer.info.reset();
    // Follow the active light preset.
    this.renderer.toneMappingExposure = LIGHTS.exposure;
    this.bloom.threshold = LIGHTS.bloomThreshold;
    this.bloom.strength = BLOOM.strength * this.bloomStrength;
    if (this.bloomOn) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
