import { describe, expect, test } from 'vitest';
import { fogCurve } from '../../src/engine/index';
import { curveFor } from '../../src/ui/fog-cache';
import { boardFor, freezeFor } from '../../src/ui/model';
import { initialState, reducer } from '../../src/ui/state';

const must = <T,>(value: T | null): T => {
  if (value === null) throw new Error('expected a curve');
  return value;
};

describe('the fog cache', () => {
  test('gives the engine curve of the state', () => {
    const state = initialState();
    const { now, freezeAt } = freezeFor(state);
    const direct = fogCurve(boardFor(state), { now, freezeAt });
    expect(direct.ok).toBe(true);
    expect(curveFor(state)).toEqual(direct.ok ? direct.value : null);
  });

  test('the same state gives the very same curve (nothing is computed twice)', () => {
    const state = initialState();
    expect(curveFor(state)).toBe(curveFor(state));
  });

  test('the reserve is not part of the key: moving the slider reuses the curve', () => {
    const start = initialState();
    const curve = must(curveFor(start));
    for (const pct of [5, 10, 15, 20, 25, 30, 0]) {
      expect(curveFor(reducer(start, { type: 'reserve/set', pct }))).toBe(curve);
    }
  });

  test('the candle and the team are part of the key: another position or another team gives another curve', () => {
    const start = initialState();
    const curve = must(curveFor(start));
    const moved = curveFor(reducer(start, { type: 'candle/set', step: 8 }));
    expect(moved).not.toBe(curve);
    expect(moved).not.toEqual(curve);
    const away = curveFor(reducer(start, { type: 'survivor/toggle', name: 'Ana' }));
    expect(away).not.toBe(curve);
    expect(away).not.toEqual(curve);
    // And coming back to the first position gives the first curve again, from the cache.
    expect(curveFor(reducer(reducer(start, { type: 'candle/set', step: 8 }), { type: 'candle/set', step: 10 }))).toBe(curve);
  });

  test('a new board (exhume, put down, reset) never gets the curve of the board before it', () => {
    const start = initialState();
    const curve = must(curveFor(start));
    const exhumed = reducer(start, { type: 'tombstone/exhume', key: 'HB-108' });
    expect(exhumed.board).not.toBe(start.board);
    const after = must(curveFor(exhumed));
    expect(after).not.toBe(curve);
    const { now, freezeAt } = freezeFor(exhumed);
    const direct = fogCurve(boardFor(exhumed), { now, freezeAt });
    expect(after).toEqual(direct.ok ? direct.value : null);
    // the first board still has its own curve
    expect(curveFor(start)).toBe(curve);
  });

  test('a freeze that cannot be met gives impossible points', () => {
    const state = reducer(initialState(), { type: 'candle/set', step: 0 });
    const curve = must(curveFor(state));
    expect(curve).toHaveLength(7);
    expect(curve.every((p) => p.status === 'impossible')).toBe(true);
  });
});
