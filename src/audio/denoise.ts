import type { RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import workletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import wasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import simdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

let wasm: Promise<ArrayBuffer> | null = null;
const loaded = new WeakSet<BaseAudioContext>();

/**
 * RNNoise as an AudioWorklet: a small neural net that keeps speech and drops the rest, including
 * keyboard clicks and fans, which the browser's own suppression mostly lets through. Expects 48 kHz.
 * Library and ~150 kB of wasm are only fetched when someone actually uses it (and the library's
 * classes extend AudioWorkletNode at import time, which doesn't exist outside the browser).
 */
export async function createDenoiser(ctx: AudioContext): Promise<RnnoiseWorkletNode> {
  const { loadRnnoise, RnnoiseWorkletNode } = await import('@sapphi-red/web-noise-suppressor');
  wasm ??= loadRnnoise({ url: wasmUrl, simdUrl }).catch((e: unknown) => {
    wasm = null;
    throw e;
  });
  const binary = await wasm;
  if (!loaded.has(ctx)) {
    await ctx.audioWorklet.addModule(workletUrl);
    loaded.add(ctx);
  }
  return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary });
}
