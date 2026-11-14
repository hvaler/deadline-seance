import * as fc from 'fast-check';
import type { Action, AppState } from '../../src/ui/state';
import { initialState, reducer } from '../../src/ui/state';

/** Names on the sample board, plus one that is not. */
export const NAMES = ['Ana', 'Bruno', 'Carla', 'Dev', 'Zed'] as const;

/** Real ticket keys of the sample board, plus keys that are not on it. */
export const KEYS = Array.from({ length: 22 }, (_, i) => `HB-${101 + i}`);

/** Any action the UI can send, including values the reducer must ignore (out of range, not whole, unknown names and keys). */
export const arbAction: fc.Arbitrary<Action> = fc.oneof(
  fc.oneof(fc.integer({ min: -3, max: 14 }), fc.double({ noNaN: false })).map((step): Action => ({ type: 'candle/set', step })),
  fc.oneof(fc.integer({ min: -10, max: 40 }), fc.double({ noNaN: false })).map((pct): Action => ({ type: 'reserve/set', pct })),
  fc.constantFrom(...NAMES).map((name): Action => ({ type: 'survivor/toggle', name })),
  fc.constantFrom(...KEYS).map((key): Action => ({ type: 'tombstone/exhume', key })),
  fc.constantFrom(...KEYS).map((key): Action => ({ type: 'tombstone/resurrect', key })),
  fc.constantFrom(...KEYS).map((key): Action => ({ type: 'tombstone/put-down', key })),
  fc.boolean().map((on): Action => ({ type: 'sound/set', on })),
  fc.constant<Action>({ type: 'board/reset' }),
  fc.constant<Action>({ type: 'board/sample' }),
  fc.oneof(fc.string({ maxLength: 80 }), fc.constantFrom('', '  ', 'Q4 freeze', 'x'.repeat(90))).map((name): Action => ({ type: 'release/set', name })),
);

/** Actions that are mostly meaningful (valid steps, percentages, names and keys), so sequences reach interesting states. */
export const arbMeaningfulAction: fc.Arbitrary<Action> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 10 }).map((step): Action => ({ type: 'candle/set', step })) },
  { weight: 2, arbitrary: fc.constantFrom(0, 5, 10, 15, 20, 25, 30).map((pct): Action => ({ type: 'reserve/set', pct })) },
  { weight: 2, arbitrary: fc.constantFrom('Ana', 'Bruno', 'Carla', 'Dev').map((name): Action => ({ type: 'survivor/toggle', name })) },
  { weight: 2, arbitrary: fc.constantFrom(...KEYS.slice(0, 19)).map((key): Action => ({ type: 'tombstone/exhume', key })) },
  { weight: 2, arbitrary: fc.constantFrom(...KEYS.slice(0, 19)).map((key): Action => ({ type: 'tombstone/resurrect', key })) },
  { weight: 2, arbitrary: fc.constantFrom(...KEYS.slice(0, 19)).map((key): Action => ({ type: 'tombstone/put-down', key })) },
  { weight: 1, arbitrary: fc.constant<Action>({ type: 'board/reset' }) },
  { weight: 1, arbitrary: fc.constant<Action>({ type: 'board/sample' }) },
);

/** Runs actions from the initial state, returning every state reached (the first one is the initial state). */
export function statesAfter(actions: readonly Action[]): AppState[] {
  const states = [initialState()];
  for (const action of actions) states.push(reducer(states[states.length - 1] as AppState, action));
  return states;
}
