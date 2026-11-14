import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { fogCurve, simulateFog } from '../../src/engine/fog';
import { nightFacts } from '../../src/engine/facts';
import type { NightFacts, NightInput, OutsideFact, SolvedNight } from '../../src/engine/facts';
import { solveFreeze } from '../../src/engine/solver';
import type { Board, FreezeInput, Ticket, ValidBoard } from '../../src/engine/types';
import { ONE_SLOT_FROM, ONE_SLOT_TO, atCapacity, makeBoard, ticket, valid } from './fixtures';
import { arbNight, arbPermutedBoard } from './generators';

// The facts of a night: what the solver, the fog and a leave-one-out say, and nothing else.

function solvedFacts(input: NightInput): SolvedNight {
  const r = nightFacts(input);
  if (!r.ok) throw new Error(`engine error ${JSON.stringify(r.error)}`);
  if (r.value.status !== 'ok') throw new Error('impossible');
  return r.value;
}

/** A night at an exact capacity, where the tickets in `exhumed` were made must-have by decision. */
function night(tickets: Ticket[], capacity: number, exhumed: string[] = [], over: Partial<Board> = {}, marginPct = 0): NightInput {
  const base = atCapacity(makeBoard(tickets.map((t) => ({ ...t, mustHave: false })), over), capacity, marginPct);
  const board = valid({ ...base.board, tickets: base.board.tickets.map((t) => (exhumed.includes(t.key) ? { ...t, mustHave: true } : t)) });
  return { home: base.board, board, freeze: base.freeze, away: [], release: null };
}

const reasonOf = (facts: SolvedNight, key: string): OutsideFact['reason'] => (facts.outside.find((o) => o.key === key) as OutsideFact).reason;

describe('the stamps', () => {
  test('are the local weekday, date and time in the board zone', () => {
    const input = night([ticket('A', 1, 1)], 5);
    const facts = solvedFacts(input);
    expect(facts.asOf).toEqual({ weekday: 'Mon', date: '2026-10-19', time: '09:00' });
    expect(facts.freeze).toEqual({ weekday: 'Mon', date: '2026-10-19', time: '12:00' });
    expect(facts.zone).toBe('Europe/Madrid');
  });

  test('follow the zone, including a half-hour offset and a date line', () => {
    const base = night([ticket('A', 1, 1)], 5);
    const kolkata = nightFacts({ ...base, home: valid({ ...base.home, timeZone: 'Asia/Kolkata' }), board: valid({ ...base.board, timeZone: 'Asia/Kolkata' }) });
    expect(kolkata.ok && kolkata.value.asOf).toEqual({ weekday: 'Mon', date: '2026-10-19', time: '12:30' });
    const midnight = Date.UTC(2026, 9, 19, 22, 0); // 00:00 Tue in Madrid
    const f = nightFacts({ ...base, freeze: { ...base.freeze, now: midnight, freezeAt: midnight + 3_600_000 } });
    expect(f.ok && f.value.asOf).toEqual({ weekday: 'Tue', date: '2026-10-20', time: '00:00' });
  });
});

