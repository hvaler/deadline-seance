import { diffSolutions, solveFreeze } from '../engine/index';
import type { Solution, ValidBoard } from '../engine/index';
import type { AppState, Comparison } from './model';
import { boardFor, freezeFor } from './model';

/**
 * Asking the engine for the cut of a state, with a cache. The cache is keyed by the identity of the full board (a new board object
 * whenever the tickets change) plus candle, reserve and team, so it can never return the answer for another board. It only saves
 * work: it never changes a result.
 */

const MAX_PER_BOARD = 64;
const cache = new WeakMap<ValidBoard, Map<string, Solution>>();

function cacheKey(state: AppState): string {
  return `${state.candle}|${state.marginPct}|${state.away.join(',')}`;
}

/** The engine's solution for the state. Throws only if the engine reports an invalid argument, which the reducer prevents. */
export function solveState(state: AppState): Solution {
  let perBoard = cache.get(state.board);
  if (perBoard === undefined) {
    perBoard = new Map();
    cache.set(state.board, perBoard);
  }
  const key = cacheKey(state);
  const hit = perBoard.get(key);
  if (hit !== undefined) return hit;

  const r = solveFreeze(boardFor(state), freezeFor(state));
  if (!r.ok) throw new Error(`the engine refused the freeze: ${r.error.code}`);
  if (perBoard.size >= MAX_PER_BOARD) perBoard.clear();
  perBoard.set(key, r.value);
  return r.value;
}

/** The diff of two solutions, or the reason there is none. */
export function compareSolutions(before: Solution, after: Solution): Comparison {
  if (before.status !== 'ok' || after.status !== 'ok') return { kind: 'not-comparable', before, after };
  const d = diffSolutions(before, after);
  if (!d.ok) return { kind: 'no-diff', before, after };
  return { kind: 'diff', before, after, diff: d.value };
}

/**
 * What two states have in common in the engine's eyes. Used by the reducer after every action and by the gesture controller
 * (the state at the start of a drag against the state at its end).
 */
export function compareStates(before: AppState, after: AppState): Comparison {
  return compareSolutions(solveState(before), solveState(after));
}
