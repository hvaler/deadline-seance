import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { validateBoard } from '../../src/engine/validate';
import {
  ZONES,
  arbBoard,
  arbBoardForImpossible,
  arbCapacity,
  arbCapacityCase,
  arbMargin,
  arbPermutedBoard,
  arbScale,
  canonicalBoard,
  mustHaveNeed,
  totalEffort,
} from './generators';
import { SCALE } from '../../src/engine/types';

const RUNS = 200;
const SEED = 20261112;

describe('generators produce valid data', () => {
  test('small boards (0-12 tickets) pass validateBoard', () => {
    fc.assert(fc.property(arbBoard({ maxTickets: 12 }), (board) => validateBoard(board).ok), { numRuns: RUNS });
  });

  test('large boards (up to 80 tickets) pass validateBoard', () => {
    fc.assert(fc.property(arbBoard({ maxTickets: 80 }), (board) => validateBoard(board).ok), { numRuns: 50 });
  });

  test('boards with put-down keys pass validateBoard', () => {
    fc.assert(fc.property(arbBoard({ maxTickets: 12, withWontDo: true }), (board) => validateBoard(board).ok), { numRuns: RUNS });
  });

  test('boards respect minTickets, maxTickets and unique keys', () => {
    fc.assert(
      fc.property(arbBoard({ minTickets: 3, maxTickets: 8 }), (board) => {
        expect(board.tickets.length).toBeGreaterThanOrEqual(3);
        expect(board.tickets.length).toBeLessThanOrEqual(8);
        expect(new Set(board.tickets.map((t) => t.key)).size).toBe(board.tickets.length);
      }),
      { numRuns: RUNS },
    );
  });

  test('impossible cases are valid boards with a non-negative integer capacity', () => {
    fc.assert(
      fc.property(arbBoardForImpossible({ withWontDo: true }), ({ board, capacity, marginPct }) => {
        expect(validateBoard(board).ok).toBe(true);
        expect(Number.isSafeInteger(capacity) && capacity >= 0).toBe(true);
        expect(marginPct % 5).toBe(0);
      }),
      { numRuns: RUNS },
    );
  });

  test('capacity cases: sorted instants, valid people and absences, known zone', () => {
    fc.assert(
      fc.property(arbCapacityCase, ({ window, people, instants }) => {
        expect(ZONES).toContain(window.timeZone);
        for (let i = 1; i < instants.length; i++) expect(instants[i]).toBeGreaterThanOrEqual(instants[i - 1] as number);
        const board = { tickets: [], people, timeZone: window.timeZone, nextReleaseWeeks: 2, zombieThreshold: 3, wontDo: [], fogSeed: 0 };
        expect(validateBoard(board).ok).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });

  test('scale and margin arbitraries stay on their sets', () => {
    fc.assert(fc.property(arbScale, (s) => (SCALE as readonly number[]).includes(s)), { numRuns: RUNS });
    fc.assert(fc.property(arbMargin, (m) => m >= 0 && m <= 30 && m % 5 === 0), { numRuns: RUNS });
  });

  test('arbCapacity stays within 0 and total effort + 3', () => {
    fc.assert(
      fc.property(
        arbBoard({ maxTickets: 12 }).chain((board) => fc.tuple(fc.constant(board), arbCapacity(board))),
        ([board, capacity]) => capacity >= 0 && capacity <= totalEffort(board) + 3,
      ),
      { numRuns: RUNS },
    );
  });
});

describe('permutation helper', () => {
  test('keeps the same content (after sorting every list) and stays valid', () => {
    fc.assert(
      fc.property(
        arbBoard({ maxTickets: 12, withWontDo: true }).chain((board) => fc.tuple(fc.constant(board), arbPermutedBoard(board))),
        ([board, permuted]) => {
          expect(canonicalBoard(permuted)).toEqual(canonicalBoard(board));
          expect(validateBoard(permuted).ok).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
  });

  test('actually reorders (not the identity every time)', () => {
    const pairs = fc.sample(
      arbBoard({ minTickets: 6, maxTickets: 12 }).chain((board) => fc.tuple(fc.constant(board), arbPermutedBoard(board))),
      { numRuns: 50, seed: SEED },
    );
    const changed = pairs.filter(([a, b]) => JSON.stringify(a.tickets) !== JSON.stringify(b.tickets));
    expect(changed.length).toBeGreaterThan(25);
  });
});

describe('generator coverage (fixed seed)', () => {
  const boards = fc.sample(arbBoard({ maxTickets: 12, withWontDo: true }), { numRuns: 400, seed: SEED });
  const tickets = boards.flatMap((b) => b.tickets);

  test('the cases the properties need all occur', () => {
    expect(boards.some((b) => b.tickets.length === 0)).toBe(true);
    expect(boards.some((b) => b.tickets.length === 12)).toBe(true);
    expect(tickets.some((t) => t.dependsOn.length > 0)).toBe(true);
    expect(tickets.some((t) => t.mustHave)).toBe(true);
    expect(tickets.some((t) => t.effort === 0)).toBe(true);
    expect(tickets.some((t) => t.cost.kind === 'imported')).toBe(true);
    expect(tickets.some((t) => t.cost.kind === 'formula')).toBe(true);
    expect(tickets.some((t) => t.past >= 3)).toBe(true);
    expect(boards.some((b) => b.wontDo.length > 0)).toBe(true);
    expect(boards.some((b) => b.tickets.some((t) => t.dependsOn.some((d) => b.wontDo.includes(d))))).toBe(true);
  });

  test('keys mix prefixes, so alphabetical order differs from numeric order', () => {
    expect(new Set(tickets.map((t) => t.key.split('-')[0])).size).toBe(3);
  });

  test('must-haves are the minority in the default boards', () => {
    const must = tickets.filter((t) => t.mustHave).length;
    expect(must / tickets.length).toBeLessThan(0.25);
  });

  test('impossible cases hit both branches', () => {
    const cases = fc.sample(arbBoardForImpossible(), { numRuns: 400, seed: SEED });
    const impossible = cases.filter((c) => mustHaveNeed(c.board) > Math.floor((c.capacity * (100 - c.marginPct)) / 100));
    expect(impossible.length).toBeGreaterThan(40);
    expect(cases.length - impossible.length).toBeGreaterThan(40);
  });

  test('capacity cases cover every zone and window', () => {
    const cases = fc.sample(arbCapacityCase, { numRuns: 300, seed: SEED });
    expect(new Set(cases.map((c) => c.window.timeZone)).size).toBe(ZONES.length);
    expect(new Set(cases.map((c) => c.window.startDate)).size).toBe(3);
    expect(cases.some((c) => c.people.some((p) => p.daysOff.length > 0))).toBe(true);
  });
});
