import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { capacityBetween, effectiveCapacity, solveFreeze, validateBoard } from '../../src/engine/index';
import { CANDLE_STEPS } from '../../src/ui/candle-steps';
import { derive } from '../../src/ui/derive';
import type { View } from '../../src/ui/derive';
import { boardFor, freezeFor } from '../../src/ui/model';
import { SAMPLE_NOW } from '../../src/ui/sample-board';
import { solveState } from '../../src/ui/solve';
import { initialState, reducer } from '../../src/ui/state';
import type { Action, AppState } from '../../src/ui/state';

function run(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state);
}

const keys = (list: readonly { key: string }[]): string[] => list.map((e) => e.key);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

describe('derive: the initial view', () => {
  const state = initialState();
  const view = derive(state);

  test('the candle readout comes from capacityBetween and effectiveCapacity', () => {
    expect(view.candle).toMatchObject({ step: 10, label: 'Fri 18:00', capacity: 59, effectiveCapacity: 59 });
    expect(view.freeze).toEqual({ now: SAMPLE_NOW, freezeAt: CANDLE_STEPS[10]!.freezeAt, marginPct: 0 });
  });

  test('the notches show the capacity at every position of the candle', () => {
    expect(view.candle.notches.map((n) => n.capacity)).toEqual([0, 6, 12, 18, 24, 30, 35, 41, 47, 53, 59]);
    expect(view.candle.notches.map((n) => n.label)).toEqual(CANDLE_STEPS.map((s) => s.label));
    expect(view.candle.notches.map((n) => n.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test('safehouse and yard are the engine lists, sorted by key', () => {
    expect(keys(view.safehouse)).toEqual(['HB-101', 'HB-102', 'HB-103', 'HB-104', 'HB-105', 'HB-106', 'HB-107', 'HB-109', 'HB-113', 'HB-115', 'HB-116', 'HB-118']);
    expect(keys(view.yard)).toEqual(['HB-108', 'HB-110', 'HB-111', 'HB-112', 'HB-114', 'HB-117', 'HB-119']);
  });

  test('totals come straight from the solution', () => {
    expect(view.totals).toEqual({ keptCount: 12, keptEffort: 59, savedCod: 167, buriedCount: 7, buriedEffort: 129, buriedCod: 101 });
  });

  test('zombies, the cascade and the chain', () => {
    expect(view.yard.filter((t) => t.isZombie).map((t) => t.key)).toEqual(['HB-110', 'HB-112']);
    const fallen = view.yard.filter((t) => t.fell);
    expect(keys(fallen)).toEqual(['HB-114']);
    expect(fallen[0]?.chainedTo).toEqual(['HB-112']);
    expect(view.chains).toEqual([{ from: 'HB-114', to: 'HB-112' }]);
  });

  test('every card carries its cost in parts, including hunger and the imported cost', () => {
    const card = (key: string) => [...view.safehouse, ...view.yard].find((c) => c.key === key)!;
    expect(card('HB-105').cost).toMatchObject({ urgency: 1, effectiveUrgency: 5, past: 3, cod: 11, imported: false });
    expect(card('HB-113').cost).toMatchObject({ urgency: 3, effectiveUrgency: 8, past: 2, cod: 14 });
    expect(card('HB-111').cost).toMatchObject({ imported: true, cod: 14 });
    expect(card('HB-101')).toMatchObject({ mustHave: true, effort: 5, title: 'Fix stale balance after a transfer' });
  });

  test('"needs" lists the dependencies as written on the board, sorted', () => {
    const card = (key: string) => [...view.safehouse, ...view.yard].find((c) => c.key === key)!;
    expect(card('HB-107').needs).toEqual(['HB-106']);
    expect(card('HB-106').needs).toEqual(['HB-104']);
    expect(card('HB-101').needs).toEqual([]);
    expect(card('HB-114').needs).toEqual(['HB-112']);
  });

  test('buried tickets carry the engine reason and the cost of waiting', () => {
    const t = (key: string) => view.yard.find((x) => x.key === key)!;
    expect(t('HB-108')).toMatchObject({ reason: { kind: 'no-room', needed: 8, left: 0 }, burialCost: 20, isZombie: false, fell: false });
    expect(t('HB-114')).toMatchObject({ reason: { kind: 'depends-on-buried', buriedDependencies: ['HB-112'] }, burialCost: 22 });
    expect(t('HB-112')).toMatchObject({ isZombie: true, burialCost: 32, cost: { past: 3, effectiveUrgency: 8 } });
  });

  test('team, must-haves and the put-down list', () => {
    expect(view.team).toEqual([
      { name: 'Ana', pointsPerHalfDay: 2, away: false },
      { name: 'Bruno', pointsPerHalfDay: 2, away: false },
      { name: 'Carla', pointsPerHalfDay: 1, away: false },
      { name: 'Dev', pointsPerHalfDay: 1, away: false },
    ]);
    expect(keys(view.mustHaves)).toEqual(['HB-101', 'HB-102', 'HB-103']);
    expect(view.putDown).toEqual([]);
  });
});

describe('derive: when the freeze is impossible', () => {
  const state = run(initialState(), { type: 'candle/set', step: 2 });
  const view = derive(state);

  test('no lists, no totals, and the readout still has capacity numbers', () => {
    expect(view.solution).toMatchObject({ status: 'impossible', capacity: 12, effectiveCapacity: 12, needed: 15 });
    expect(view.safehouse).toEqual([]);
    expect(view.yard).toEqual([]);
    expect(view.totals).toBeNull();
    expect(view.chains).toEqual([]);
    expect(view.candle).toMatchObject({ label: 'Mon 18:00', capacity: 12, effectiveCapacity: 12 });
  });

  test('the must-haves are listed with title and effort, so the user sees what needs room', () => {
    expect(view.mustHaves).toEqual([
      { key: 'HB-101', title: 'Fix stale balance after a transfer', effort: 5 },
      { key: 'HB-102', title: 'Strong-auth callback (PSD2)', effort: 8 },
      { key: 'HB-103', title: 'Store listing and release notes', effort: 2 },
    ]);
  });
});

describe('derive: other states', () => {
  test('the reserve shows the effective capacity next to the capacity', () => {
    const view = derive(run(initialState(), { type: 'reserve/set', pct: 15 }));
    expect(view.candle).toMatchObject({ capacity: 59, effectiveCapacity: 50 });
  });

  test('survivors sent away are marked, and the capacity drops', () => {
    const view = derive(run(initialState(), { type: 'survivor/toggle', name: 'Ana' }));
    expect(view.team.find((p) => p.name === 'Ana')?.away).toBe(true);
    expect(view.candle.capacity).toBe(39);
    expect(view.candle.notches.at(-1)?.capacity).toBe(39);
  });

  test('a put-down ticket is not a tombstone; it is listed as closed, and its dependent can never ship', () => {
    const view = derive(run(initialState(), { type: 'tombstone/put-down', key: 'HB-112' }));
    expect(keys(view.yard)).toEqual(['HB-108', 'HB-110', 'HB-111', 'HB-114', 'HB-117', 'HB-119']);
    expect(view.putDown).toEqual(['HB-112']);
    expect(view.yard.find((t) => t.key === 'HB-114')).toMatchObject({
      reason: { kind: 'blocked-by-put-down', putDownKey: 'HB-112' },
      fell: false,
      chainedTo: [],
      needs: ['HB-112'],
    });
    expect(view.chains).toEqual([]);
  });

  test('an exhumed ticket moves to the safehouse with the must-have mark', () => {
    const view = derive(run(initialState(), { type: 'tombstone/exhume', key: 'HB-110' }));
    expect(view.safehouse.find((c) => c.key === 'HB-110')).toMatchObject({ mustHave: true });
    expect(keys(view.yard)).not.toContain('HB-110');
  });

  test('chains appear between buried tickets at other candle positions', () => {
    const view = derive(run(initialState(), { type: 'candle/set', step: 3 }));
    const buried = new Set(keys(view.yard));
    expect(view.chains.length).toBeGreaterThan(0);
    for (const edge of view.chains) {
      expect(buried.has(edge.from) && buried.has(edge.to)).toBe(true);
    }
    expect(view.chains).toEqual([...view.chains].sort((a, b) => (a.from + a.to < b.from + b.to ? -1 : 1)));
  });

  test('deriving a deeply frozen state works and does not change it', () => {
    const state = deepFreeze(run(initialState(), { type: 'candle/set', step: 7 }));
    expect(derive(state)).toEqual(derive(state));
  });
});

describe('derive and the engine agree (every candle step, reserve and team)', () => {
  const arbState = fc.record({
    step: fc.integer({ min: 0, max: 10 }),
    pct: fc.constantFrom(0, 5, 10, 15, 20, 25, 30),
    away: fc.subarray(['Ana', 'Bruno', 'Carla', 'Dev']),
    exhume: fc.option(fc.constantFrom('HB-108', 'HB-110', 'HB-111', 'HB-116'), { nil: undefined }),
  });

  function build(input: { step: number; pct: number; away: string[]; exhume: string | undefined }): AppState {
    let s = initialState();
    if (input.exhume) s = reducer(s, { type: 'tombstone/exhume', key: input.exhume });
    s = reducer(s, { type: 'reserve/set', pct: input.pct });
    for (const name of input.away) s = reducer(s, { type: 'survivor/toggle', name });
    return reducer(s, { type: 'candle/set', step: input.step });
  }

  test('the candle readout equals the capacity and effective capacity of the solution, and the lists equal the engine lists', () => {
    fc.assert(
      fc.property(arbState, (input) => {
        const state = build(input);
        const view = derive(state);
        expect(view.candle.capacity).toBe(view.solution.capacity);
        expect(view.candle.effectiveCapacity).toBe(view.solution.effectiveCapacity);

        // The test asks the engine itself, from the state's own parts, without going through the UI's cache.
        const people = state.board.people.filter((p) => !state.away.includes(p.name));
        const board = validateBoard({ ...state.board, people });
        if (!board.ok) throw new Error('invalid board');
        const direct = solveFreeze(board.value, { now: SAMPLE_NOW, freezeAt: CANDLE_STEPS[state.candle]!.freezeAt, marginPct: state.marginPct });
        if (!direct.ok) throw new Error('engine error');
        expect(view.solution).toEqual(direct.value);

        if (direct.value.status === 'ok') {
          expect(keys(view.safehouse)).toEqual([...direct.value.kept]);
          expect(keys(view.yard)).toEqual(direct.value.buried.map((b) => b.key));
          const all = [...keys(view.safehouse), ...keys(view.yard)].sort();
          expect(all).toEqual(state.board.tickets.map((t) => t.key).sort());
          expect(view.totals).toEqual({
            keptCount: direct.value.kept.length,
            keptEffort: direct.value.keptEffort,
            savedCod: direct.value.savedCod,
            buriedCount: direct.value.buried.length,
            buriedEffort: direct.value.buriedEffort,
            buriedCod: direct.value.buriedCod,
          });
        } else {
          expect(view.safehouse).toEqual([]);
          expect(view.yard).toEqual([]);
          expect(view.totals).toBeNull();
        }

        const capacity = capacityBetween(people, state.board.timeZone, SAMPLE_NOW, CANDLE_STEPS[state.candle]!.freezeAt);
        expect(capacity.ok && capacity.value).toBe(view.candle.capacity);
        const effective = effectiveCapacity(view.candle.capacity, state.marginPct);
        expect(effective.ok && effective.value).toBe(view.candle.effectiveCapacity);
      }),
      { numRuns: 300 },
    );
  });

  test('chains join only buried tickets, and every buried dependency of a tombstone is chained', () => {
    fc.assert(
      fc.property(arbState, (input) => {
        const view: View = derive(build(input));
        const buried = new Set(keys(view.yard));
        for (const edge of view.chains) expect(buried.has(edge.from) && buried.has(edge.to)).toBe(true);
        for (const t of view.yard) {
          expect(t.chainedTo).toEqual(t.needs.filter((k) => buried.has(k)));
          for (const to of t.chainedTo) expect(view.chains).toContainEqual({ from: t.key, to });
        }
        expect(view.chains.length).toBe(view.yard.reduce((n, t) => n + t.chainedTo.length, 0));
      }),
      { numRuns: 300 },
    );
  });
});

describe('the solution cache', () => {
  test('the same state asks the engine once: the same solution object comes back', () => {
    const state = initialState();
    expect(solveState(state)).toBe(solveState(state));
    expect(solveState({ ...state, sound: true })).toBe(solveState(state));
  });

  test('different boards never share an answer, even with the same candle, reserve and team', () => {
    const base = initialState();
    const exhumed = reducer(base, { type: 'tombstone/exhume', key: 'HB-110' });
    expect(solveState(exhumed)).not.toEqual(solveState(base));
    // and going back still gives the original answer
    expect(solveState(base)).toMatchObject({ status: 'ok', savedCod: 167 });
  });

  test('a cached answer equals a fresh one', () => {
    const state = run(initialState(), { type: 'candle/set', step: 6 }, { type: 'reserve/set', pct: 10 });
    const cached = solveState(state);
    const fresh = solveFreeze(boardFor(state), freezeFor(state));
    expect(fresh.ok && fresh.value).toEqual(cached);
  });

  test('many states in a row (more than the cache holds) still give the right answers', () => {
    let s = initialState();
    for (let round = 0; round < 3; round++) {
      for (let step = 0; step <= 10; step++) {
        for (const pct of [0, 5, 10, 15, 20, 25, 30]) {
          s = reducer(reducer(s, { type: 'candle/set', step }), { type: 'reserve/set', pct });
          const fresh = solveFreeze(boardFor(s), freezeFor(s));
          expect(fresh.ok && fresh.value).toEqual(solveState(s));
        }
      }
    }
  });
});

describe('derive: the fog', () => {
  test('has the seven reserve steps and marks the one of the state', () => {
    const view = derive(initialState());
    expect(view.fog?.points.map((p) => p.marginPct)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect(view.fog?.currentIndex).toBe(0);
    for (const [pct, index] of [[5, 1], [15, 3], [30, 6]] as const) {
      const v = derive(reducer(initialState(), { type: 'reserve/set', pct }));
      expect(v.fog?.currentIndex).toBe(index);
      expect(v.fog?.points[index]?.marginPct).toBe(pct);
    }
  });

  test('the curve is the same one whatever the reserve (so the slider never recomputes it)', () => {
    const start = initialState();
    const a = derive(start).fog?.points;
    const b = derive(reducer(start, { type: 'reserve/set', pct: 20 })).fog?.points;
    expect(a).toBe(b);
  });

  test('the current point is the fog of the solution the view shows', () => {
    const view = derive(reducer(initialState(), { type: 'reserve/set', pct: 15 }));
    const point = view.fog?.points[view.fog.currentIndex ?? -1];
    expect(point?.status).toBe('ok');
    if (point?.status === 'ok' && view.solution.status === 'ok') {
      expect(point.keptCount).toBe(view.solution.kept.length);
      expect(point.keptEffort).toBe(view.solution.keptEffort);
      expect(point.capacity).toBe(view.solution.capacity);
      expect(point.effectiveCapacity).toBe(view.solution.effectiveCapacity);
    }
  });

  test('an impossible freeze has impossible points and the same needed number as the solution', () => {
    const view = derive(reducer(initialState(), { type: 'candle/set', step: 2 }));
    expect(view.solution.status).toBe('impossible');
    const point = view.fog?.points[0];
    expect(point?.status).toBe('impossible');
    if (point?.status === 'impossible' && view.solution.status === 'impossible') expect(point.needed).toBe(view.solution.needed);
  });
});