describe('the four reasons', () => {
  test('does not fit: the solver says no room and no exhume is involved', () => {
    const facts = solvedFacts(night([ticket('A', 3, 10), ticket('B', 5, 1)], 4));
    expect(reasonOf(facts, 'B')).toEqual({ kind: 'no-room', needed: 5, left: 1 });
  });

  test('follows a buried dependency, naming it', () => {
    const facts = solvedFacts(night([ticket('A', 3, 10), ticket('B', 5, 1), ticket('C', 1, 9, { dependsOn: ['B'] })], 4));
    expect(reasonOf(facts, 'C')).toEqual({ kind: 'depends-on-buried', buriedDependencies: ['B'] });
  });

  test('blocked by a put-down, naming the put-down key, and the put-down lists everything it blocks', () => {
    const wontDo = ticket('W', 2, 5, { title: 'The closed one' });
    const x = ticket('X', 1, 5, { dependsOn: ['W'] });
    const y = ticket('Y', 1, 5, { dependsOn: ['X'] });
    const home = valid(makeBoard([wontDo, x, y, ticket('Z', 1, 5)], { people: [{ name: 'Solo', pointsPerHalfDay: 9, daysOff: [] }] }));
    const board = valid({ ...home, tickets: home.tickets.filter((t) => t.key !== 'W'), wontDo: ['W'] });
    const freeze: FreezeInput = { now: ONE_SLOT_FROM, freezeAt: ONE_SLOT_TO, marginPct: 0 };
    const facts = solvedFacts({ home, board, freeze, away: [], release: 'R' });
    expect(reasonOf(facts, 'X')).toEqual({ kind: 'blocked-by-put-down', putDownKey: 'W' });
    expect(reasonOf(facts, 'Y')).toEqual({ kind: 'blocked-by-put-down', putDownKey: 'W' });
    expect(facts.putDown).toEqual([{ key: 'W', title: 'The closed one', blocks: ['X', 'Y'] }]);
    expect(facts.keys).toEqual(['W', 'X', 'Y', 'Z']);
  });

  test('a put-down that the home board does not have has no title', () => {
    const board = valid(makeBoard([ticket('X', 1, 5, { dependsOn: ['W'] })], { wontDo: ['W'], people: [{ name: 'Solo', pointsPerHalfDay: 9, daysOff: [] }] }));
    const facts = solvedFacts({ home: board, board, freeze: { now: ONE_SLOT_FROM, freezeAt: ONE_SLOT_TO, marginPct: 0 }, away: [], release: null });
    expect(facts.putDown).toEqual([{ key: 'W', title: null, blocks: ['X'] }]);
  });
});

