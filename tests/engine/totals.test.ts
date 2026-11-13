import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { costOfDelay } from '../../src/engine/cod';
import { solveWithCapacity } from '../../src/engine/solver';
import { ticket, validOf, valid } from './fixtures';
import { arbSolveCase } from './generators';

// Totals added for the UI (spec board-ui, Requirement 19). They are sums of numbers the engine already returns, so they are
// named without a P number: they are not properties of the rule.

describe('totals of a solution', () => {
  test('example: kept 59 of a board of 188 leaves 129 buried', () => {
    const board = validOf([ticket('A', 6, 12), ticket('B', 4, 10), ticket('C', 11, 30)]);
    const r = solveWithCapacity(board, 10, 0);
    if (!r.ok || r.value.status !== 'ok') throw new Error('expected a solution');
    expect(r.value).toMatchObject({ keptEffort: 10, savedCod: 22, buriedEffort: 11, buriedCod: 30 });
  });

  test('an empty board and a board that fits entirely have empty buried totals', () => {
    for (const board of [validOf([]), validOf([ticket('A', 2, 3), ticket('B', 3, 4)])]) {
      const r = solveWithCapacity(board, 100, 0);
      expect(r.ok && r.value.status === 'ok' && [r.value.buriedEffort, r.value.buriedCod]).toEqual([0, 0]);
    }
  });

  test('kept + buried effort is the total effort, and saved + buried cod is the total cod', () => {
    fc.assert(
      fc.property(arbSolveCase({ maxTickets: 40, withWontDo: true, mustHaveRate: 3 }), (c) => {
        const r = solveWithCapacity(valid(c.board), c.capacity, c.marginPct);
        if (!r.ok || r.value.status !== 'ok') return;
        const totalEffort = c.board.tickets.reduce((s, t) => s + t.effort, 0);
        const totalCod = c.board.tickets.reduce((s, t) => s + costOfDelay(t), 0);
        expect(r.value.keptEffort + r.value.buriedEffort).toBe(totalEffort);
        expect(r.value.savedCod + r.value.buriedCod).toBe(totalCod);
        expect(r.value.buriedEffort).toBe(r.value.buried.reduce((s, b) => s + (c.board.tickets.find((t) => t.key === b.key)?.effort ?? 0), 0));
        expect(r.value.buriedCod).toBe(r.value.buried.reduce((s, b) => s + b.cod, 0));
      }),
      { numRuns: 300 },
    );
  });
});
