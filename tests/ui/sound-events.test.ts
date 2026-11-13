import { describe, expect, test } from 'vitest';
import { derive } from '../../src/ui/derive';
import { soundEventFor } from '../../src/ui/sound-events';
import type { SoundEvent } from '../../src/ui/sound-events';
import { initialState, reducer } from '../../src/ui/state';
import type { Action, AppState } from '../../src/ui/state';

function run(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state);
}

/** The sound of the last action in a sequence. */
function soundOf(...actions: Action[]): SoundEvent | null {
  const state = run(initialState(), ...actions);
  return soundEventFor(state.change, derive(state));
}

describe('which sound a change makes', () => {
  test('exhume and resurrect, when applied, resurrect', () => {
    expect(soundOf({ type: 'tombstone/exhume', key: 'HB-108' })).toBe('resurrect');
    expect(soundOf({ type: 'tombstone/resurrect', key: 'HB-110' })).toBe('resurrect');
  });

  test('putting a zombie down puts it down', () => {
    expect(soundOf({ type: 'tombstone/put-down', key: 'HB-112' })).toBe('put-down');
    expect(soundOf({ type: 'tombstone/put-down', key: 'HB-110' })).toBe('put-down');
  });

  test('a change that sinks a ticket with nothing depending on it is a bury', () => {
    expect(soundOf({ type: 'candle/set', step: 9 })).toBe('bury'); // HB-115 sinks
    expect(soundOf({ type: 'reserve/set', pct: 15 })).toBe('bury'); // HB-115 and HB-116 sink
    expect(soundOf({ type: 'survivor/toggle', name: 'Ana' })).toBe('bury'); // HB-113, HB-115, HB-118 sink
  });

  test('a change that sinks a ticket whose dependent falls behind it is a cascade', () => {
    // Wed 18:00 to Wed 13:00 sinks HB-104, HB-106 and HB-107; HB-106 and HB-107 are buried because HB-104 is.
    expect(soundOf({ type: 'candle/set', step: 6 }, { type: 'candle/set', step: 5 })).toBe('cascade');
  });

  test('a change that only raises tickets is silent', () => {
    expect(soundOf({ type: 'candle/set', step: 9 }, { type: 'candle/set', step: 10 })).toBeNull();
    expect(soundOf({ type: 'survivor/toggle', name: 'Ana' }, { type: 'survivor/toggle', name: 'Ana' })).toBeNull();
    expect(soundOf({ type: 'reserve/set', pct: 15 }, { type: 'reserve/set', pct: 0 })).toBeNull();
  });

  test('a rejected exhume, a refusal and a reset are silent', () => {
    expect(soundOf({ type: 'tombstone/exhume', key: 'HB-119' })).toBeNull();
    expect(soundOf({ type: 'tombstone/put-down', key: 'HB-108' })).toBeNull();
    expect(soundOf({ type: 'tombstone/exhume', key: 'HB-999' })).toBeNull();
    expect(soundOf({ type: 'candle/set', step: 4 }, { type: 'board/reset' })).toBeNull();
  });

  test('nothing yet, and a freeze that is impossible on either side, are silent', () => {
    expect(soundOf()).toBeNull();
    expect(soundOf({ type: 'candle/set', step: 2 })).toBeNull();
    expect(soundOf({ type: 'candle/set', step: 2 }, { type: 'candle/set', step: 6 })).toBeNull();
  });

  test('the sound setting itself makes no sound', () => {
    expect(soundOf({ type: 'candle/set', step: 9 }, { type: 'sound/set', on: true })).toBe('bury'); // keeps the last change, which was a bury
    const fresh = reducer(initialState(), { type: 'sound/set', on: true });
    expect(soundEventFor(fresh.change, derive(fresh))).toBeNull();
  });

  test('a gesture is judged start to end: the pseudo change built by the controller works the same way', () => {
    const start = initialState();
    const end = run(start, { type: 'candle/set', step: 6 }, { type: 'candle/set', step: 5 });
    // The controller compares the start state with the end state (here: Fri 18:00 against Wed 13:00).
    const gesture = reducer(start, { type: 'candle/set', step: 5 });
    expect(derive(end).candle.step).toBe(5);
    expect(soundEventFor(gesture.change, derive(gesture))).toBe('cascade');
  });
});