describe('pushed out by an exhume (leave-one-out)', () => {
  test('one exhume among two is the culprit, and only it is named', () => {
    // T (4 points, worth 10) is kept without decisions. E1 (8 points) leaves no room for T; E2 (1 point) does.
    const facts = solvedFacts(night([ticket('T', 4, 10), ticket('E1', 8, 1), ticket('E2', 1, 1), ticket('Q', 9, 1)], 10, ['E1', 'E2']));
    expect(reasonOf(facts, 'T')).toEqual({ kind: 'pushed-out-by-exhume', exhumed: ['E1'], together: false, needed: 4, left: 1 });
    expect(facts.exhumed.map((e) => [e.key, e.pushedOut.map((p) => p.key)])).toEqual([['E1', ['T']], ['E2', []]]);
    // Q was never kept: it simply does not fit.
    expect(reasonOf(facts, 'Q').kind).toBe('no-room');
  });

  test('two exhumes together push out a ticket that neither pushes out alone: the reason names both and says "together"', () => {
    const facts = solvedFacts(night([ticket('T', 4, 10), ticket('E1', 4, 1), ticket('E2', 4, 1)], 10, ['E1', 'E2']));
    expect(reasonOf(facts, 'T')).toEqual({ kind: 'pushed-out-by-exhume', exhumed: ['E1', 'E2'], together: true, needed: 4, left: 2 });
    // Neither one alone does it: each is listed with the other, and marked as "together".
    expect(facts.exhumed.map((e) => e.pushedOut)).toEqual([
      [{ key: 'T', cod: 10, together: true, with: ['E2'] }],
      [{ key: 'T', cod: 10, together: true, with: ['E1'] }],
    ]);
    // The solver agrees with the claim: with only E1 (or only E2) exhumed, T is kept.
    for (const only of ['E1', 'E2']) {
      const input = night([ticket('T', 4, 10), ticket('E1', 4, 1), ticket('E2', 4, 1)], 10, [only]);
      const solved = solveFreeze(input.board, input.freeze);
      expect(solved.ok && solved.value.status === 'ok' && solved.value.kept).toContain('T');
    }
  });

  test('two exhumes that each push the ticket out alone are both named, and the reason does not say "together"', () => {
    const facts = solvedFacts(night([ticket('T', 6, 10), ticket('E1', 5, 1), ticket('E2', 5, 1)], 10, ['E1', 'E2']));
    expect(reasonOf(facts, 'T')).toEqual({ kind: 'pushed-out-by-exhume', exhumed: ['E1', 'E2'], together: false, needed: 6, left: 0 });
  });

  test('no exhumes: nothing is pushed out', () => {
    const facts = solvedFacts(night([ticket('T', 4, 10), ticket('E1', 8, 1)], 10));
    expect(facts.exhumed).toEqual([]);
    expect(facts.outside.every((o) => o.reason.kind !== 'pushed-out-by-exhume')).toBe(true);
  });

  test('an exhume that pushes nothing out says so', () => {
    const facts = solvedFacts(night([ticket('T', 4, 10), ticket('E', 1, 1)], 10, ['E']));
    expect(facts.exhumed).toEqual([{ key: 'E', title: 'E', effort: 1, cod: 1, pushedOut: [] }]);
  });

  test('undoing the exhumes is never impossible: facts exist for every generated night', () => {
    fc.assert(
      fc.property(arbNight, (n) => {
        const r = nightFacts(n);
        expect(r.ok).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});

describe('the cost of the leave-one-out', () => {
  test('a board of 60 tickets with 4 exhumes (nine extra solves) is still made in well under a second or two', () => {
    const tickets = Array.from({ length: 60 }, (_, i) => ticket(`T${i}`, 1 + ((i * 7) % 9), 1 + ((i * 5) % 13)));
    const input = night(tickets, 120, ['T3', 'T17', 'T29', 'T44']);
    const started = Date.now();
    const facts = solvedFacts(input);
    const elapsed = Date.now() - started;
    expect(facts.exhumed).toHaveLength(4);
    expect(elapsed).toBeLessThan(3000); // a generous bound; the measured time is reported in the checkpoint
  });
});

describe('the numbers are the solver\'s and the fog\'s own', () => {
  test('on generated nights: totals, waiting cost, zombies and the fog agree with solveFreeze, simulateFog and fogCurve', () => {
    fc.assert(
      fc.property(arbNight, (n) => {
        const present = { ...n.board, people: n.board.people.filter((p) => !n.away.includes(p.name)) } as ValidBoard;
        const solved = solveFreeze(present, n.freeze);
        const r = nightFacts(n);
        expect(solved.ok && r.ok).toBe(true);
        if (!solved.ok || !r.ok) return;
        const s = solved.value;
        const f = r.value;
        expect(f.capacity).toBe(s.capacity);
        expect(f.reservePct).toBe(s.marginPct);
        expect(f.effectiveCapacity).toBe(s.effectiveCapacity);
        if (s.status === 'impossible') {
          expect(f.status).toBe('impossible');
          if (f.status === 'impossible') expect(f.needed).toBe(s.needed);
          return;
        }
        expect(f.status).toBe('ok');
        if (f.status !== 'ok') return;
        expect(f.kept).toEqual({ count: s.kept.length, effort: s.keptEffort, cod: s.savedCod });
        expect(f.outsideTotals.count).toBe(s.buried.length);
        expect(f.outsideTotals.effort).toBe(s.buriedEffort);
        expect(f.outsideTotals.cod).toBe(s.buriedCod);
        expect(f.outsideTotals.waitingCost).toBe(s.buried.reduce((sum, b) => sum + b.burialCost, 0));
        expect(f.outsideTotals.waitingCost).toBe(f.outsideTotals.cod * present.nextReleaseWeeks);
        expect(f.outside.filter((o) => o.isZombie).map((o) => o.key).sort()).toEqual([...s.zombies].sort());
        const fog = simulateFog(present, s.kept, s.capacity);
        expect(fog.ok && { nights: f.fog.nights, holds: f.fog.holds, pct: f.fog.pct }).toEqual(fog.ok && fog.value);
        const curve = fogCurve(present, n.freeze);
        const point = curve.ok ? curve.value.find((p) => p.marginPct === n.freeze.marginPct) : undefined;
        expect(point?.status === 'ok' && point.fog).toEqual({ nights: f.fog.nights, holds: f.fog.holds, pct: f.fog.pct });
      }),
      { numRuns: 120 },
    );
  });
});

describe('order and purity', () => {
  test('the outside list is by waiting cost, highest first, then by key', () => {
    const facts = solvedFacts(night([ticket('K', 2, 1), ticket('B', 9, 5), ticket('A', 9, 5), ticket('C', 9, 7)], 1));
    expect(facts.outside.map((o) => [o.key, o.waitingCost])).toEqual([['C', 14], ['A', 10], ['B', 10], ['K', 2]]);
  });

  test('the facts do not depend on the order of tickets, people or absences', () => {
    fc.assert(
      fc.property(arbNight, fc.nat(), (n, seed) => {
        const permuted = fc.sample(arbPermutedBoard(n.board), { numRuns: 1, seed })[0] as Board;
        const board = valid(permuted);
        expect(nightFacts({ ...n, board })).toEqual(nightFacts(n));
      }),
      { numRuns: 60 },
    );
  });

  test('the input is not changed, and the same input gives the same facts twice', () => {
    fc.assert(
      fc.property(arbNight, (n) => {
        const frozen = deepFreeze({ ...n, away: [...n.away] });
        const first = nightFacts(frozen);
        expect(nightFacts(frozen)).toEqual(first);
      }),
      { numRuns: 40 },
    );
  });
});

describe('people away, errors and the impossible night', () => {
  test('people away are listed by name and lower the capacity', () => {
    const base = night([ticket('A', 1, 1)], 6);
    const board = valid({ ...base.board, people: [...base.board.people, { name: 'Ana', pointsPerHalfDay: 4, daysOff: [] }] });
    const all = solvedFacts({ ...base, home: board, board });
    const some = solvedFacts({ ...base, home: board, board, away: ['Ana', 'Ana'] });
    expect(all.away).toEqual([]);
    expect(some.away).toEqual(['Ana']);
    expect(all.capacity - some.capacity).toBe(4);
  });

  test('a name that is not on the team is an engine error', () => {
    const r = nightFacts({ ...night([ticket('A', 1, 1)], 5), away: ['Nobody'] });
    expect(r).toEqual({ ok: false, error: { code: 'unknown-key', key: 'Nobody' } });
  });

  test('an impossible freeze has the numbers and no cut', () => {
    const r = nightFacts(night([ticket('A', 9, 1, { mustHave: true })], 5, ['A']));
    expect(r.ok && r.value).toMatchObject({ status: 'impossible', needed: 9, capacity: 5, effectiveCapacity: 5, reservePct: 0, blockedMustHaves: [] });
    const facts = r.ok ? (r.value as NightFacts) : null;
    expect(facts && 'outside' in facts).toBe(false);
  });

  test('a must-have blocked by a put-down is listed', () => {
    const board = valid(makeBoard([ticket('M', 1, 1, { mustHave: true, dependsOn: ['W'] })], { wontDo: ['W'], people: [{ name: 'Solo', pointsPerHalfDay: 9, daysOff: [] }] }));
    const r = nightFacts({ home: board, board, freeze: { now: ONE_SLOT_FROM, freezeAt: ONE_SLOT_TO, marginPct: 0 }, away: [], release: null });
    expect(r.ok && r.value.status === 'impossible' && r.value.blockedMustHaves).toEqual([{ key: 'M', putDownKey: 'W' }]);
  });
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
