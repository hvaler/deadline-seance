import type { Key } from '../../src/engine/types';

/**
 * An independent implementation of the fog, written from `.kiro/specs/fog/design.md` section 2 and nothing else: its own hash with `BigInt`
 * and explicit 32-bit masks (no `Math.imul`, no shared code with `src/engine/hash.ts`), and a plain loop that hashes again for every ticket
 * and every night. The engine must agree with it exactly.
 */
const MASK = 0xffffffffn;

function rotl(x: bigint, r: bigint): bigint {
  return ((x << r) | (x >> (32n - r))) & MASK;
}

function mul(a: bigint, b: bigint): bigint {
  return (a * b) & MASK;
}

/** MurmurHash3 x86 32-bit over whole 32-bit words (each word is one 4-byte little-endian block). */
export function refMurmur(seed: number, words: readonly number[]): number {
  let h = BigInt(seed) & MASK;
  for (const word of words) {
    let k = BigInt(word) & MASK;
    k = mul(k, 0xcc9e2d51n);
    k = rotl(k, 15n);
    k = mul(k, 0x1b873593n);
    h ^= k;
    h = rotl(h, 13n);
    h = (mul(h, 5n) + 0xe6546b64n) & MASK;
  }
  h ^= BigInt(words.length * 4) & MASK;
  h ^= h >> 16n;
  h = mul(h, 0x85ebca6bn);
  h ^= h >> 13n;
  h = mul(h, 0xc2b2ae35n);
  h ^= h >> 16n;
  return Number(h & MASK);
}

/** The words of a message: one per UTF-16 code unit of the key, then the night. */
export function refWords(key: Key, night: number): number[] {
  const words: number[] = [];
  for (let i = 0; i < key.length; i++) words.push(key.charCodeAt(i));
  words.push(night);
  return words;
}

export function refFactor(seed: number, key: Key, night: number): number {
  return 80 + (refMurmur(seed, refWords(key, night)) % 71);
}

export interface RefTicket {
  readonly key: Key;
  readonly effort: number;
}

/** `ceil(effort * f / 100)` for integers, written with a remainder instead of the engine's `floor((e*f + 99) / 100)`. */
export function refCeilPct(effort: number, f: number): number {
  const product = effort * f;
  return Math.trunc(product / 100) + (product % 100 === 0 ? 0 : 1);
}

export interface RefFog {
  readonly nights: number;
  readonly holds: number;
  readonly pct: number;
}

/** The chance of a kept set (a set of keys, each counted once) against a capacity. */
export function refSimulate(seed: number, tickets: readonly RefTicket[], kept: readonly Key[], capacity: number): RefFog {
  const chosen = new Set(kept);
  let holds = 0;
  for (let night = 0; night < 1000; night++) {
    let sum = 0;
    for (const t of tickets) {
      if (chosen.has(t.key)) sum += refCeilPct(t.effort, refFactor(seed, t.key, night));
    }
    if (sum <= capacity) holds++;
  }
  return { nights: 1000, holds, pct: Math.floor((100 * holds) / 1000) };
}
