import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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
 * Final pass in display space (after OutputPass): 3x3 sharpen (centre minus the four neighbours)
 * and an edge-darkening vignette. Each part is switched by a uniform; with both off the pass is
 * disabled outright, so it costs nothing.
 */
const FinishShader = {
  name: 'FinishShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    texel: { value: new THREE.Vector2(1, 1) },
    sharpen: { value: 0 },
    vignette: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 texel;
    uniform float sharpen;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 rgb = c.rgb;
      if (sharpen > 0.0) {
        vec3 n = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb
               + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        rgb = clamp(rgb + sharpen * (4.0 * rgb - n), 0.0, 1.0);
      }
      if (vignette > 0.0) {
        vec2 d = (vUv - 0.5) * 1.35;
        rgb *= 1.0 - vignette * smoothstep(0.25, 1.0, dot(d, d));
      }
      gl_FragColor = vec4(rgb, c.a);
    }`,
};

/** Strength of the sharpen kernel and of the vignette when switched on. */
const FINISH = { sharpen: 0.5, vignette: 0.55 } as const;

class FinishPass extends ShaderPass {
  constructor() {
    super(FinishShader);
    this.enabled = false;
  }

  override setSize(width: number, height: number): void {
    (this.uniforms.texel.value as THREE.Vector2).set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }
}

/**
 * Renderer plus optional bloom. The scene always renders into an HDR target with MSAA; bloom
 * (if on) adds glow above the threshold, and OutputPass applies tone mapping + sRGB at the end.
 * Bloom off only skips the bloom pass, so both paths are antialiased and tone-mapped the same way.
 * After OutputPass an optional finish pass sharpens and vignettes (both off by default).
 * (The canvas used to carry the MSAA, but with post-processing only fullscreen quads reach it:
 * the scene was not antialiased at all with bloom, and bloom off fell back to the costly MSAA canvas.)
 */
export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scenePass: RenderPass;
  private finish: FinishPass;
  bloomOn = true;
  /** Multiplier on BLOOM.strength (player setting "Leuchten"). */
  bloomStrength = 1;
  /** Multiplier on the tone-mapping exposure (player setting "Renderhelligkeit"). */
  renderBrightness = 1;
  /** "Nachschärfen". */
  sharpen = false;
  /** "Vignette". */
  vignette = false;
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
    this.finish = new FinishPass();
    this.composer.addPass(this.finish);
  }

  /** "Bildhelligkeit": linear CSS brightness on the canvas, i.e. on the whole image incl. what the browser upscales. */
  setImageBrightness(k: number): void {
    this.renderer.domElement.style.filter = k === 1 ? '' : `brightness(${k})`;
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
    this.renderer.toneMappingExposure = LIGHTS.exposure * this.renderBrightness;
    this.bloom.enabled = this.bloomOn;
    this.bloom.threshold = LIGHTS.bloomThreshold;
    this.bloom.strength = BLOOM.strength * this.bloomStrength;
    this.finish.enabled = this.sharpen || this.vignette;
    this.finish.uniforms.sharpen.value = this.sharpen ? FINISH.sharpen : 0;
    this.finish.uniforms.vignette.value = this.vignette ? FINISH.vignette : 0;
    this.composer.render();
  }
}
