import { allClosures, allDependents, blockedBy } from './chain';
import { capacityBetween, effectiveCapacity } from './capacity';
import { burialCost, costOfDelay } from './cod';
import { compareKeyLists, compareKeys } from './keys';
import { err, ok } from './types';
import type { Buried, FreezeInput, Key, Reason, Result, Solution, ValidBoard } from './types';
import { ticketWeight, weightScale } from './weights';

/**
 * The solver: pure optimum.
 *
 * Choose the set of tickets to keep that (1) fits the effective capacity, (2) contains every must-have, (3) is closed
 * under dependencies, (4) contains nothing that depends on a put-down key, and then, in this order, (5) maximizes the
 * saved cod, (6) buries fewer tickets, (7) buries less effort, (8) has the alphabetically smaller list of buried keys.
 *
 * Levels 5-7 are folded into one integer weight per ticket (see `weights.ts`), and the search is branch and bound over
 * dependency closures with an integer fractional-knapsack bound. Level 8 is decided at the leaves.
 * Recursion depth is at most the number of tickets.
 */

/** Solves for a capacity given in points. Used directly by tests (P6) and by `solveFreeze`. */
export function solveWithCapacity(board: ValidBoard, capacity: number, marginPct: number): Result<Solution> {
  const effective = effectiveCapacity(capacity, marginPct);
  if (!effective.ok) return err(effective.error);
  return ok(solveCore(board, capacity, marginPct, effective.value));
}

/** Capacity between `now` and `freezeAt` in the board time zone, then the solution. */
export function solveFreeze(board: ValidBoard, freeze: FreezeInput): Result<Solution> {
  const capacity = capacityBetween(board.people, board.timeZone, freeze.now, freeze.freezeAt);
  if (!capacity.ok) return err(capacity.error);
  return solveWithCapacity(board, capacity.value, freeze.marginPct);
}

