import { compareKeys, exhume, putDown, resurrect, validateBoard } from '../engine/index';
import type { ValidBoard } from '../engine/index';
import { LAST_CANDLE_STEP } from './candle-steps';
import type { Action, AppState, Comparison, Subject } from './model';
import { boardFor, freezeFor, initialStateFor } from './model';
import { compareStates } from './solve';

/**
 * The reducer: the only place state changes. It is pure. It calls the engine (which is pure too) for exhume, resurrect and put down,
 * and for the two solutions that the change note compares. Inputs it does not understand return the very same state.
 */

export type { Action, AppState, Change, Comparison, Subject } from './model';
export { RESERVE_STEPS, initialState, initialStateFor } from './model';

function done(state: AppState, subject: Subject, comparison: Comparison): AppState {
  return { ...state, change: { kind: 'done', subject, comparison } };
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
    return done(next, subject, { kind: 'diff', before: r.value.before, after: r.value.after, diff: r.value.diff });
  }

  const run = kind === 'resurrect' ? resurrect : exhume;
  const r = run(board, freeze, action.key);
  if (!r.ok) return { ...state, change: { kind: 'refused', subject, error: r.error } };
  if (r.value.kind === 'rejected') return { ...state, change: { kind: 'rejected', subject, impossible: r.value.impossible } };
  const out = r.value;
  const next: AppState = { ...state, board: withEngineResult(state, out.board.tickets, out.board.wontDo) };
  return done(next, subject, { kind: 'diff', before: out.before, after: out.after, diff: out.diff });
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
      return done(next, { kind: 'survivor', name: action.name, away: !wasAway }, compareStates(state, next));
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
      const next: AppState = { ...initialStateFor(state.home), sound: state.sound };
      return done(next, { kind: 'reset' }, compareStates(state, next));
    }
  }
}
