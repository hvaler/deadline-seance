import type { Board, Key } from '../../src/engine/types';

/**
 * Small reference implementations used by the tests to check the engine's answers. They are written separately from
 * `src/engine/chain.ts` on purpose, so a bug there cannot hide itself.
 */

/** Keys in the chain of `key` (itself included), skipping put-down keys. */
export function chainOf(board: Board, key: Key): Set<Key> {
  const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
  const seen = new Set<Key>();
  const todo = [key];
  while (todo.length > 0) {
    const k = todo.pop() as Key;
    if (seen.has(k) || !byKey.has(k)) continue;
    seen.add(k);
    for (const d of byKey.get(k)?.dependsOn ?? []) todo.push(d);
  }
  return seen;
}

/** Smallest put-down key reached from the chain of `key`, if any. */
export function reachedPutDown(board: Board, key: Key): Key | undefined {
  const wont = new Set(board.wontDo);
  const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
  let smallest: Key | undefined;
  for (const k of chainOf(board, key)) {
    for (const d of byKey.get(k)?.dependsOn ?? []) {
      if (wont.has(d) && (smallest === undefined || d < smallest)) smallest = d;
    }
  }
  return smallest;
}

/** Effort of the union of the chains of every must-have: what the freeze needs at the very least. */
export function mustHaveNeeded(board: Board): number {
  const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
  const needed = new Set<Key>();
  for (const t of board.tickets) {
    if (t.mustHave) for (const k of chainOf(board, t.key)) needed.add(k);
  }
  let sum = 0;
  for (const k of needed) sum += byKey.get(k)?.effort ?? 0;
  return sum;
}

/** Must-haves that can never be kept because their chain reaches a put-down key, sorted by key. */
export function blockedMustHaves(board: Board): { key: Key; putDownKey: Key }[] {
  const out: { key: Key; putDownKey: Key }[] = [];
  for (const t of board.tickets) {
    if (!t.mustHave) continue;
    const putDownKey = reachedPutDown(board, t.key);
    if (putDownKey !== undefined) out.push({ key: t.key, putDownKey });
  }
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** floor(capacity x (100 - margin) / 100), computed here independently of the engine. */
export function withMargin(capacity: number, marginPct: number): number {
  return Math.floor((capacity * (100 - marginPct)) / 100);
}
