/**
 * MurmurHash3, x86 variant, 32 bit (Austin Appleby, public domain), over a sequence of 32-bit words.
 *
 * Every block of the algorithm is one whole word, so there is no tail: the result equals `MurmurHash3_x86_32` of the little-endian bytes of
 * the words, and the published test vectors apply (`tests/engine/fog.test.ts` checks some). Integer arithmetic only: `Math.imul`, shifts, xor.
 *
 * The state is exposed in three steps so a caller that hashes many messages with the same beginning (a ticket key, then each night) can
 * keep the state after the common words and add only the last one.
 */
const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

function rotl32(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

/** The starting state for a seed (any integer; only its low 32 bits count). */
export function hashStart(seed: number): number {
  return seed | 0;
}

/** Mixes one 32-bit word into the state. */
export function hashStep(state: number, word: number): number {
  let k = Math.imul(word | 0, C1);
  k = rotl32(k, 15);
  k = Math.imul(k, C2);
  let h = state ^ k;
  h = rotl32(h, 13);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** The final mix, given the number of words that went in. Returns an unsigned 32-bit integer. */
export function hashFinish(state: number, wordCount: number): number {
  let h = state ^ Math.imul(wordCount, 4);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The hash of a whole sequence of words. */
export function murmur3Words(seed: number, words: readonly number[]): number {
  let state = hashStart(seed);
  for (const word of words) state = hashStep(state, word);
  return hashFinish(state, words.length);
}
