import { fogCurve, fogTable } from '../engine/index';
import type { FogPoint, FogTable, ValidBoard } from '../engine/index';
import type { AppState } from './model';
import { boardFor, freezeFor } from './model';

/**
 * The fog of a state, with two caches. Neither can answer for another board: both are keyed by the identity of the full board (a new board
 * object whenever the tickets change), and the curve also by the candle and the people who are away.
 *
 * - The table (what every ticket takes on every night) depends on the board only: hashing happens once per board, never while the candle moves.
 * - The curve depends on the board, the candle and the team, and not on the reserve: it holds the chance at every reserve step, so moving the
 *   reserve slider only moves the highlight and never computes anything.
 */
const MAX_PER_BOARD = 64;
const tables = new WeakMap<ValidBoard, FogTable>();
const curves = new WeakMap<ValidBoard, Map<string, readonly FogPoint[]>>();

function tableFor(board: ValidBoard): FogTable {
  let table = tables.get(board);
  if (table === undefined) {
    table = fogTable(board);
    tables.set(board, table);
  }
  return table;
}

function curveKey(state: AppState): string {
  return `${state.candle}|${state.away.join(',')}`;
}

/** The chance at each reserve step for the state's candle and team; null only if the engine returned an error (it cannot for a valid state). */
export function curveFor(state: AppState): readonly FogPoint[] | null {
  let perBoard = curves.get(state.board);
  if (perBoard === undefined) {
    perBoard = new Map();
    curves.set(state.board, perBoard);
  }
  const key = curveKey(state);
  const hit = perBoard.get(key);
  if (hit !== undefined) return hit;
  const { now, freezeAt } = freezeFor(state);
  const result = fogCurve(boardFor(state), { now, freezeAt }, tableFor(state.board));
  if (!result.ok) return null;
  if (perBoard.size >= MAX_PER_BOARD) perBoard.clear();
  perBoard.set(key, result.value);
  return result.value;
}
