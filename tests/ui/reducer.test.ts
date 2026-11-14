import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { exportCsv, importCsv, validateBoard } from '../../src/engine/index';
import { CANDLE_STEPS, LAST_CANDLE_STEP } from '../../src/ui/candle-steps';
import { solveState } from '../../src/ui/solve';
import { initialState, reducer } from '../../src/ui/state';
import type { Action, AppState, Comparison } from '../../src/ui/state';
import { createStore } from '../../src/ui/store';
import { arbAction } from './arbitraries';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function run(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state);
}

function comparisonOf(state: AppState): Comparison {
  if (state.change.kind !== 'done') throw new Error(`expected a done change, got ${state.change.kind}`);
  return state.change.comparison;
}

const keys = (list: readonly { key: string }[]): string[] => list.map((e) => e.key);

describe('initial state', () => {
  test('Friday 18:00, no reserve, nobody away, sound off, nothing changed yet', () => {
    const s = initialState();
    expect(s).toMatchObject({ candle: 10, marginPct: 0, away: [], sound: false, change: { kind: 'none' } });
    expect(s.board).toBe(s.home);
    expect(s.board.tickets).toHaveLength(19);
  });

  test('each call gives a fresh, equal state', () => {
    const a = initialState();
    const b = initialState();
    expect(a).toEqual(b);
    expect(a.board).not.toBe(b.board);
  });
});

describe('the fog seed', () => {
  test('every action keeps the seed of the board, so the chance of a board is the same wherever it is copied to', () => {
    const start = initialState();
    expect(start.board.fogSeed).toBe(20261116);
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 15 }), (actions) => {
        let state = start;
        for (const action of actions) {
          state = reducer(state, action);
          expect(state.board.fogSeed).toBe(20261116);
        }
      }),
      { numRuns: 100 },
    );
    expect(run(start, { type: 'tombstone/put-down', key: 'HB-112' }).board.fogSeed).toBe(20261116);
    expect(run(start, { type: 'tombstone/exhume', key: 'HB-108' }).board.fogSeed).toBe(20261116);
  });
});

