import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { compareKeys, deathCertificate, decisionLine, guardCertificate, importCsv, nightFacts, validateBoard } from '../../src/engine/index';
import type { Board, ValidBoard } from '../../src/engine/index';
import { arbBoard } from '../engine/generators';
import { CHRONICLE_CAP, canUndo, undoTo } from '../../src/ui/chronicle';
import { curveFor } from '../../src/ui/fog-cache';
import { initialState, initialStateFor } from '../../src/ui/model';
import { nightInputOf } from '../../src/ui/night';
import { compareStates, solveState } from '../../src/ui/solve';
import { decide, reducer } from '../../src/ui/state';
import type { Action, AppState, Subject } from '../../src/ui/state';
import { sampleBoard } from '../../src/ui/sample-board';
import { statesAfter } from './arbitraries';
// The night chronicle at state level: which actions write an entry, what an entry says, and P25 (undo gives back exactly the previous night).
const lines = (state: AppState): string[] => state.chronicle.entries.map((e) => decisionLine(e.facts));
/** The state of a night apart from what undo deliberately leaves alone (`sound`, `release`) and the note of the last action. */
const night = (state: AppState): unknown => ({ ...state, sound: null, release: null });
// ---- generators -------------------------------------------------------------------------------------------------------------
/** A generated board with the sample's team and calendar (a board with no people has capacity 0, so every freeze would be impossible). */
function withSampleTeam(board: Board): ValidBoard {
  const r = validateBoard({ ...sampleBoard(), tickets: board.tickets, wontDo: board.wontDo });
  if (!r.ok) throw new Error(`generated board is invalid: ${JSON.stringify(r.error)}`);
  return r.value;
}
const arbNightBoard = arbBoard({ maxTickets: 12, withWontDo: true, mustHaveRate: 15 }).map(withSampleTeam);
type Pick =
  | { readonly kind: 'candle' | 'reserve'; readonly steps: readonly number[] }
  | { readonly kind: 'survivor' | 'exhume' | 'resurrect' | 'put-down'; readonly pick: number; readonly unknown: boolean }
  | { readonly kind: 'reset' | 'sample' }
  | { readonly kind: 'load'; readonly which: number }
  | { readonly kind: 'release'; readonly name: string }
  | { readonly kind: 'sound'; readonly on: boolean };
