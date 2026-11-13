import { compareKeys } from './keys';
import { solveFreeze } from './solver';
import { err, ok } from './types';
import type {
  Diff,
  DiffEntry,
  FreezeInput,
  ImpossibleSolution,
  Key,
  Result,
  Solution,
  SolvedSolution,
  ValidBoard,
} from './types';

/**
 * What changed between two solutions of the same board (same tickets and costs, a different candle, team,
 * must-have or put-down state).
 *
 * `raised`: buried before, kept after. `sunk`: kept before, buried after. A solution lists the `cod` of its buried
 * tickets, so a raised ticket takes its cod from `before.buried` and a sunk ticket from `after.buried`.
 * `codDelta = after.savedCod - before.savedCod`, and Σ cod(raised) - Σ cod(sunk) equals it when the costs did not change.
 * Both solutions must be solved; an impossible freeze has no cut list to compare.
 */
export function diffSolutions(before: Solution, after: Solution): Result<Diff> {
  if (before.status !== 'ok' || after.status !== 'ok') return err({ code: 'solution-impossible' });

  const keptBefore = new Set(before.kept);
  const keptAfter = new Set(after.kept);
  const buriedBefore = new Map(before.buried.map((b) => [b.key, b.cod] as const));
  const buriedAfter = new Map(after.buried.map((b) => [b.key, b.cod] as const));

  const raised: DiffEntry[] = [];
  for (const key of after.kept) {
    if (keptBefore.has(key)) continue;
    const cod = buriedBefore.get(key);
    if (cod === undefined) return err({ code: 'unknown-key', key });
    raised.push({ key, cod });
  }
  const sunk: DiffEntry[] = [];
  for (const key of before.kept) {
    if (keptAfter.has(key)) continue;
    const cod = buriedAfter.get(key);
    if (cod === undefined) return err({ code: 'unknown-key', key });
    sunk.push({ key, cod });
  }
  raised.sort((a, b) => compareKeys(a.key, b.key));
  sunk.sort((a, b) => compareKeys(a.key, b.key));
  return ok({ raised, sunk, codDelta: after.savedCod - before.savedCod });
}

export interface ExhumeApplied {
  readonly kind: 'applied';
  /** The board with the ticket now a must-have. */
  readonly board: ValidBoard;
  readonly before: SolvedSolution;
  readonly after: SolvedSolution;
  readonly diff: Diff;
}

export interface ExhumeRejected {
  readonly kind: 'rejected';
  /** Why exhuming would break the freeze: the numbers of the new, impossible, solution. The caller keeps its board. */
  readonly impossible: ImpossibleSolution;
}

export type ExhumeOutcome = ExhumeApplied | ExhumeRejected;

/**
 * Exhume a tombstone: the ticket becomes a must-have and the rule re-solves. The result says what rose and what sank
 * in exchange. If that would make the freeze impossible, nothing is applied and the numbers are returned.
 * The input board is never changed.
 */
export function exhume(board: ValidBoard, freeze: FreezeInput, key: Key): Result<ExhumeOutcome> {
  if (!board.tickets.some((t) => t.key === key)) return err({ code: 'unknown-key', key });

  const before = solveFreeze(board, freeze);
  if (!before.ok) return err(before.error);

  // Making a ticket a must-have keeps the board valid: no key, number or dependency changes.
  const next = { ...board, tickets: board.tickets.map((t) => (t.key === key ? { ...t, mustHave: true } : t)) } as ValidBoard;
  const after = solveFreeze(next, freeze);
  if (!after.ok) return err(after.error);
  if (after.value.status !== 'ok') return ok({ kind: 'rejected', impossible: after.value });
  // An impossible `before` implies an impossible `after`, handled above.
  if (before.value.status !== 'ok') return err({ code: 'solution-impossible' });

  const diff = diffSolutions(before.value, after.value);
  if (!diff.ok) return err(diff.error);
  return ok({ kind: 'applied', board: next, before: before.value, after: after.value, diff: diff.value });
}

/** Resurrecting a zombie is exhuming it. */
export const resurrect = exhume;

export interface PutDownApplied {
  /** The board without the ticket; its key is now in `wontDo`. */
  readonly board: ValidBoard;
  readonly before: SolvedSolution;
  readonly after: SolvedSolution;
  readonly diff: Diff;
}

/**
 * Finish off a zombie: close it as Won't Do and take it off the board, then re-solve. Only a buried zombie can be put
 * down. Tickets that depend on it can never be kept afterwards (they stay buried, reason `blocked-by-put-down`), so
 * the solution does not change. The input board is never changed.
 */
export function putDown(board: ValidBoard, freeze: FreezeInput, key: Key): Result<PutDownApplied> {
  if (!board.tickets.some((t) => t.key === key)) return err({ code: 'unknown-key', key });

  const before = solveFreeze(board, freeze);
  if (!before.ok) return err(before.error);
  if (before.value.status !== 'ok') return err({ code: 'solution-impossible' });

  const entry = before.value.buried.find((b) => b.key === key);
  if (entry === undefined || !entry.isZombie) return err({ code: 'not-a-zombie', key });

  // The key moves from `tickets` to `wontDo`; dependencies on it stay valid because `wontDo` keys are known keys.
  const next = {
    ...board,
    tickets: board.tickets.filter((t) => t.key !== key),
    wontDo: [...board.wontDo, key].sort(compareKeys),
  } as ValidBoard;
  const after = solveFreeze(next, freeze);
  if (!after.ok) return err(after.error);
  if (after.value.status !== 'ok') return err({ code: 'solution-impossible' });

  const diff = diffSolutions(before.value, after.value);
  if (!diff.ok) return err(diff.error);
  return ok({ board: next, before: before.value, after: after.value, diff: diff.value });
}