describe('state/restore (sent only by the guided tour)', () => {
  test('returns the very state it is given, whatever the state it replaces', () => {
    const mine = run(initialState(), { type: 'candle/set', step: 4 }, { type: 'survivor/toggle', name: 'Ana' }, { type: 'tombstone/put-down', key: 'HB-112' });
    const other = run(initialState(), { type: 'reserve/set', pct: 15 });
    expect(reducer(other, { type: 'state/restore', state: mine })).toBe(mine);
    expect(reducer(mine, { type: 'state/restore', state: mine })).toBe(mine);
  });

  test('no other action returns a state it was not given: a state either stays the same object or is a new one built from it', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 12 }), (actions) => {
        let state = initialState();
        for (const action of actions) {
          const next = reducer(state, action);
          expect(next === state || next.home === state.home).toBe(true);
          state = next;
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe('candle/set', () => {
  test('moving the candle gives a diff with numbers: Fri 18:00 to Fri 13:00 sinks HB-115', () => {
    const next = reducer(initialState(), { type: 'candle/set', step: 9 });
    expect(next.candle).toBe(9);
    expect(next.change).toMatchObject({ kind: 'done', subject: { kind: 'candle', from: 10, to: 9 } });
    const c = comparisonOf(next);
    expect(c.kind).toBe('diff');
    if (c.kind === 'diff') {
      expect(keys(c.diff.sunk)).toEqual(['HB-115']);
      expect(c.diff.raised).toEqual([]);
      expect(c.diff).toMatchObject({ sunkCod: 13, raisedCod: 0, codDelta: -13 });
    }
  });

  test('every step from 0 to 10 is accepted', () => {
    for (let step = 0; step <= LAST_CANDLE_STEP; step++) {
      const next = reducer(initialState(), { type: 'candle/set', step });
      expect(next.candle).toBe(step);
    }
  });

  test('ignored inputs return the very same state', () => {
    const s = initialState();
    for (const step of [-1, 11, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 10]) {
      expect(reducer(s, { type: 'candle/set', step })).toBe(s);
    }
  });

  test('into an impossible freeze: not comparable, with the impossible side', () => {
    const next = reducer(initialState(), { type: 'candle/set', step: 2 });
    const c = comparisonOf(next);
    expect(c.kind).toBe('not-comparable');
    if (c.kind === 'not-comparable') {
      expect(c.before.status).toBe('ok');
      expect(c.after).toMatchObject({ status: 'impossible', capacity: 12, needed: 15 });
    }
  });

  test('out of an impossible freeze is not comparable either', () => {
    const impossible = reducer(initialState(), { type: 'candle/set', step: 1 });
    expect(comparisonOf(reducer(impossible, { type: 'candle/set', step: 4 })).kind).toBe('not-comparable');
  });
});

describe('reserve/set', () => {
  test('15 % sinks HB-115 and HB-116 (loss 20)', () => {
    const next = reducer(initialState(), { type: 'reserve/set', pct: 15 });
    expect(next.marginPct).toBe(15);
    const c = comparisonOf(next);
    expect(c.kind).toBe('diff');
    if (c.kind === 'diff') {
      expect(keys(c.diff.sunk)).toEqual(['HB-115', 'HB-116']);
      expect(c.diff).toMatchObject({ sunkCod: 20, codDelta: -20 });
      expect(c.after).toMatchObject({ capacity: 59, effectiveCapacity: 50 });
    }
  });

  test('every step 0, 5, ..., 30 is accepted', () => {
    for (const pct of [5, 10, 15, 20, 25, 30]) expect(reducer(initialState(), { type: 'reserve/set', pct }).marginPct).toBe(pct);
  });

  test('ignored inputs return the very same state', () => {
    const s = initialState();
    for (const pct of [-5, 1, 7, 12.5, 35, 100, Number.NaN, 0]) expect(reducer(s, { type: 'reserve/set', pct })).toBe(s);
  });
});

describe('survivor/toggle', () => {
  test('sending Ana away: capacity 39, sinks HB-113, HB-115, HB-118 (loss 43); bringing her back restores the cut', () => {
    const away = reducer(initialState(), { type: 'survivor/toggle', name: 'Ana' });
    expect(away.away).toEqual(['Ana']);
    expect(away.change).toMatchObject({ kind: 'done', subject: { kind: 'survivor', name: 'Ana', away: true } });
    const c = comparisonOf(away);
    if (c.kind !== 'diff') throw new Error('expected a diff');
    expect(c.after.capacity).toBe(39);
    expect(keys(c.diff.sunk)).toEqual(['HB-113', 'HB-115', 'HB-118']);
    expect(c.diff.codDelta).toBe(-43);

    const back = reducer(away, { type: 'survivor/toggle', name: 'Ana' });
    expect(back.away).toEqual([]);
    expect(back.change).toMatchObject({ subject: { kind: 'survivor', name: 'Ana', away: false } });
    const d = comparisonOf(back);
    if (d.kind !== 'diff') throw new Error('expected a diff');
    expect(keys(d.diff.raised)).toEqual(['HB-113', 'HB-115', 'HB-118']);
    expect(d.diff.codDelta).toBe(43);
  });

  test('the names stay sorted', () => {
    expect(run(initialState(), { type: 'survivor/toggle', name: 'Dev' }, { type: 'survivor/toggle', name: 'Ana' }).away).toEqual(['Ana', 'Dev']);
  });

  test('a name that is not on the board is ignored', () => {
    const s = initialState();
    expect(reducer(s, { type: 'survivor/toggle', name: 'Zed' })).toBe(s);
    expect(reducer(s, { type: 'survivor/toggle', name: '' })).toBe(s);
  });

  test('everybody away: capacity 0, impossible, not comparable', () => {
    const s = run(initialState(), ...['Ana', 'Bruno', 'Carla', 'Dev'].map((name): Action => ({ type: 'survivor/toggle', name })));
    expect(solveState(s)).toMatchObject({ status: 'impossible', capacity: 0, needed: 15 });
    expect(comparisonOf(s).kind).toBe('not-comparable');
  });

  test("Dev's day off stays in the board: sending Carla away leaves Dev's absence in the capacity", () => {
    const s = reducer(initialState(), { type: 'survivor/toggle', name: 'Carla' });
    expect(solveState(s)).toMatchObject({ status: 'ok', capacity: 49 });
  });
});

describe('tombstone actions', () => {
  test('exhume HB-110: it comes back as a must-have and HB-113 and HB-115 sink (loss 14)', () => {
    const s = initialState();
    const next = reducer(s, { type: 'tombstone/exhume', key: 'HB-110' });
    expect(next.board).not.toBe(s.board);
    expect(next.board.tickets.find((t) => t.key === 'HB-110')?.mustHave).toBe(true);
    expect(next.board.people).toEqual(s.board.people);
    expect(next.change).toMatchObject({ kind: 'done', subject: { kind: 'exhume', key: 'HB-110' } });
    const c = comparisonOf(next);
    if (c.kind !== 'diff') throw new Error('expected a diff');
    expect(keys(c.diff.raised)).toEqual(['HB-110']);
    expect(keys(c.diff.sunk)).toEqual(['HB-113', 'HB-115']);
    expect(c.diff).toMatchObject({ raisedCod: 13, sunkCod: 27, codDelta: -14 });
    const solved = solveState(next);
    expect(solved.status).toBe('ok');
    if (solved.status === 'ok') expect(solved.kept).toContain('HB-110');
    expect(s.home).toBe(s.board); // the original state is untouched
  });

  test('exhume keeps the team away list and the candle', () => {
    const s = run(initialState(), { type: 'survivor/toggle', name: 'Dev' }, { type: 'tombstone/exhume', key: 'HB-108' });
    expect(s.away).toEqual(['Dev']);
    expect(s.candle).toBe(10);
    expect(s.board.people.map((p) => p.name)).toEqual(['Ana', 'Bruno', 'Carla', 'Dev']);
  });

  test('resurrect is exhume, with its own subject', () => {
    const viaExhume = reducer(initialState(), { type: 'tombstone/exhume', key: 'HB-110' });
    const viaResurrect = reducer(initialState(), { type: 'tombstone/resurrect', key: 'HB-110' });
    expect(viaResurrect.change).toMatchObject({ kind: 'done', subject: { kind: 'resurrect', key: 'HB-110' } });
    expect(viaResurrect.board).toEqual(viaExhume.board);
    expect(comparisonOf(viaResurrect)).toEqual(comparisonOf(viaExhume));
  });

  test('a rejected exhume leaves the board exactly as it was (the same value) and carries the numbers', () => {
    const s = initialState();
    const next = reducer(s, { type: 'tombstone/exhume', key: 'HB-119' });
    expect(next.board).toBe(s.board);
    expect(next.change).toEqual({
      kind: 'rejected',
      subject: { kind: 'exhume', key: 'HB-119' },
      impossible: { status: 'impossible', capacity: 59, effectiveCapacity: 59, marginPct: 0, needed: 63, blockedMustHaves: [] },
    });
    expect(next.candle).toBe(s.candle);
    expect(next.away).toBe(s.away);
  });

  test('a rejected exhume is not silent after the reserve changes the numbers', () => {
    const s = reducer(initialState(), { type: 'reserve/set', pct: 15 });
    const next = reducer(s, { type: 'tombstone/exhume', key: 'HB-119' });
    expect(next.change).toMatchObject({ kind: 'rejected', impossible: { needed: 63, capacity: 59, effectiveCapacity: 50, marginPct: 15 } });
    expect(next.board).toBe(s.board);
  });

  test('an unknown key is refused and the board is untouched', () => {
    const s = initialState();
    for (const type of ['tombstone/exhume', 'tombstone/resurrect', 'tombstone/put-down'] as const) {
      const next = reducer(s, { type, key: 'HB-999' });
      expect(next.board).toBe(s.board);
      expect(next.change).toMatchObject({ kind: 'refused', error: { code: 'unknown-key', key: 'HB-999' } });
    }
  });

  test('put down HB-112: it leaves the board, HB-114 can never ship, the cut does not change', () => {
    const s = initialState();
    const next = reducer(s, { type: 'tombstone/put-down', key: 'HB-112' });
    expect(next.board.tickets).toHaveLength(18);
    expect(next.board.wontDo).toEqual(['HB-112']);
    expect(next.change).toMatchObject({ kind: 'done', subject: { kind: 'put-down', key: 'HB-112' } });
    const c = comparisonOf(next);
    if (c.kind !== 'diff') throw new Error('expected a diff');
    expect(c.diff).toEqual({ raised: [], sunk: [], raisedCod: 0, sunkCod: 0, codDelta: 0 });
    const after = solveState(next);
    expect(after.status === 'ok' && after.buried.find((b) => b.key === 'HB-114')?.reason).toEqual({ kind: 'blocked-by-put-down', putDownKey: 'HB-112' });
    expect(s.board.tickets).toHaveLength(19); // the original board is untouched
  });

  test('only a zombie can be put down: a plain tombstone and a kept ticket are refused with the board untouched', () => {
    const s = initialState();
    for (const key of ['HB-108', 'HB-101']) {
      const next = reducer(s, { type: 'tombstone/put-down', key });
      expect(next.board).toBe(s.board);
      expect(next.change).toMatchObject({ kind: 'refused', subject: { kind: 'put-down', key }, error: { code: 'not-a-zombie', key } });
    }
  });

  test('after exhuming a zombie it is kept, so it cannot be put down any more', () => {
    const s = reducer(initialState(), { type: 'tombstone/exhume', key: 'HB-110' });
    expect(reducer(s, { type: 'tombstone/put-down', key: 'HB-110' }).change).toMatchObject({ kind: 'refused', error: { code: 'not-a-zombie' } });
  });

  test('putting the same ticket down twice is refused the second time', () => {
    const once = reducer(initialState(), { type: 'tombstone/put-down', key: 'HB-110' });
    expect(reducer(once, { type: 'tombstone/put-down', key: 'HB-110' }).change).toMatchObject({ kind: 'refused', error: { code: 'unknown-key' } });
  });

  test('exhume works while the team is smaller, and at a freeze where it is impossible it is rejected with the new numbers', () => {
    const s = run(initialState(), { type: 'survivor/toggle', name: 'Ana' });
    const next = reducer(s, { type: 'tombstone/exhume', key: 'HB-115' });
    expect(next.change.kind).toBe('done');
    const tight = reducer(initialState(), { type: 'candle/set', step: 3 });
    const rejected = reducer(tight, { type: 'tombstone/exhume', key: 'HB-112' });
    expect(rejected.change).toMatchObject({ kind: 'rejected', impossible: { capacity: 18, needed: 36 } });
    expect(rejected.board).toBe(tight.board);
  });
});

describe('board/reset', () => {
  test('goes back to the initial state, keeps the sound setting, and says what it did', () => {
    const messy = run(
      initialState(),
      { type: 'candle/set', step: 6 },
      { type: 'reserve/set', pct: 20 },
      { type: 'survivor/toggle', name: 'Bruno' },
      { type: 'tombstone/exhume', key: 'HB-108' },
      { type: 'sound/set', on: true },
    );
    const back = reducer(messy, { type: 'board/reset' });
    expect(back).toMatchObject({ candle: 10, marginPct: 0, away: [], sound: true });
    expect(back.board).toBe(back.home);
    expect(back.board.tickets.find((t) => t.key === 'HB-108')?.mustHave).toBe(false);
    expect(back.change).toMatchObject({ kind: 'done', subject: { kind: 'reset' } });
    expect(comparisonOf(back).kind).toBe('diff');
  });

  test('after a put down, a reset that brings a ticket back has no per-ticket diff: only the totals', () => {
    const early = reducer(initialState(), { type: 'candle/set', step: 4 });
    const closed = reducer(early, { type: 'tombstone/put-down', key: 'HB-113' });
    expect(closed.change).toMatchObject({ kind: 'done', subject: { kind: 'put-down', key: 'HB-113' } });
    const back = reducer(closed, { type: 'board/reset' });
    const c = comparisonOf(back);
    expect(c.kind).toBe('no-diff');
    if (c.kind === 'no-diff') {
      expect(c.before.status).toBe('ok');
      expect(c.after).toMatchObject({ status: 'ok', savedCod: 167 });
    }
  });

  test('reset on a fresh state still reports it', () => {
    const back = reducer(initialState(), { type: 'board/reset' });
    expect(back.change).toMatchObject({ kind: 'done', subject: { kind: 'reset' } });
    expect(comparisonOf(back)).toMatchObject({ kind: 'diff', diff: { raised: [], sunk: [], codDelta: 0 } });
  });
});

describe('sound/set', () => {
  test('sets the flag and keeps the last change', () => {
    const moved = reducer(initialState(), { type: 'candle/set', step: 8 });
    const on = reducer(moved, { type: 'sound/set', on: true });
    expect(on.sound).toBe(true);
    expect(on.change).toBe(moved.change);
    expect(reducer(on, { type: 'sound/set', on: false }).sound).toBe(false);
  });

  test('setting the same value returns the same state', () => {
    const s = initialState();
    expect(reducer(s, { type: 'sound/set', on: false })).toBe(s);
  });
});

describe('purity', () => {
  const actions: Action[] = [
    { type: 'candle/set', step: 6 },
    { type: 'reserve/set', pct: 15 },
    { type: 'survivor/toggle', name: 'Carla' },
    { type: 'tombstone/exhume', key: 'HB-110' },
    { type: 'tombstone/exhume', key: 'HB-119' },
    { type: 'tombstone/resurrect', key: 'HB-112' },
    { type: 'tombstone/put-down', key: 'HB-112' },
    { type: 'tombstone/put-down', key: 'HB-101' },
    { type: 'sound/set', on: true },
    { type: 'board/reset' },
  ];

  test('the same state and action give an equal result, and a deeply frozen state is never mutated', () => {
    for (const action of actions) {
      const frozen = deepFreeze(initialState());
      deepFreeze(action);
      const first = reducer(frozen, action);
      const second = reducer(frozen, action);
      expect(second).toEqual(first);
    }
  });

  test('the state is a plain value: JSON can carry it and nothing in it is a function', () => {
    const s = run(initialState(), { type: 'candle/set', step: 7 }, { type: 'tombstone/exhume', key: 'HB-108' });
    const seen: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'function') seen.push(path);
      else if (value !== null && typeof value === 'object') {
        expect(Object.getPrototypeOf(value) === Object.prototype || Array.isArray(value)).toBe(true);
        for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
      }
    };
    walk(s, 'state');
    expect(seen).toEqual([]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('the store', () => {
  test('notifies on a change and stays silent on an ignored action', () => {
    const store = createStore(reducer, initialState());
    const seen: number[] = [];
    const stop = store.subscribe((s) => seen.push(s.candle));
    store.dispatch({ type: 'candle/set', step: 4 });
    store.dispatch({ type: 'candle/set', step: 4 });
    store.dispatch({ type: 'candle/set', step: 99 });
    store.dispatch({ type: 'candle/set', step: 5 });
    stop();
    store.dispatch({ type: 'candle/set', step: 6 });
    expect(seen).toEqual([4, 5]);
    expect(store.getState().candle).toBe(6);
  });

  test('a dispatch made by a listener waits for the current round, so listeners see states in order', () => {
    const store = createStore(reducer, initialState());
    const log: string[] = [];
    store.subscribe((s) => {
      log.push(`a${s.candle}`);
      if (s.candle === 5) store.dispatch({ type: 'candle/set', step: 6 });
    });
    store.subscribe((s) => log.push(`b${s.candle}`));
    store.dispatch({ type: 'candle/set', step: 5 });
    expect(log).toEqual(['a5', 'b5', 'a6', 'b6']);
  });

  test('a throwing reducer leaves the store usable and drops queued actions', () => {
    let boom = true;
    const store = createStore((n: number, a: number) => {
      if (boom) throw new Error('boom');
      return n + a;
    }, 0);
    expect(() => store.dispatch(1)).toThrow('boom');
    boom = false;
    store.dispatch(2);
    expect(store.getState()).toBe(2);
  });
});

describe('any sequence of actions keeps the state sound', () => {
  test('invariants hold after every action, nothing throws, and rejected or refused actions never change the board', () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 25 }), (actions) => {
        let state = initialState();
        for (const action of actions) {
          const before = state;
          state = reducer(before, action);

          expect(Number.isInteger(state.candle) && state.candle >= 0 && state.candle < CANDLE_STEPS.length).toBe(true);
          expect([0, 5, 10, 15, 20, 25, 30]).toContain(state.marginPct);
          expect([...state.away]).toEqual([...state.away].sort());
          expect(new Set(state.away).size).toBe(state.away.length);
          for (const name of state.away) expect(state.board.people.map((p) => p.name)).toContain(name);

          const keysNow = state.board.tickets.map((t) => t.key);
          expect(new Set(keysNow).size).toBe(keysNow.length);
          for (const key of state.board.wontDo) expect(keysNow).not.toContain(key);
          expect(keysNow.length + state.board.wontDo.length).toBe(19);
          expect(validateBoard(state.board).ok).toBe(true);

          if (state.change.kind === 'rejected' || state.change.kind === 'refused') expect(state.board).toBe(before.board);
          expect(() => solveState(state)).not.toThrow();
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('board/sample, board/reset, release/set and board/load (the jira-csv spec)', () => {
  const imported = (): AppState => {
    const base = initialState();
    const text = 'Issue key,Summary,Story Points,Cost of Delay\nZ-1,One,5,9\nZ-2,Two,3,4\n';
    const r = importCsv(text, { people: base.home.people, timeZone: base.home.timeZone, nextReleaseWeeks: base.home.nextReleaseWeeks, zombieThreshold: base.home.zombieThreshold });
    if (!r.ok) throw new Error('import failed');
    return reducer(base, { type: 'board/load', board: r.value.board, name: 'q4_freeze.csv', release: 'q4 freeze', skipped: 2, warnings: [], putDown: [] });
  };

  test('a loaded board replaces the board and the candle, reserve, team and decisions start again; sound stays', () => {
    const base = reducer(reducer(reducer(initialState(), { type: 'candle/set', step: 3 }), { type: 'survivor/toggle', name: 'Ana' }), { type: 'sound/set', on: true });
    const text = 'Issue key,Summary,Story Points,Cost of Delay\nZ-1,One,5,9\n';
    const r = importCsv(text, { people: base.home.people, timeZone: 'Europe/Madrid', nextReleaseWeeks: 2, zombieThreshold: 3 });
    if (!r.ok) throw new Error('import failed');
    const next = reducer(base, { type: 'board/load', board: r.value.board, name: 'a.csv', release: 'a', skipped: 0, warnings: [], putDown: [] });
    expect(next).toMatchObject({ candle: 10, marginPct: 0, away: [], sound: true, release: 'a', source: { kind: 'file', name: 'a.csv', skipped: 0, warnings: [] } });
    expect(next.home).toBe(r.value.board);
    expect(next.builtIn).toBe(base.builtIn);
  });

  test('it is announced as a new board: no comparison with the one before, even when the keys are the same', () => {
    const next = imported();
    expect(next.change).toMatchObject({ kind: 'done', subject: { kind: 'load', name: 'q4_freeze.csv', count: 2, skipped: 2 }, comparison: { kind: 'new-board' } });
    const sample = initialState();
    const same = importCsv(exportCsv({ board: sample.home, home: sample.home, kept: null, release: 'R', nextRelease: 'N' }), { people: sample.home.people, timeZone: sample.home.timeZone, nextReleaseWeeks: 2, zombieThreshold: 3 });
    if (!same.ok) throw new Error('import failed');
    const again = reducer(sample, { type: 'board/load', board: same.value.board, name: 'sample.csv', release: null, skipped: 0, warnings: [], putDown: [] });
    expect(again.change).toMatchObject({ comparison: { kind: 'new-board' } });
  });

  test('board/sample goes back to the built-in board whatever is loaded, and on the built-in board it is the plain night', () => {
    const back = reducer(imported(), { type: 'board/sample' });
    expect(back.home).toBe(back.builtIn.board);
    expect(back).toMatchObject({ source: { kind: 'built-in' }, candle: 10, marginPct: 0, away: [] });
    expect(back.release).toBe(back.builtIn.release);
    const touched = reducer(reducer(initialState(), { type: 'candle/set', step: 2 }), { type: 'tombstone/put-down', key: 'HB-112' });
    const a = reducer(touched, { type: 'board/sample' });
    const b = reducer(touched, { type: 'board/reset' });
    expect({ ...a, change: null }).toEqual({ ...b, change: null });
  });

  test('board/reset keeps your tickets, your release and the banner', () => {
    const state = reducer(imported(), { type: 'candle/set', step: 4 });
    const reset = reducer(state, { type: 'board/reset' });
    expect(reset.home).toBe(state.home);
    expect(reset.source).toBe(state.source);
    expect(reset.release).toBe('q4 freeze');
    expect(reset).toMatchObject({ candle: 10 });
    expect(reset.change).toMatchObject({ subject: { kind: 'reset', yours: true } });
  });

  test('release/set trims, collapses white space, cuts to 60 characters, and blank means none; the same name is the very same state; it leaves the change note alone', () => {
    const state = imported();
    const named = reducer(state, { type: 'release/set', name: '  My   release \n 2 ' });
    expect(named.release).toBe('My release 2');
    expect(named.change).toBe(state.change);
    expect(reducer(named, { type: 'release/set', name: 'My release 2' })).toBe(named);
    expect(reducer(named, { type: 'release/set', name: '   ' }).release).toBeNull();
    expect(reducer(named, { type: 'release/set', name: 'x'.repeat(90) }).release).toBe('x'.repeat(60));
  });

  test('state/restore puts an imported board back exactly', () => {
    const state = imported();
    const other = reducer(state, { type: 'board/sample' });
    expect(reducer(other, { type: 'state/restore', state })).toBe(state);
  });
});