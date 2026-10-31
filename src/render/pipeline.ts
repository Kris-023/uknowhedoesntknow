import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BLOOM, LIGHTS, RENDER } from '../config';

/** UnrealBloomPass on a reduced grid: the composer hands it the full size, it works at a fraction. */
class ScaledBloomPass extends UnrealBloomPass {
  constructor(
    private scale: number,
    strength: number,
    radius: number,
    threshold: number,
  ) {
    super(new THREE.Vector2(256, 256), strength, radius, threshold);
  }

  override setSize(width: number, height: number): void {
    super.setSize(Math.max(2, Math.round(width * this.scale)), Math.max(2, Math.round(height * this.scale)));
  }
}

/**
 * Renderer plus optional bloom. The scene always renders into an HDR target with MSAA; bloom
 * (if on) adds glow above the threshold, and OutputPass applies tone mapping + sRGB at the end.
 * Bloom off only skips the bloom pass, so both paths are antialiased and tone-mapped the same way.
 * (The canvas used to carry the MSAA, but with post-processing only fullscreen quads reach it:
 * the scene was not antialiased at all with bloom, and bloom off fell back to the costly MSAA canvas.)
 */
export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scenePass: RenderPass;
  bloomOn = true;
  /** Multiplier on BLOOM.strength (player setting). */
  bloomStrength = 1;
  private renderScale = 1;
  private size = { w: 1, h: 1 };

  constructor(
    host: HTMLElement,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.setPixelRatio(Math.min(devicePixelRatio || 1, RENDER.maxPixelRatio));
    // The composer renders several passes per frame; stats should count the whole frame.
    r.info.autoReset = false;
    host.prepend(r.domElement);
    this.renderer = r;

    const samples = Math.min(RENDER.msaaSamples, r.capabilities.maxSamples);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(r, target);
    this.scenePass = new RenderPass(scene, camera);
    this.composer.addPass(this.scenePass);
    this.bloom = new ScaledBloomPass(BLOOM.resolutionScale, BLOOM.strength, BLOOM.radius, LIGHTS.bloomThreshold);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Another world (map change): same renderer, canvas and passes, new scene and camera. */
  setView(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scenePass.scene = scene;
    this.scenePass.camera = camera;
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
    this.bloom.enabled = this.bloomOn;
    this.bloom.threshold = LIGHTS.bloomThreshold;
    this.bloom.strength = BLOOM.strength * this.bloomStrength;
    this.composer.render();
  }
}
