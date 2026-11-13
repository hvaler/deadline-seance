import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { solveWithCapacity } from '../../src/engine/solver';
import type { Board, Solution } from '../../src/engine/types';
import { ticket, validOf, valid } from './fixtures';
import { arbBoardForImpossible, arbSolveCase } from './generators';
import { blockedMustHaves, mustHaveNeeded, withMargin } from './reference';

function solve(board: Board, capacity: number, margin = 0): Solution {
  const r = solveWithCapacity(valid(board), capacity, margin);
  if (!r.ok) throw new Error(`solver error: ${r.error.code}`);
  return r.value;
}

describe('impossible freeze (examples)', () => {
  test('the must-haves need 54 points and there are 41: the numbers come from the rule', () => {
    const board = validOf([
      ticket('A-1', 30, 5, { mustHave: true }),
      ticket('A-2', 24, 5, { mustHave: true }),
      ticket('A-3', 3, 9),
    ]);
    const r = solveWithCapacity(board, 41, 0);
    expect(r).toEqual({
      ok: true,
      value: { status: 'impossible', capacity: 41, effectiveCapacity: 41, marginPct: 0, needed: 54, blockedMustHaves: [] },
    });
  });

  test('the margin counts: 54 needed, capacity 60, margin 15 leaves 51', () => {
    const board = validOf([ticket('A-1', 30, 5, { mustHave: true }), ticket('A-2', 24, 5, { mustHave: true })]);
    expect(solve(board, 60, 0).status).toBe('ok');
    expect(solveWithCapacity(board, 60, 15)).toMatchObject({
      ok: true,
      value: { status: 'impossible', capacity: 60, effectiveCapacity: 51, marginPct: 15, needed: 54 },
    });
  });

  test('exactly enough capacity is possible; one point less is not', () => {
    const board = validOf([ticket('A-1', 30, 5, { mustHave: true }), ticket('A-2', 24, 5, { mustHave: true })]);
    expect(solve(board, 54).status).toBe('ok');
    expect(solve(board, 53).status).toBe('impossible');
  });

  test('a must-have counts with its whole dependency chain, and shared dependencies once', () => {
    const board = validOf([
      ticket('D-1', 10, 1),
      ticket('M-1', 5, 1, { mustHave: true, dependsOn: ['D-1'] }),
      ticket('M-2', 5, 1, { mustHave: true, dependsOn: ['D-1'] }),
    ]);
    expect(solve(board, 20).status).toBe('ok');
    expect(solveWithCapacity(board, 19, 0)).toMatchObject({ ok: true, value: { status: 'impossible', needed: 20 } });
  });

  test('a must-have that depends on a put-down key is impossible at any capacity, and names both keys', () => {
    const board = validOf(
      [ticket('M-1', 1, 1, { mustHave: true, dependsOn: ['A-1'] }), ticket('A-1', 1, 1, { dependsOn: ['W-2', 'W-1'] })],
      { wontDo: ['W-1', 'W-2'] },
    );
    expect(solveWithCapacity(board, 1_000, 0)).toEqual({
      ok: true,
      value: {
        status: 'impossible',
        capacity: 1_000,
        effectiveCapacity: 1_000,
        marginPct: 0,
        needed: 2,
        blockedMustHaves: [{ key: 'M-1', putDownKey: 'W-1' }],
      },
    });
  });

  test('a board with no must-haves is never impossible, even with capacity 0', () => {
    expect(solve(validOf([ticket('A', 1, 1)]), 0).status).toBe('ok');
  });
});

describe('impossible freeze (properties)', () => {
  test('P9 impossible iff: the rule says impossible exactly when the must-haves with their dependencies exceed the capacity (or one is blocked)', () => {
    fc.assert(
      fc.property(arbBoardForImpossible({ withWontDo: true }), ({ board, capacity, marginPct }) => {
        const sol = solve(board, capacity, marginPct);
        const limit = withMargin(capacity, marginPct);
        const needed = mustHaveNeeded(board);
        const blocked = blockedMustHaves(board);
        const expectImpossible = needed > limit || blocked.length > 0;
        expect(sol.status === 'impossible').toBe(expectImpossible);
        if (sol.status === 'impossible') {
          expect(sol.needed).toBe(needed);
          expect(sol.capacity).toBe(capacity);
          expect(sol.effectiveCapacity).toBe(limit);
          expect(sol.blockedMustHaves).toEqual(blocked);
        }
      }),
      { numRuns: 1000 },
    );
  });

  test('P9 impossible iff (no put-down keys): exactly "needed > effective capacity"', () => {
    fc.assert(
      fc.property(arbBoardForImpossible({ maxTickets: 40 }), ({ board, capacity, marginPct }) => {
        const sol = solve(board, capacity, marginPct);
        expect(sol.status === 'impossible').toBe(mustHaveNeeded(board) > withMargin(capacity, marginPct));
      }),
      { numRuns: 500 },
    );
  });

  test('P9 on large boards with few must-haves', () => {
    fc.assert(
      fc.property(arbSolveCase({ maxTickets: 80, mustHaveRate: 5, withWontDo: true }), (c) => {
        const sol = solve(c.board, c.capacity, c.marginPct);
        const expectImpossible =
          mustHaveNeeded(c.board) > withMargin(c.capacity, c.marginPct) || blockedMustHaves(c.board).length > 0;
        expect(sol.status === 'impossible').toBe(expectImpossible);
      }),
      { numRuns: 200 },
    );
  });
});
