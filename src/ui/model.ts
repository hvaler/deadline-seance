import { validateBoard } from '../engine/index';
import type {
  DecisionFacts,
  Diff,
  EngineError,
  FreezeInput,
  ImpossibleSolution,
  Person,
  Solution,
  SolvedSolution,
  Ticket,
  ValidBoard,
} from '../engine/index';
import { CANDLE_STEPS, LAST_CANDLE_STEP } from './candle-steps';
import { SAMPLE_NOW, SAMPLE_RELEASE, sampleBoard } from './sample-board';

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
  /** Your tickets from a CSV file replace the board. The board has been built and validated by the engine's importer. */
  | { readonly type: 'board/load'; readonly board: ValidBoard; readonly name: string; readonly release: string | null; readonly skipped: number; readonly warnings: readonly string[]; readonly putDown: readonly Ticket[] }
  /** Back to the board the app started with (the sample), whatever is loaded. */
  | { readonly type: 'board/sample' }
  /** The name of the release, for the certificate and the export. */
  | { readonly type: 'release/set'; readonly name: string }
  /** Only the guided tour sends this, to put the user's own state back exactly. No control of the page does. */
  | { readonly type: 'state/restore'; readonly state: AppState }
  /** A candle or reserve gesture settled: writes its one entry, comparing `from` (the state when the gesture began) with the state now. */
  | { readonly type: 'chronicle/settle'; readonly from: AppState; readonly subject: Subject }
  /** Undoes the entry at index `to` of the chronicle and every later one. `to` = the last index is "Undo". */
  | { readonly type: 'chronicle/undo'; readonly to: number }
  /** Only the guided tour sends this: the inner action runs, and the chronicle is not written. */
  | { readonly type: 'tour/step'; readonly action: Action };

export type Subject =
  | { readonly kind: 'candle'; readonly from: number; readonly to: number }
  | { readonly kind: 'reserve'; readonly from: number; readonly to: number }
  | { readonly kind: 'survivor'; readonly name: string; readonly away: boolean }
  | { readonly kind: 'exhume' | 'resurrect' | 'put-down'; readonly key: string }
  | { readonly kind: 'reset'; readonly yours?: boolean }
  | { readonly kind: 'load'; readonly name: string; readonly count: number; readonly skipped: number }
  | { readonly kind: 'sample' };

/** What two solutions have in common, for the change note. */
export type Comparison =
  /** The engine's diff of two solved freezes. */
  | { readonly kind: 'diff'; readonly before: SolvedSolution; readonly after: SolvedSolution; readonly diff: Diff }
  /** One side (or both) is an impossible freeze: `diffSolutions` has nothing to compare. */
  | { readonly kind: 'not-comparable'; readonly before: Solution; readonly after: Solution }
  /** Both are solved but come from boards that no longer share every ticket (a reset after a put down): only the totals are comparable. */
  | { readonly kind: 'no-diff'; readonly before: SolvedSolution; readonly after: SolvedSolution }
  /** A different board was loaded (a file, or the sample again): nothing to compare, even if some keys coincide. */
  | { readonly kind: 'new-board' };

export type Change =
  | { readonly kind: 'none' }
  | { readonly kind: 'done'; readonly subject: Subject; readonly comparison: Comparison }
  /** An exhume the engine refused because it would make the freeze impossible. The board is untouched. */
  | { readonly kind: 'rejected'; readonly subject: Subject; readonly impossible: ImpossibleSolution }
  /** An action the engine refused as invalid (unknown key, not a zombie). The board is untouched. */
  | { readonly kind: 'refused'; readonly subject: Subject; readonly error: EngineError };

/** Where the loaded board came from. */
export type Source =
  | { readonly kind: 'built-in' }
  | {
      readonly kind: 'file';
      readonly name: string;
      readonly skipped: number;
      readonly warnings: readonly string[];
      /** The tickets the file closed as Won't Do, with their data: they are not on the board, and the export writes them back. */
      readonly putDown: readonly Ticket[];
    };

/** The most entries the chronicle keeps. The 51st decision drops the oldest. */
export const CHRONICLE_CAP = 50;
/** One decision of the night. */
export interface Entry {
  /** Its number: the decisions dropped by the cap plus its place, plus one, when it was written. It never changes. */
  readonly no: number;
  /** What was decided and what it did to the cut. The sentence is made from it, in the engine, wherever it is shown. */
  readonly facts: DecisionFacts;
  /** The state before the decision: a reference to an immutable state, not a copy. It carries no chronicle, so no chain of states grows behind it. */
  readonly before: Omit<AppState, 'chronicle'>;
  /** Only for a load or a back to the sample: the chronicle of the board that was replaced, so undoing the entry brings it back. */
  readonly previous: Chronicle | null;
}
export interface Chronicle {
  /** Oldest first, at most `CHRONICLE_CAP`. */
  readonly entries: readonly Entry[];
  /** How many older entries the cap removed. */
  readonly dropped: number;
  /** True when the cap dropped a load or sample entry: the board before it can no longer be brought back. */
  readonly lost: boolean;
}
export const EMPTY_CHRONICLE: Chronicle = { entries: [], dropped: 0, lost: false };
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
  /** The board and release the app started with (the sample): oard/sample goes back to them. */
  readonly builtIn: { readonly board: ValidBoard; readonly release: string | null };
  readonly source: Source;
  /** The decisions of the night on this board, and how to undo them. */
  readonly chronicle: Chronicle;
  /** The name of the release, or null. */
  readonly release: string | null;
}

export const RESERVE_STEPS: readonly number[] = [0, 5, 10, 15, 20, 25, 30];

export function initialStateFor(board: ValidBoard, release: string | null = null): AppState {
  return {
    home: board,
    board,
    candle: LAST_CANDLE_STEP,
    marginPct: 0,
    away: [],
    sound: false,
    change: { kind: 'none' },
    builtIn: { board, release },
    source: { kind: 'built-in' },
    release,
    chronicle: EMPTY_CHRONICLE,
  };
}

/** The built-in sample board in its initial state: Friday 18:00, no reserve, nobody away, sound off. */
export function initialState(): AppState {
  const r = validateBoard(sampleBoard());
  if (!r.ok) throw new Error(`the sample board is invalid: ${JSON.stringify(r.error)}`);
  return initialStateFor(r.value, SAMPLE_RELEASE);
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
