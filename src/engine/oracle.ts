import { costOfDelay } from './cod';
import type { Key, Ticket, ValidBoard } from './types';

/**
 * Brute-force reference for tests. It tries every subset of tickets, keeps the ones that satisfy the rule, and ranks
 * them by the rule text. It is written independently of the solver: it shares no closure, comparison or weight code
 * with it, so agreement between the two is evidence and not an echo. Not exported from `index.ts`.
 *
 * The rule, in order:
 *   a kept set must (1) fit the capacity, (2) contain every must-have, (3) contain, for each kept ticket, all of its
 *   dependencies, and (4) contain no ticket that depends on a put-down key.
 *   Among those sets prefer: more saved cod; then fewer buried tickets; then less buried effort; then the
 *   alphabetically smaller list of buried keys (lists of equal length compared element by element).
 */

export const ORACLE_MAX_TICKETS = 16;

export type OracleResult =
  | { readonly status: 'ok'; readonly kept: readonly Key[]; readonly savedCod: number; readonly keptEffort: number }
  | { readonly status: 'impossible' };

interface Candidate {
  readonly kept: Key[];
  readonly buried: Key[];
  readonly savedCod: number;
  readonly keptEffort: number;
  readonly buriedEffort: number;
}

/** True when `a` is strictly better than `b` by the ranking above. */
function better(a: Candidate, b: Candidate): boolean {
  if (a.savedCod !== b.savedCod) return a.savedCod > b.savedCod;
  if (a.buried.length !== b.buried.length) return a.buried.length < b.buried.length;
  if (a.buriedEffort !== b.buriedEffort) return a.buriedEffort < b.buriedEffort;
  for (let i = 0; i < a.buried.length; i++) {
    const x = a.buried[i] as Key;
    const y = b.buried[i] as Key;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * @param effectiveCapacity capacity after the margin (an integer).
 * @throws Error when the board has more than 16 tickets.
 */
export function oracleSolve(board: ValidBoard, effectiveCapacity: number): OracleResult {
  const tickets: Ticket[] = [...board.tickets].sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  const n = tickets.length;
  if (n > ORACLE_MAX_TICKETS) throw new Error(`oracle: ${n} tickets is more than ${ORACLE_MAX_TICKETS}`);

  const position = new Map<Key, number>();
  tickets.forEach((t, i) => position.set(t.key, i));
  const putDown = new Set<Key>(board.wontDo);

  // dependency bit masks (direct dependencies only; closure is enforced by checking every kept ticket)
  const depMask: number[] = [];
  const forbidden: boolean[] = [];
  tickets.forEach((t, i) => {
    let mask = 0;
    let bad = false;
    for (const d of t.dependsOn) {
      const at = position.get(d);
      if (at !== undefined) mask |= 1 << at;
      else if (putDown.has(d)) bad = true;
    }
    depMask[i] = mask;
    forbidden[i] = bad;
  });
  let mustMask = 0;
  tickets.forEach((t, i) => {
    if (t.mustHave) mustMask |= 1 << i;
  });
  const cods = tickets.map((t) => costOfDelay(t));

  let best: Candidate | null = null;
  const total = 1 << n;
  for (let mask = 0; mask < total; mask++) {
    if ((mask & mustMask) !== mustMask) continue;
    let ok = true;
    let effort = 0;
    for (let i = 0; i < n && ok; i++) {
      if ((mask & (1 << i)) === 0) continue;
      if (forbidden[i]) ok = false;
      else if (((depMask[i] as number) & mask) !== depMask[i]) ok = false;
      else effort += (tickets[i] as Ticket).effort;
    }
    if (!ok || effort > effectiveCapacity) continue;

    const kept: Key[] = [];
    const buried: Key[] = [];
    let savedCod = 0;
    let buriedEffort = 0;
    for (let i = 0; i < n; i++) {
      const t = tickets[i] as Ticket;
      if ((mask & (1 << i)) !== 0) {
        kept.push(t.key);
        savedCod += cods[i] as number;
      } else {
        buried.push(t.key);
        buriedEffort += t.effort;
      }
    }
    const candidate: Candidate = { kept, buried, savedCod, keptEffort: effort, buriedEffort };
    if (best === null || better(candidate, best)) best = candidate;
  }

  if (best === null) return { status: 'impossible' };
  return { status: 'ok', kept: best.kept, savedCod: best.savedCod, keptEffort: best.keptEffort };
}