function solveCore(board: ValidBoard, capacity: number, marginPct: number, effective: number): Solution {
  // Everything below works on tickets sorted by key, so the result cannot depend on the input order.
  const tickets = [...board.tickets].sort((a, b) => compareKeys(a.key, b.key));
  const n = tickets.length;
  const indexOf = new Map<Key, number>();
  tickets.forEach((t, i) => indexOf.set(t.key, i));

  const closures = allClosures(tickets);
  const dependents = allDependents(tickets);
  const blocked = blockedBy(tickets, board.wontDo);
  const cod = tickets.map((t) => costOfDelay(t));
  const effort = tickets.map((t) => t.effort);
  const totalEffort = effort.reduce((s, e) => s + e, 0);
  const scale = weightScale(n, totalEffort);
  const weight = tickets.map((t, i) => ticketWeight(scale, cod[i] as number, effort[i] as number));

  // Must-haves and everything they need are kept no matter what.
  const inBase: boolean[] = new Array<boolean>(n).fill(false);
  const blockedMustHaves: { key: Key; putDownKey: Key }[] = [];
  for (const t of tickets) {
    if (!t.mustHave) continue;
    const putDownKey = blocked.get(t.key);
    if (putDownKey !== undefined) blockedMustHaves.push({ key: t.key, putDownKey });
    for (const member of closures.get(t.key) ?? []) inBase[indexOf.get(member) as number] = true;
  }
  let needed = 0;
  for (let i = 0; i < n; i++) if (inBase[i]) needed += effort[i] as number;

  if (blockedMustHaves.length > 0 || needed > effective) {
    return { status: 'impossible', capacity, effectiveCapacity: effective, marginPct, needed, blockedMustHaves };
  }

  // Candidates: tickets that are not forced in and can be kept at all, ordered by weight per point of effort.
  const candidates: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!inBase[i] && !blocked.has((tickets[i] as { key: Key }).key)) candidates.push(i);
  }
  candidates.sort((a, b) => {
    const ea = effort[a] as number;
    const eb = effort[b] as number;
    if (ea === 0 && eb === 0) return a - b;
    if (ea === 0) return -1;
    if (eb === 0) return 1;
    const left = (weight[a] as number) * eb;
    const right = (weight[b] as number) * ea;
    return left === right ? a - b : left > right ? -1 : 1;
  });
  const m = candidates.length;
  const position = new Map<number, number>();
  candidates.forEach((ticketIndex, p) => position.set(ticketIndex, p));

  // For each candidate position: the positions of its closure (including itself) and of its dependents.
  const closureAt: number[][] = [];
  const dependentsAt: number[][] = [];
  for (let p = 0; p < m; p++) {
    const key = (tickets[candidates[p] as number] as { key: Key }).key;
    const own: number[] = [];
    for (const member of closures.get(key) ?? []) {
      const at = position.get(indexOf.get(member) as number);
      if (at !== undefined) own.push(at);
    }
    closureAt.push(own);
    const deps: number[] = [];
    for (const member of dependents.get(key) ?? []) {
      const at = position.get(indexOf.get(member) as number);
      if (at !== undefined) deps.push(at);
    }
    dependentsAt.push(deps);
  }

  const candEffort = candidates.map((i) => effort[i] as number);
  const candWeight = candidates.map((i) => weight[i] as number);

  // Search state. 0 = undecided, 1 = kept, 2 = buried.
  const status = new Int8Array(m);
  let baseWeight = 0;
  for (let i = 0; i < n; i++) if (inBase[i]) baseWeight += weight[i] as number;
  // The kept effort never exceeds the total effort, so a larger capacity is clamped for the bound's arithmetic.
  const room = Math.min(effective, totalEffort) - needed;

  let bestWeight = -1;
  let bestKept: boolean[] = [];
  let bestBuried: Key[] = [];

  function leaf(weightNow: number, includeUndecided: boolean): void {
    if (weightNow < bestWeight) return;
    const kept = inBase.slice();
    for (let p = 0; p < m; p++) {
      const s = status[p] as number;
      if (s === 1 || (includeUndecided && s === 0)) kept[candidates[p] as number] = true;
    }
    const buried: Key[] = [];
    for (let i = 0; i < n; i++) if (!kept[i]) buried.push((tickets[i] as { key: Key }).key);
    if (weightNow > bestWeight || compareKeyLists(buried, bestBuried) < 0) {
      bestWeight = weightNow;
      bestKept = kept;
      bestBuried = buried;
    }
  }

  function search(from: number, current: number, left: number): void {
    let pos = from;
    while (pos < m && status[pos] !== 0) pos++;

    // Fractional-knapsack bound over the undecided candidates, ignoring precedence (a valid upper bound).
    let bound = current;
    let free = left;
    let everythingFits = true;
    for (let p = pos; p < m; p++) {
      if (status[p] !== 0) continue;
      const e = candEffort[p] as number;
      const w = candWeight[p] as number;
      if (e <= free) {
        bound += w;
        free -= e;
      } else {
        bound += Math.floor((w * free) / e);
        everythingFits = false;
        break;
      }
    }
    if (everythingFits) {
      // Keeping every undecided ticket is feasible: they are not buried, so their dependencies are not either.
      leaf(bound, true);
      return;
    }
    if (bound < bestWeight) return; // strict, so equal-weight alternatives still reach the alphabetical tie-break

    // Branch 1: keep candidate `pos` together with its closure.
    const group = (closureAt[pos] as number[]).filter((q) => status[q] === 0);
    let addEffort = 0;
    let addWeight = 0;
    for (const q of group) {
      addEffort += candEffort[q] as number;
      addWeight += candWeight[q] as number;
    }
    if (addEffort <= left) {
      for (const q of group) status[q] = 1;
      search(pos + 1, current + addWeight, left - addEffort);
      for (const q of group) status[q] = 0;
    }

    // Branch 2: bury candidate `pos`; everything that depends on it is buried too (the cascade).
    const buriedNow: number[] = [];
    for (const q of [pos, ...(dependentsAt[pos] as number[])]) {
      if (status[q] === 0) {
        status[q] = 2;
        buriedNow.push(q);
      }
    }
    search(pos + 1, current, left);
    for (const q of buriedNow) status[q] = 0;
  }

  search(0, baseWeight, room);

  // ---- Assemble the answer ---------------------------------------------------------------------------------------
  const keptKeys: Key[] = [];
  const buriedList: Buried[] = [];
  const keptSet = new Set<Key>();
  let keptEffort = 0;
  let savedCod = 0;
  tickets.forEach((t, i) => {
    if (bestKept[i]) {
      keptKeys.push(t.key);
      keptSet.add(t.key);
      keptEffort += t.effort;
      savedCod += cod[i] as number;
    }
  });
  const left = effective - keptEffort;
  const zombies: Key[] = [];
  let buriedEffort = 0;
  let buriedCod = 0;
  tickets.forEach((t, i) => {
    if (bestKept[i]) return;
    buriedEffort += t.effort;
    buriedCod += cod[i] as number;
    const isZombie = t.past + 1 >= board.zombieThreshold;
    if (isZombie) zombies.push(t.key);
    buriedList.push({
      key: t.key,
      reason: reasonFor(t.key, t.dependsOn, t.effort, left, blocked, keptSet, indexOf),
      cod: cod[i] as number,
      burialCost: burialCost(t, board.nextReleaseWeeks),
      isZombie,
    });
  });

  return {
    status: 'ok',
    capacity,
    effectiveCapacity: effective,
    marginPct,
    kept: keptKeys,
    buried: buriedList,
    keptEffort,
    savedCod,
    buriedEffort,
    buriedCod,
    zombies,
  };
}

/**
 * Why a ticket is buried, in this order: it can never be kept (it depends on a put-down key); a dependency is buried;
 * otherwise it does not fit in what is left. In the last case the ticket would have been kept if it fit, because
 * keeping it raises the weight, so `needed > left` always holds there.
 */
function reasonFor(
  key: Key,
  dependsOn: readonly Key[],
  effort: number,
  left: number,
  blocked: ReadonlyMap<Key, Key>,
  keptSet: ReadonlySet<Key>,
  indexOf: ReadonlyMap<Key, number>,
): Reason {
  const putDownKey = blocked.get(key);
  if (putDownKey !== undefined) return { kind: 'blocked-by-put-down', putDownKey };
  const buriedDeps = [...new Set(dependsOn)].filter((d) => indexOf.has(d) && !keptSet.has(d)).sort(compareKeys);
  if (buriedDeps.length > 0) return { kind: 'depends-on-buried', buriedDependencies: buriedDeps };
  return { kind: 'no-room', needed: effort, left };
}
