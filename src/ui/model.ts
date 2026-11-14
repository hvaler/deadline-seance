import { validateBoard } from '../engine/index';
import type {
  Diff,
  EngineError,
  FreezeInput,
  ImpossibleSolution,
  Person,
  Solution,
  SolvedSolution,
  ValidBoard,
} from '../engine/index';
import { CANDLE_STEPS, LAST_CANDLE_STEP } from './candle-steps';
import { SAMPLE_NOW, sampleBoard } from './sample-board';

/**
 * The shape of the UI state: one plain value (no functions, no DOM nodes, no class instances) changed only by the reducer
 * (`state.ts`). Everything the screen shows is derived from it by calling the engine (`derive.ts`).
 */

export type Action =
  | { readonly type: 'candle/set'; readonly step: number }
  | { readonly type: 'reserve/set'; readonly pct: number }
  | { readonly type: 'survivor/toggle'; readonly name: string }
  | { readonly type: 'tombstone/exhume'; readonly key: string }
  | { readonly type: 'tombstone/resurrect'; readonly key: string }
  | { readonly type: 'tombstone/put-down'; readonly key: string }
  | { readonly type: 'sound/set'; readonly on: boolean }
  | { readonly type: 'board/reset' }
  /** Only the guided tour sends this, to put the user's own state back exactly. No control of the page does. */
  | { readonly type: 'state/restore'; readonly state: AppState };

export type Subject =
  | { readonly kind: 'candle'; readonly from: number; readonly to: number }
  | { readonly kind: 'reserve'; readonly from: number; readonly to: number }
  | { readonly kind: 'survivor'; readonly name: string; readonly away: boolean }
  | { readonly kind: 'exhume' | 'resurrect' | 'put-down'; readonly key: string }
  | { readonly kind: 'reset' };

/** What two solutions have in common, for the change note. */
export type Comparison =
  /** The engine's diff of two solved freezes. */
  | { readonly kind: 'diff'; readonly before: SolvedSolution; readonly after: SolvedSolution; readonly diff: Diff }
  /** One side (or both) is an impossible freeze: `diffSolutions` has nothing to compare. */
  | { readonly kind: 'not-comparable'; readonly before: Solution; readonly after: Solution }
  /** Both are solved but come from boards that no longer share every ticket (a reset after a put down): only the totals are comparable. */
  | { readonly kind: 'no-diff'; readonly before: SolvedSolution; readonly after: SolvedSolution };

export type Change =
  | { readonly kind: 'none' }
  | { readonly kind: 'done'; readonly subject: Subject; readonly comparison: Comparison }
  /** An exhume the engine refused because it would make the freeze impossible. The board is untouched. */
  | { readonly kind: 'rejected'; readonly subject: Subject; readonly impossible: ImpossibleSolution }
  /** An action the engine refused as invalid (unknown key, not a zombie). The board is untouched. */
  | { readonly kind: 'refused'; readonly subject: Subject; readonly error: EngineError };

export interface AppState {
  /** The board as loaded, to go back to on reset. */
  readonly home: ValidBoard;
  /** The full team; exhumes and put-downs applied. */
  readonly board: ValidBoard;
  /** 0 to 10, an index into `CANDLE_STEPS`. */
  readonly candle: number;
  /** 0, 5, ..., 30. */
  readonly marginPct: number;
  /** Names sent away, sorted. */
  readonly away: readonly string[];
  readonly sound: boolean;
  /** What the last action did. */
  readonly change: Change;
}

export const RESERVE_STEPS: readonly number[] = [0, 5, 10, 15, 20, 25, 30];

export function initialStateFor(board: ValidBoard): AppState {
  return { home: board, board, candle: LAST_CANDLE_STEP, marginPct: 0, away: [], sound: false, change: { kind: 'none' } };
}

/** The built-in sample board in its initial state: Friday 18:00, no reserve, nobody away, sound off. */
export function initialState(): AppState {
  const r = validateBoard(sampleBoard());
  if (!r.ok) throw new Error(`the sample board is invalid: ${JSON.stringify(r.error)}`);
  return initialStateFor(r.value);
}

// ---- what the engine is asked ------------------------------------------------------------------------------------------

export function presentPeople(state: AppState): readonly Person[] {
  const gone = new Set(state.away);
  return state.board.people.filter((p) => !gone.has(p.name));
}

/** The board as the engine should see it: the full board with only the survivors who are here. */
export function boardFor(state: AppState): ValidBoard {
  const r = validateBoard({ ...state.board, people: presentPeople(state) });
  if (!r.ok) throw new Error(`the board lost its validity: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** `now` is a constant of the sample, never the system clock. */
export function freezeFor(state: AppState): FreezeInput {
  const step = CANDLE_STEPS[state.candle];
  if (step === undefined) throw new RangeError(`candle step ${state.candle} does not exist`);
  return { now: SAMPLE_NOW, freezeAt: step.freezeAt, marginPct: state.marginPct };
}
