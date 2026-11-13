import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { burialCost, codParts, costOfDelay, effectiveUrgency } from '../../src/engine/cod';
import { solveWithCapacity } from '../../src/engine/solver';
import { SCALE } from '../../src/engine/types';
import type { Ticket } from '../../src/engine/types';
import { valid } from './fixtures';
import { arbScale, arbSolveCase } from './generators';

function formulaTicket(value: number, urgency: number, risk: number, past: number): Ticket {
  return { key: 'T-1', title: 'T', effort: 1, cost: { kind: 'formula', value, urgency, risk }, mustHave: false, dependsOn: [], past };
}

describe('cost of delay (examples)', () => {
  test('urgency climbs one step of the scale per release left out', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((p) => effectiveUrgency(1, p))).toEqual([1, 2, 3, 5, 8, 13, 20]);
  });

  test('urgency 1 → 5 after 3 releases out (the on-screen example)', () => {
    expect(effectiveUrgency(1, 3)).toBe(5);
  });

  test('urgency 3 → 8 after 2 releases out', () => {
    expect(effectiveUrgency(3, 2)).toBe(8);
  });

  test('urgency stops at 20, however long the ticket has been out', () => {
    expect(effectiveUrgency(20, 0)).toBe(20);
    expect(effectiveUrgency(13, 5)).toBe(20);
    expect(effectiveUrgency(1, 1000)).toBe(20);
  });

  test('an off-scale urgency is a programming error', () => {
    expect(() => effectiveUrgency(4, 0)).toThrow(RangeError);
  });

  test('cod = value + effective urgency + risk', () => {
    expect(costOfDelay(formulaTicket(5, 1, 3, 0))).toBe(9);
    expect(costOfDelay(formulaTicket(5, 1, 3, 3))).toBe(5 + 5 + 3);
    expect(costOfDelay(formulaTicket(20, 20, 20, 4))).toBe(60);
  });

  test('the sample board case: urgency 1 → 5 raises cod 7 to 11', () => {
    // value 3 + urgency 1 + risk 3 = 7 without hunger; three releases out lifts urgency to 5.
    expect(costOfDelay(formulaTicket(3, 1, 3, 0))).toBe(7);
    expect(costOfDelay(formulaTicket(3, 1, 3, 3))).toBe(11);
  });

  test('an imported cod is used as is, with no hunger', () => {
    const t: Ticket = { ...formulaTicket(1, 1, 1, 5), cost: { kind: 'imported', cod: 14 } };
    expect(costOfDelay(t)).toBe(14);
    expect(codParts(t)).toMatchObject({ imported: true, cod: 14, past: 5 });
  });

  test('codParts exposes the parts for the screen', () => {
    expect(codParts(formulaTicket(5, 1, 3, 3))).toEqual({
      imported: false,
      value: 5,
      urgency: 1,
      effectiveUrgency: 5,
      risk: 3,
      past: 3,
      cod: 13,
    });
  });

  test('burying costs cod x weeks', () => {
    expect(burialCost(formulaTicket(5, 1, 3, 0), 2)).toBe(18);
    expect(burialCost(formulaTicket(5, 1, 3, 0), 0)).toBe(0);
  });
});

describe('cost of delay (properties)', () => {
  test('P16 formula: raising value, urgency, risk (or an imported cod) never buries a ticket that was kept', () => {
    const higher = (current: number, pick: number): number => {
      const above = SCALE.filter((s) => s > current);
      return above.length === 0 ? current : (above[pick % above.length] as number);
    };
    fc.assert(
      fc.property(
        arbSolveCase({ maxTickets: 40, withWontDo: true, mustHaveRate: 5 }),
        fc.nat(),
        fc.nat(2),
        fc.nat(),
        fc.integer({ min: 1, max: 20 }),
        (c, which, component, pick, bump) => {
          const before = solveWithCapacity(valid(c.board), c.capacity, c.marginPct);
          if (!before.ok || before.value.status !== 'ok' || before.value.kept.length === 0) return;
          const key = before.value.kept[which % before.value.kept.length] as string;
          const tickets = c.board.tickets.map((t): Ticket => {
            if (t.key !== key) return t;
            if (t.cost.kind === 'imported') return { ...t, cost: { kind: 'imported', cod: t.cost.cod + bump } };
            const { value, urgency, risk } = t.cost;
            const cost =
              component === 0
                ? { kind: 'formula' as const, value: higher(value, pick), urgency, risk }
                : component === 1
                  ? { kind: 'formula' as const, value, urgency: higher(urgency, pick), risk }
                  : { kind: 'formula' as const, value, urgency, risk: higher(risk, pick) };
            return { ...t, cost };
          });
          const after = solveWithCapacity(valid({ ...c.board, tickets }), c.capacity, c.marginPct);
          expect(after.ok && after.value.status).toBe('ok');
          if (after.ok && after.value.status === 'ok') expect(after.value.kept).toContain(key);
        },
      ),
      { numRuns: 500 },
    );
  });

  test('P23 hunger: never decreases with past, never below the urgency, never above 20', () => {
    fc.assert(
      fc.property(arbScale, fc.nat(30), fc.nat(30), (urgency, a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a];
        const atLow = effectiveUrgency(urgency, low);
        const atHigh = effectiveUrgency(urgency, high);
        expect(atHigh).toBeGreaterThanOrEqual(atLow);
        expect(atLow).toBeGreaterThanOrEqual(urgency);
        expect(atHigh).toBeLessThanOrEqual(20);
        expect(SCALE as readonly number[]).toContain(atHigh);
      }),
      { numRuns: 500 },
    );
  });
});
