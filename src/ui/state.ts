import { compareKeys, exhume, putDown, resurrect, validateBoard } from '../engine/index';
import type { ValidBoard } from '../engine/index';
import { LAST_CANDLE_STEP } from './candle-steps';
import { EMPTY_CHRONICLE, recordEntry, sameNight, undoTo } from './chronicle';
import { cleanRelease } from './release';
import type { Action, AppState, Comparison, Subject } from './model';
import { boardFor, freezeFor, initialStateFor } from './model';
import { compareStates } from './solve';
/**
 * The reducer: the only place state changes. It is pure. It calls the engine (which is pure too) for exhume, resurrect and put down,
 * and for the two solutions that the change note compares. Inputs it does not understand return the very same state.
 *
 * The chronicle is written here, in the same step as the decision: one entry for a survivor, a tombstone action the engine applied, a reset
 * that changed something, a load, a back to the sample. A candle or reserve gesture is many `candle/set` or `reserve/set` steps (which write
 * nothing) and one `chronicle/settle` when it ends.
 */
export type { Action, AppState, Change, Chronicle, Comparison, Entry, Subject } from './model';
export { RESERVE_STEPS, initialState, initialStateFor } from './model';
function done(state: AppState, subject: Subject, comparison: Comparison): AppState {
  return { ...state, change: { kind: 'done', subject, comparison } };
}
/** A decision that was applied: the state with its change note and its entry. */
function decided(before: AppState, next: AppState, subject: Subject, comparison: Comparison): AppState {
  return recordEntry(before, done(next, subject, comparison), subject);
}
function isReserve(pct: number): boolean {
  return Number.isInteger(pct) && pct >= 0 && pct <= 30 && pct % 5 === 0;
}
/** A board with the tickets and put-down keys the engine returned, and the full team of the current board. */
function withEngineResult(state: AppState, tickets: ValidBoard['tickets'], wontDo: ValidBoard['wontDo']): ValidBoard {
  const r = validateBoard({ ...state.board, tickets, wontDo });
  if (!r.ok) throw new Error(`the engine returned an invalid board: ${JSON.stringify(r.error)}`);
  return r.value;
}
function reduceTombstone(state: AppState, action: Extract<Action, { type: `tombstone/${string}` }>): AppState {
  const kind = action.type === 'tombstone/exhume' ? 'exhume' : action.type === 'tombstone/resurrect' ? 'resurrect' : 'put-down';
  const subject: Subject = { kind, key: action.key };
  const board = boardFor(state);
  const freeze = freezeFor(state);
  if (kind === 'put-down') {
    const r = putDown(board, freeze, action.key);
    if (!r.ok) return { ...state, change: { kind: 'refused', subject, error: r.error } };
    const next: AppState = { ...state, board: withEngineResult(state, r.value.board.tickets, r.value.board.wontDo) };
    return decided(state, next, subject, { kind: 'diff', before: r.value.before, after: r.value.after, diff: r.value.diff });
  }
  const run = kind === 'resurrect' ? resurrect : exhume;
  const r = run(board, freeze, action.key);
  if (!r.ok) return { ...state, change: { kind: 'refused', subject, error: r.error } };
  if (r.value.kind === 'rejected') return { ...state, change: { kind: 'rejected', subject, impossible: r.value.impossible } };
  const out = r.value;
  const next: AppState = { ...state, board: withEngineResult(state, out.board.tickets, out.board.wontDo) };
  return decided(state, next, subject, { kind: 'diff', before: out.before, after: out.after, diff: out.diff });
}
export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'candle/set': {
      const step = action.step;
      if (!Number.isInteger(step) || step < 0 || step > LAST_CANDLE_STEP || step === state.candle) return state;
      const next = { ...state, candle: step };
      return done(next, { kind: 'candle', from: state.candle, to: step }, compareStates(state, next));
    }
    case 'reserve/set': {
      if (!isReserve(action.pct) || action.pct === state.marginPct) return state;
      const next = { ...state, marginPct: action.pct };
      return done(next, { kind: 'reserve', from: state.marginPct, to: action.pct }, compareStates(state, next));
    }
    case 'survivor/toggle': {
      if (!state.board.people.some((p) => p.name === action.name)) return state;
      const wasAway = state.away.includes(action.name);
      const away = wasAway ? state.away.filter((n) => n !== action.name) : [...state.away, action.name].sort(compareKeys);
      const next = { ...state, away };
      return decided(state, next, { kind: 'survivor', name: action.name, away: !wasAway }, compareStates(state, next));
    }
    case 'tombstone/exhume':
    case 'tombstone/resurrect':
    case 'tombstone/put-down':
      return reduceTombstone(state, action);
    case 'sound/set':
      return action.on === state.sound ? state : { ...state, sound: action.on };
    case 'state/restore':
      return action.state;
    case 'board/reset': {
      // Back to the loaded board: the built-in one, or your tickets. The chronicle goes on: a reset is a decision like the others.
      const next: AppState = {
        ...initialStateFor(state.home, state.release),
        builtIn: state.builtIn,
        source: state.source,
        sound: state.sound,
        chronicle: state.chronicle,
      };
      const subject: Subject = { kind: 'reset', ...(state.source.kind === 'file' ? { yours: true } : {}) };
      const comparison = compareStates(state, next);
      // A reset that leaves the night as it was is not a decision.
      return sameNight(state, next) ? done(next, subject, comparison) : decided(state, next, subject, comparison);
    }
    case 'board/sample': {
      const { board, release } = state.builtIn;
      const next: AppState = { ...initialStateFor(board, release), builtIn: state.builtIn, sound: state.sound };
      return decided(state, next, { kind: 'sample' }, { kind: 'new-board' });
    }
    case 'board/load': {
      const next: AppState = {
        ...initialStateFor(action.board, action.release),
        builtIn: state.builtIn,
        source: { kind: 'file', name: action.name, skipped: action.skipped, warnings: action.warnings, putDown: action.putDown },
        sound: state.sound,
      };
      const subject: Subject = { kind: 'load', name: action.name, count: action.board.tickets.length, skipped: action.skipped };
      return decided(state, next, subject, { kind: 'new-board' });
    }
    case 'release/set': {
      const release = cleanRelease(action.name);
      return release === state.release ? state : { ...state, release };
    }
    case 'chronicle/settle': {
      // The entry of a candle or reserve gesture, written when it settles. It is skipped if the gesture did not move the value, or if something else
      // was written meanwhile (the entry would then compare with a state that is no longer the one before it).
      const { from, subject } = action;
      if (from.chronicle !== state.chronicle || from.home !== state.home) return state;
      if (subject.kind === 'candle' && (from.candle === state.candle || subject.from !== from.candle || subject.to !== state.candle)) return state;
      if (subject.kind === 'reserve' && (from.marginPct === state.marginPct || subject.from !== from.marginPct || subject.to !== state.marginPct)) return state;
      if (subject.kind !== 'candle' && subject.kind !== 'reserve') return state;
      return recordEntry(from, state, subject);
    }
    case 'chronicle/undo':
      return undoTo(state, action.to);
    case 'tour/step': {
      // What the tour does is not the user's night: the inner action runs, and the chronicle stays as it was (empty if the tour changed the board).
      const next = reducer(state, action.action);
      if (next === state) return next;
      return { ...next, chronicle: next.home === state.home ? state.chronicle : EMPTY_CHRONICLE };
    }
  }
}
/**
 * One decision as the page makes it, for tests and generators: a candle or reserve change is a gesture of one step and its settle, anything
 * else is the action itself.
 */
export function decide(state: AppState, action: Action): AppState {
  const next = reducer(state, action);
  if (next === state) return state;
  if (action.type === 'candle/set' && next.change.kind === 'done') return reducer(next, { type: 'chronicle/settle', from: state, subject: next.change.subject });
  if (action.type === 'reserve/set' && next.change.kind === 'done') return reducer(next, { type: 'chronicle/settle', from: state, subject: next.change.subject });
  return next;
}
