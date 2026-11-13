import { compareKeys } from './keys';
import type { Key, Ticket } from './types';

/** Distinct dependencies of a ticket, sorted, so every traversal is independent of input order. */
function sortedDeps(ticket: Ticket): Key[] {
  return [...new Set(ticket.dependsOn)].sort(compareKeys);
}

/**
 * Closure of `start`: the ticket plus everything it depends on, in chain. Edges to keys that are not in `byKey`
 * (put-down keys) are ignored. Iterative, so a long chain cannot overflow the stack. Safe on cyclic input.
 */
export function closureOf(start: Key, byKey: ReadonlyMap<Key, Ticket>): Set<Key> {
  const seen = new Set<Key>();
  if (!byKey.has(start)) return seen;
  const stack: Key[] = [start];
  seen.add(start);
  while (stack.length > 0) {
    const key = stack.pop() as Key;
    const ticket = byKey.get(key);
    if (!ticket) continue;
    for (const dep of ticket.dependsOn) {
      if (byKey.has(dep) && !seen.has(dep)) {
        seen.add(dep);
        stack.push(dep);
      }
    }
  }
  return seen;
}

/** Closure of every ticket, keyed by ticket key. */
export function allClosures(tickets: readonly Ticket[]): Map<Key, Set<Key>> {
  const byKey = indexByKey(tickets);
  const out = new Map<Key, Set<Key>>();
  for (const t of tickets) out.set(t.key, closureOf(t.key, byKey));
  return out;
}

/** For each key, the other tickets whose closure contains it (its dependents, in chain). */
export function allDependents(tickets: readonly Ticket[]): Map<Key, Set<Key>> {
  const out = new Map<Key, Set<Key>>();
  for (const t of tickets) out.set(t.key, new Set());
  for (const [key, closure] of allClosures(tickets)) {
    for (const member of closure) {
      if (member !== key) out.get(member)?.add(key);
    }
  }
  return out;
}

export function indexByKey(tickets: readonly Ticket[]): Map<Key, Ticket> {
  const out = new Map<Key, Ticket>();
  for (const t of tickets) if (!out.has(t.key)) out.set(t.key, t);
  return out;
}

/**
 * Smallest put-down key reachable from the closure of each ticket that reaches at least one. Tickets that do not
 * reach a put-down key are absent from the map.
 */
export function blockedBy(tickets: readonly Ticket[], wontDo: readonly Key[]): Map<Key, Key> {
  const wont = new Set(wontDo);
  const byKey = indexByKey(tickets);
  const out = new Map<Key, Key>();
  for (const t of tickets) {
    let smallest: Key | undefined;
    for (const member of closureOf(t.key, byKey)) {
      for (const dep of byKey.get(member)?.dependsOn ?? []) {
        if (wont.has(dep) && (smallest === undefined || compareKeys(dep, smallest) < 0)) smallest = dep;
      }
    }
    if (smallest !== undefined) out.set(t.key, smallest);
  }
  return out;
}

/**
 * Dependency cycles among `tickets` (self-loops are not reported here). Each cycle is rotated to start at its smallest
 * key and reported once. Iterative depth-first search over sorted keys and sorted edges, so the result does not depend
 * on input order.
 */
export function findCycles(tickets: readonly Ticket[]): Key[][] {
  const byKey = indexByKey(tickets);
  const keys = [...byKey.keys()].sort(compareKeys);
  const state = new Map<Key, 0 | 1 | 2>(); // 0/undefined = new, 1 = on stack, 2 = done
  const found = new Map<string, Key[]>();

  for (const root of keys) {
    if (state.get(root)) continue;
    const path: Key[] = [];
    const next: number[] = [];
    path.push(root);
    next.push(0);
    state.set(root, 1);
    while (path.length > 0) {
      const top = path[path.length - 1] as Key;
      const deps = sortedDeps(byKey.get(top) as Ticket).filter((d) => byKey.has(d) && d !== top);
      const i = next[next.length - 1] as number;
      if (i >= deps.length) {
        state.set(top, 2);
        path.pop();
        next.pop();
        continue;
      }
      next[next.length - 1] = i + 1;
      const dep = deps[i] as Key;
      const s = state.get(dep);
      if (s === 1) {
        const cycle = path.slice(path.indexOf(dep));
        const rotated = rotateToSmallest(cycle);
        found.set(rotated.join('\u0000'), rotated);
      } else if (!s) {
        state.set(dep, 1);
        path.push(dep);
        next.push(0);
      }
    }
  }
  return [...found.values()].sort((a, b) => compareKeys(a.join('\u0000'), b.join('\u0000')));
}

function rotateToSmallest(cycle: readonly Key[]): Key[] {
  let at = 0;
  for (let i = 1; i < cycle.length; i++) {
    if (compareKeys(cycle[i] as Key, cycle[at] as Key) < 0) at = i;
  }
  return [...cycle.slice(at), ...cycle.slice(0, at)];
}