const arbPick: fc.Arbitrary<Pick> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ kind: fc.constant('candle' as const), steps: fc.array(fc.integer({ min: -1, max: 11 }), { minLength: 1, maxLength: 5 }) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('reserve' as const), steps: fc.array(fc.constantFrom(0, 5, 10, 15, 20, 25, 30, 7), { minLength: 1, maxLength: 5 }) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('survivor' as const), pick: fc.nat(), unknown: fc.boolean() }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('exhume' as const), pick: fc.nat(), unknown: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('resurrect' as const), pick: fc.nat(), unknown: fc.boolean() }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('put-down' as const), pick: fc.nat(), unknown: fc.boolean() }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('reset' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('sample' as const) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('load' as const), which: fc.integer({ min: 0, max: 1 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('release' as const), name: fc.string({ maxLength: 12 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('sound' as const), on: fc.boolean() }) },
);
interface Case {
  readonly board: ValidBoard;
  readonly loads: readonly ValidBoard[];
  readonly picks: readonly Pick[];
}
const arbCase: fc.Arbitrary<Case> = fc.record({
  board: arbNightBoard,
  loads: fc.array(arbNightBoard, { minLength: 2, maxLength: 2 }),
  picks: fc.array(arbPick, { maxLength: 30 }),
});
/** Makes one pick into what the page does: a gesture of steps and its settle, or one action. */
function run(state: AppState, pick: Pick, loads: readonly ValidBoard[]): AppState {
  switch (pick.kind) {
    case 'candle':
    case 'reserve': {
      let s = state;
      for (const value of pick.steps) s = reducer(s, pick.kind === 'candle' ? { type: 'candle/set', step: value } : { type: 'reserve/set', pct: value });
      const subject: Subject | null =
        pick.kind === 'candle'
          ? state.candle === s.candle ? null : { kind: 'candle', from: state.candle, to: s.candle }
          : state.marginPct === s.marginPct ? null : { kind: 'reserve', from: state.marginPct, to: s.marginPct };
      return subject === null ? s : reducer(s, { type: 'chronicle/settle', from: state, subject });
    }
    case 'survivor': {
      const names = state.board.people.map((p) => p.name);
      return reducer(state, { type: 'survivor/toggle', name: pick.unknown || names.length === 0 ? 'Nobody' : (names[pick.pick % names.length] as string) });
    }
    case 'exhume':
    case 'resurrect':
    case 'put-down': {
      const keys = [...state.board.tickets.map((t) => t.key)].sort(compareKeys);
      const key = pick.unknown || keys.length === 0 ? 'ZZ-0' : (keys[pick.pick % keys.length] as string);
      return reducer(state, { type: `tombstone/${pick.kind}`, key });
    }
    case 'reset':
      return reducer(state, { type: 'board/reset' });
    case 'sample':
      return reducer(state, { type: 'board/sample' });
    case 'load':
      return reducer(state, { type: 'board/load', board: loads[pick.which] as ValidBoard, name: `file${pick.which}.csv`, release: null, skipped: 0, warnings: [], putDown: [] });
    case 'release':
      return reducer(state, { type: 'release/set', name: pick.name });
    case 'sound':
      return reducer(state, { type: 'sound/set', on: pick.on });
  }
}
const UNDO_LAST = (state: AppState): AppState => reducer(state, { type: 'chronicle/undo', to: state.chronicle.entries.length - 1 });
/** What undo must give back: the state before, with the sound as it is now and the release by the rule of the spec (D10). */
function expectedBefore(before: AppState, now: AppState): AppState {
  return { ...before, sound: now.sound, release: before.home === now.home ? now.release : before.release };
}
// ---- P25 --------------------------------------------------------------------------------------------------------------------
describe('P25 undo', () => {
  test('P25 undo after any action gives exactly the previous state, solution, diff, fog and certificate', () => {
    fc.assert(
      fc.property(arbCase, ({ board, loads, picks }) => {
        let state = initialStateFor(board);
        for (const pick of picks) {
          const before = state;
          const after = run(before, pick, loads);
          state = after;
          if (after.chronicle === before.chronicle) continue; // nothing was decided: nothing to undo
          expect(canUndo(after)).toBe(true);
          const undone = UNDO_LAST(after);
          // the previous state, deep equal (the chronicle too: the entries before this one, or the previous board's whole log)
          expect(undone).toEqual(expectedBefore(before, after));
          // the previous solution, the same diff, the same fog and the same certificate
          expect(solveState(undone)).toEqual(solveState(before));
          expect(compareStates(undone, after)).toEqual(compareStates(before, after));
          expect(curveFor(undone)).toEqual(curveFor(before));
          const note = (s: AppState): string => {
            const r = nightFacts(nightInputOf(s));
            if (!r.ok) throw new Error(JSON.stringify(r.error));
            expect(guardCertificate(r.value).ok).toBe(true);
            return deathCertificate(r.value);
          };
          expect(note(undone)).toBe(note(expectedBefore(before, after)));
        }
      }),
      { numRuns: 60 },
    );
  });
  test('P25 undoing everything returns to the start', () => {
    fc.assert(
      fc.property(arbCase, ({ board, loads, picks }) => {
        const start = initialStateFor(board);
        let state = start;
        for (const pick of picks) state = run(state, pick, loads);
        for (let n = 0; canUndo(state) && n < 200; n++) {
          const next = UNDO_LAST(state);
          expect(next).not.toBe(state);
          state = next;
        }
        // The note of the last refused action, the sound and the release name are not part of the night.
        const quiet = { kind: 'none' } as const;
        expect(night({ ...state, change: quiet })).toEqual(night({ ...start, change: quiet }));
        expect(state.chronicle.entries).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });
  test('P25 undo to here removes that entry and every later one and gives back the state before it', () => {
    fc.assert(
      fc.property(arbCase, fc.nat(), ({ board, loads, picks }, which) => {
        const states: AppState[] = [initialStateFor(board)];
        for (const pick of picks) states.push(run(states[states.length - 1] as AppState, pick, loads));
        const end = states[states.length - 1] as AppState;
        const entries = end.chronicle.entries;
        if (entries.length === 0) return;
        const to = which % entries.length;
        const target = entries[to] as AppState['chronicle']['entries'][number];
        const back = undoTo(end, to);
        expect(back).toEqual({ ...target.before, chronicle: target.previous ?? { entries: entries.slice(0, to), dropped: 0, lost: false }, sound: end.sound, release: target.before.home === end.home ? end.release : target.before.release });
        if (target.previous === null) expect(back.chronicle.entries.length).toBe(to);
      }),
      { numRuns: 60 },
    );
  });
});
describe('the P25 generator is not vacuous', () => {
  test('its sequences write many entries, including loads, resets, put-downs and exhumes, and some actions that write nothing', () => {
    const kinds = new Set<string>();
    let written = 0;
    let skipped = 0;
    for (const { board, loads, picks } of fc.sample(arbCase, { numRuns: 80, seed: 25 })) {
      let state = initialStateFor(board);
      for (const pick of picks) {
        const next = run(state, pick, loads);
        if (next.chronicle !== state.chronicle) {
          written++;
          kinds.add(next.chronicle.entries.at(-1)?.facts.subject.kind ?? '');
        } else skipped++;
        state = next;
      }
    }
    expect(written).toBeGreaterThan(100);
    expect(skipped).toBeGreaterThan(100);
    for (const kind of ['candle', 'reserve', 'away', 'exhume', 'put-down', 'reset', 'load', 'sample']) expect(kinds.has(kind), kind).toBe(true);
  });
});
// ---- what is an entry -------------------------------------------------------------------------------------------------------
describe('which actions write an entry', () => {
  test('the sequence of the spec on the sample board, line by line, with the engine\'s numbers (design section 6)', () => {
    const states = statesAfter([
      { type: 'reserve/set', pct: 20 },
      { type: 'reserve/set', pct: 0 },
      { type: 'candle/set', step: 1 },
      { type: 'candle/set', step: 10 },
      { type: 'candle/set', step: 6 },
      { type: 'survivor/toggle', name: 'Ana' },
      { type: 'tombstone/put-down', key: 'HB-112' },
      { type: 'tombstone/exhume', key: 'HB-108' },
    ]);
    expect(lines(states[states.length - 1] as AppState)).toEqual([
      'Reserve 20 % \u2192 HB-113, HB-115 out (\u221227)',
      'Reserve 0 % \u2192 HB-113, HB-115 in (+27)',
      'Freeze moved to Mon 13:00 \u2192 impossible: needs 15 points, 6 available',
      'Freeze moved to Fri 18:00 \u2192 possible again: 12 in, saved cost of delay 167',
      'Freeze moved to Wed 18:00 \u2192 HB-105, HB-113, HB-115, HB-118 out (\u221254)',
      'Ana leaves \u2192 HB-105 in; HB-104, HB-106, HB-107, HB-116 out (\u221234)',
      'Put down HB-112 \u2192 no change',
      'Exhumed HB-108 \u2192 in; HB-105, HB-109 out (\u221216)',
    ]);
  });
  test('an exhume the engine rejects, one it refuses, a sound change and a release name write nothing', () => {
    const wed = statesAfter([{ type: 'candle/set', step: 6 }]).at(-1) as AppState;
    for (const action of [
      { type: 'tombstone/exhume', key: 'HB-119' },
      { type: 'tombstone/exhume', key: 'ZZ-9' },
      { type: 'tombstone/put-down', key: 'HB-108' },
      { type: 'sound/set', on: true },
      { type: 'release/set', name: 'Q4' },
    ] satisfies Action[]) {
      expect(reducer(wed, action).chronicle).toBe(wed.chronicle);
    }
    // the rejected one still says so in the change note
    expect(reducer(wed, { type: 'tombstone/exhume', key: 'HB-119' }).change.kind).toBe('rejected');
  });
  test('a reset that leaves the night as it was writes nothing; one that changes it does, and keeps the log', () => {
    const fresh = initialState();
    expect(reducer(fresh, { type: 'board/reset' }).chronicle).toBe(fresh.chronicle);
    const moved = decide(fresh, { type: 'candle/set', step: 6 });
    const reset = reducer(moved, { type: 'board/reset' });
    expect(reset.chronicle.entries).toHaveLength(2);
    expect(lines(reset)[1]).toMatch(/^Reset \u2192 HB-105, HB-113, HB-115, HB-118 in \(\+54\)$/);
    expect(reset.candle).toBe(10);
  });
  test('candle and reserve steps write nothing by themselves; the settle writes one entry for the whole gesture', () => {
    const start = initialState();
    let s = start;
    for (const step of [9, 8, 7, 6]) s = reducer(s, { type: 'candle/set', step });
    expect(s.chronicle).toBe(start.chronicle);
    const settled = reducer(s, { type: 'chronicle/settle', from: start, subject: { kind: 'candle', from: 10, to: 6 } });
    expect(lines(settled)).toEqual(['Freeze moved to Wed 18:00 \u2192 HB-105, HB-113, HB-115, HB-118 out (\u221254)']);
    // a drag that ends where it began writes nothing, and a settle that lies about the values is ignored
    const there = reducer(reducer(start, { type: 'candle/set', step: 3 }), { type: 'candle/set', step: 10 });
    expect(reducer(there, { type: 'chronicle/settle', from: start, subject: { kind: 'candle', from: 10, to: 10 } })).toBe(there);
    expect(reducer(s, { type: 'chronicle/settle', from: start, subject: { kind: 'candle', from: 10, to: 2 } })).toBe(s);
  });
  test('a settle is ignored when something else was written during the gesture', () => {
    const start = initialState();
    const moving = reducer(start, { type: 'candle/set', step: 6 });
    const interleaved = reducer(moving, { type: 'survivor/toggle', name: 'Ana' });
    expect(interleaved.chronicle.entries).toHaveLength(1);
    expect(reducer(interleaved, { type: 'chronicle/settle', from: start, subject: { kind: 'candle', from: 10, to: 6 } })).toBe(interleaved);
  });
  test('entries are numbered 1, 2, 3 in order, and an entry keeps the state before it by reference', () => {
    const states = statesAfter([
      { type: 'survivor/toggle', name: 'Ana' },
      { type: 'survivor/toggle', name: 'Ana' },
      { type: 'tombstone/exhume', key: 'HB-108' },
    ]);
    const end = states.at(-1) as AppState;
    expect(end.chronicle.entries.map((e) => e.no)).toEqual([1, 2, 3]);
    expect(end.chronicle.entries[0]?.before.board).toBe(states[0]?.board);
    expect(lines(end)[1]).toMatch(/^Ana is back/);
    expect('chronicle' in (end.chronicle.entries[0]?.before ?? {})).toBe(false);
  });
});
// ---- undo ------------------------------------------------------------------------------------------------------------------
describe('undo', () => {
  test('Undo takes back the last decision; Undo to here removes it and every later one', () => {
    const states = statesAfter([
      { type: 'candle/set', step: 6 },
      { type: 'survivor/toggle', name: 'Ana' },
      { type: 'tombstone/exhume', key: 'HB-108' },
    ]);
    const end = states.at(-1) as AppState;
    const one = UNDO_LAST(end);
    expect(one).toEqual(expectedBefore(states[2] as AppState, end));
    expect(one.chronicle.entries).toHaveLength(2);
    const to1 = undoTo(end, 1);
    expect(to1).toEqual(expectedBefore(states[1] as AppState, end));
    const to0 = undoTo(end, 0);
    expect(to0).toEqual(expectedBefore(states[0] as AppState, end));
    expect(to0.chronicle.entries).toEqual([]);
    expect(undoTo(end, 3)).toBe(end);
    expect(undoTo(end, -1)).toBe(end);
    expect(undoTo(initialState(), 0)).toEqual(initialState());
  });
  test('undo keeps the sound as it is now, and the release name while the board is the same', () => {
    const a = statesAfter([{ type: 'candle/set', step: 6 }]).at(-1) as AppState;
    const b = reducer(reducer(a, { type: 'sound/set', on: true }), { type: 'release/set', name: 'Q4 freeze' });
    const back = UNDO_LAST(b);
    expect(back.sound).toBe(true);
    expect(back.release).toBe('Q4 freeze');
    expect(back.candle).toBe(10);
  });
  test('a load starts a new chronicle whose entry 1 is the load, and undoing it brings back the previous board and its whole log', () => {
    const base = statesAfter([{ type: 'candle/set', step: 6 }, { type: 'survivor/toggle', name: 'Ana' }]).at(-1) as AppState;
    const csv = 'Issue key,Summary,Story Points,Cost of Delay\nZ-1,One,5,9\nZ-2,Two,3,4\n';
    const r = importCsv(csv, { people: base.home.people, timeZone: base.home.timeZone, nextReleaseWeeks: base.home.nextReleaseWeeks, zombieThreshold: base.home.zombieThreshold });
    if (!r.ok) throw new Error('import failed');
    const loaded = reducer(base, { type: 'board/load', board: r.value.board, name: 'q4.csv', release: 'q4', skipped: 0, warnings: [], putDown: [] });
    expect(lines(loaded)).toEqual(['Loaded q4.csv: 2 open tickets']);
    expect(loaded.chronicle.entries[0]?.no).toBe(1);
    const moved = decide(loaded, { type: 'survivor/toggle', name: 'Bruno' });
    expect(lines(moved)).toHaveLength(2);
    const back = undoTo(moved, 0);
    expect(back).toEqual(expectedBefore(base, moved));
    expect(back.chronicle).toBe(base.chronicle);
    expect(lines(back)).toHaveLength(2);
    // back to the sample board is the same kind of entry
    const sample = reducer(moved, { type: 'board/sample' });
    expect(lines(sample)).toEqual(['Back to the sample board: 19 tickets']);
    expect(undoTo(sample, 0).chronicle).toBe(moved.chronicle);
  });
});
// ---- the cap ---------------------------------------------------------------------------------------------------------------
describe('the cap', () => {
  function toggles(n: number): AppState {
    let s = initialState();
    for (let i = 0; i < n; i++) s = reducer(s, { type: 'survivor/toggle', name: 'Ana' });
    return s;
  }
  test('50 entries are kept; the 51st drops the oldest and the numbering goes on', () => {
    expect(toggles(50).chronicle.entries).toHaveLength(CHRONICLE_CAP);
    const s = toggles(51);
    expect(s.chronicle.entries).toHaveLength(CHRONICLE_CAP);
    expect(s.chronicle.dropped).toBe(1);
    expect(s.chronicle.entries[0]?.no).toBe(2);
    expect(s.chronicle.entries.at(-1)?.no).toBe(51);
  });
  test('after 120 decisions the log holds the newest 50 and undoing all of them gives the state before the oldest listed, not the start', () => {
    let s = toggles(120);
    expect(s.chronicle.dropped).toBe(70);
    expect(s.chronicle.entries.map((e) => e.no)).toEqual(Array.from({ length: 50 }, (_, i) => 71 + i));
    const oldest = s.chronicle.entries[0]!;
    for (let n = 0; canUndo(s) && n < 200; n++) s = UNDO_LAST(s);
    expect(s.away).toEqual(oldest.before.away);
    expect(s.chronicle.dropped).toBe(70);
    expect(s.chronicle.entries).toEqual([]);
  });
  test('nothing keeps a dropped entry alive: no entry keeps a chronicle except a load or sample entry', () => {
    const s = toggles(60);
    for (const e of s.chronicle.entries) {
      expect(e.previous).toBeNull();
      expect('chronicle' in e.before).toBe(false);
    }
  });
  test('a dropped load entry takes the previous board\'s log with it, and the chronicle says so', () => {
    let s = reducer(initialState(), { type: 'board/sample' });
    expect(s.chronicle.lost).toBe(false);
    for (let i = 0; i < 50; i++) s = reducer(s, { type: 'survivor/toggle', name: 'Ana' });
    expect(s.chronicle.dropped).toBe(1);
    expect(s.chronicle.lost).toBe(true);
    expect(s.chronicle.entries.every((e) => e.previous === null)).toBe(true);
  });
});
// ---- the tour --------------------------------------------------------------------------------------------------------------
describe('the tour writes nothing', () => {
  test('tour/step runs the inner action and leaves the chronicle as it was', () => {
    const user = statesAfter([{ type: 'candle/set', step: 6 }, { type: 'survivor/toggle', name: 'Ana' }]).at(-1) as AppState;
    for (const action of [
      { type: 'board/reset' },
      { type: 'board/sample' },
      { type: 'candle/set', step: 2 },
      { type: 'survivor/toggle', name: 'Bruno' },
      { type: 'tombstone/exhume', key: 'HB-108' },
    ] satisfies Action[]) {
      const next = reducer(user, { type: 'tour/step', action });
      expect(next.chronicle).toBe(user.chronicle);
      expect(next).toEqual({ ...reducer(user, action), chronicle: user.chronicle });
    }
    expect(reducer(user, { type: 'tour/step', action: { type: 'tombstone/exhume', key: 'ZZ-9' } }).chronicle).toBe(user.chronicle);
  });
});
