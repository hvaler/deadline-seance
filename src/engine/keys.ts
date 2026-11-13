import type { Key } from './types';

/** Plain UTF-16 code-unit order. Never locale-dependent, so every machine sorts the same way. */
export function compareKeys(a: Key, b: Key): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorted copy; the input is not mutated. */
export function sortedKeys(keys: Iterable<Key>): Key[] {
  return [...keys].sort(compareKeys);
}

/** Compares two sorted key lists element by element; a shorter prefix sorts first. */
export function compareKeyLists(a: readonly Key[], b: readonly Key[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = compareKeys(a[i] as Key, b[i] as Key);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}
