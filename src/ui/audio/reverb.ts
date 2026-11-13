import type { AudioLike, BufferLike } from './types';

/**
 * Impulse responses and noise, generated in code. No audio file, no `Math.random`: the numbers come from a small integer sequence
 * (a linear congruential generator), so the same context always builds the same sound.
 */

export const IMPULSE_SECONDS = 1.2;
export const NOISE_SECONDS = 0.25;

/** The next state of the generator, and a sample in -1..1 made from it. */
function step(seed: number): { seed: number; sample: number } {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return { seed: next, sample: (next / 0xffffffff) * 2 - 1 };
}

function fill(data: Float32Array, startSeed: number, shape: (position: number) => number): void {
  let seed = startSeed;
  for (let i = 0; i < data.length; i++) {
    const s = step(seed);
    seed = s.seed;
    data[i] = s.sample * shape(i / data.length);
  }
}

/** A short stereo room: noise that fades away smoothly, with a different sequence on each side. */
export function makeImpulse(ctx: AudioLike, seconds: number = IMPULSE_SECONDS): BufferLike {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  fill(buffer.getChannelData(0), 12345, (p) => (1 - p) ** 3);
  fill(buffer.getChannelData(1), 67890, (p) => (1 - p) ** 3);
  return buffer;
}

/** A burst of mono noise for the crack and the soil, with a short fade at the end so it does not click. */
export function makeNoise(ctx: AudioLike, seconds: number = NOISE_SECONDS): BufferLike {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  fill(buffer.getChannelData(0), 424242, (p) => (p > 0.9 ? (1 - p) * 10 : 1));
  return buffer;
}
