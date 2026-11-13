import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { exhume, resurrect } from '../../src/engine/diff';
import type { ExhumeApplied, ExhumeOutcome } from '../../src/engine/diff';
import { oracleSolve } from '../../src/engine/oracle';
import { solveFreeze } from '../../src/engine/solver';
import type { Board, FreezeInput, ValidBoard } from '../../src/engine/types';
import { atCapacity, ticket, validOf, valid } from './fixtures';
import { arbSolveCase } from './generators';
import { blockedMustHaves, mustHaveNeeded, withMargin } from './reference';

function exhumeOk(board: ValidBoard, freeze: FreezeInput, key: string): ExhumeOutcome {
  const r = exhume(board, freeze, key);
  if (!r.ok) throw new Error(`exhume error: ${r.error.code}`);
  return r.value;
}

function applied(outcome: ExhumeOutcome): ExhumeApplied {
  if (outcome.kind !== 'applied') throw new Error('expected the exhumation to be applied');
  return outcome;
}

const snapshot = (board: Board): string => JSON.stringify(board);

describe('exhume (examples)', () => {
  test('exhuming A brings it back and buries C in exchange', () => {
    const { board, freeze } = atCapacity({ ...validOf([ticket('A', 6, 12), ticket('B', 4, 10), ticket('C', 11, 30)]) }, 11);
    const before = solveFreeze(board, freeze);
    expect(before.ok && before.value.status === 'ok' && before.value.kept).toEqual(['C']);

    const out = applied(exhumeOk(board, freeze, 'A'));
    expect(out.after.kept).toEqual(['A', 'B']);
    expect(out.diff).toEqual({
      raised: [
        { key: 'A', cod: 12 },
        { key: 'B', cod: 10 },
      ],
      sunk: [{ key: 'C', cod: 30 }],
      codDelta: -8,
    });
    expect(out.board.tickets.find((t) => t.key === 'A')?.mustHave).toBe(true);
    expect(out.before.savedCod).toBe(30);
    expect(out.after.savedCod).toBe(22);
  });

  test('exhuming a ticket pulls in its dependency chain', () => {
    const { board, freeze } = atCapacity(
      { ...validOf([ticket('X', 5, 9), ticket('A', 2, 1), ticket('B', 3, 1, { dependsOn: ['A'] })]) },
      5,
    );
    const out = applied(exhumeOk(board, freeze, 'B'));
    expect(out.after.kept).toEqual(['A', 'B']);
    expect(out.diff.sunk).toEqual([{ key: 'X', cod: 9 }]);
    expect(out.diff.codDelta).toBe(2 - 9);
  });

  test('if exhuming would make the freeze impossible, it is rejected with the numbers and nothing is applied', () => {
    const base = validOf([ticket('A', 6, 12, { mustHave: true }), ticket('C', 11, 30)]);
    const { board, freeze } = atCapacity(base, 11);
    const copy = snapshot(board);
    const out = exhumeOk(board, freeze, 'C');
    expect(out).toEqual({
      kind: 'rejected',
      impossible: { status: 'impossible', capacity: 11, effectiveCapacity: 11, marginPct: 0, needed: 17, blockedMustHaves: [] },
    });
    expect(snapshot(board)).toBe(copy);
    expect(board.tickets.find((t) => t.key === 'C')?.mustHave).toBe(false);
  });

  test('the margin is part of the numbers in a rejection', () => {
    const base = validOf([ticket('A', 6, 12), ticket('B', 6, 10)]);
    const { board, freeze } = atCapacity(base, 12, 30); // effective capacity 8
    const out = exhumeOk(board, freeze, 'B');
    expect(out.kind).toBe('applied'); // B alone needs 6 <= 8
    const must = atCapacity(validOf([ticket('A', 6, 12, { mustHave: true }), ticket('B', 6, 10)]), 12, 30);
    expect(exhumeOk(must.board, must.freeze, 'B')).toMatchObject({
      kind: 'rejected',
      impossible: { needed: 12, capacity: 12, effectiveCapacity: 8, marginPct: 30 },
    });
  });

  test('exhuming a ticket that depends on a put-down key is rejected, naming the keys', () => {
    const base = validOf([ticket('A', 1, 1, { dependsOn: ['W-1'] }), ticket('B', 1, 5)], { wontDo: ['W-1'] });
    const { board, freeze } = atCapacity(base, 100);
    expect(exhumeOk(board, freeze, 'A')).toMatchObject({
      kind: 'rejected',
      impossible: { status: 'impossible', blockedMustHaves: [{ key: 'A', putDownKey: 'W-1' }] },
    });
  });

  test('exhuming a ticket that is already kept succeeds and changes nothing', () => {
    const { board, freeze } = atCapacity(validOf([ticket('A', 2, 5), ticket('B', 9, 1)]), 2);
    const out = applied(exhumeOk(board, freeze, 'A'));
    expect(out.diff).toEqual({ raised: [], sunk: [], codDelta: 0 });
    expect(out.after).toEqual(out.before);
  });

  test('an unknown key, or a put-down key, is an error', () => {
    const { board, freeze } = atCapacity(validOf([ticket('A', 1, 1, { dependsOn: ['W-1'] })], { wontDo: ['W-1'] }), 5);
    expect(exhume(board, freeze, 'Z-9')).toEqual({ ok: false, error: { code: 'unknown-key', key: 'Z-9' } });
    expect(exhume(board, freeze, 'W-1')).toEqual({ ok: false, error: { code: 'unknown-key', key: 'W-1' } });
  });

  test('resurrect is exhume', () => {
    expect(resurrect).toBe(exhume);
  });

  test('capacity errors from the freeze input pass through', () => {
    const { board } = atCapacity(validOf([ticket('A', 1, 1)]), 5);
    expect(exhume(board, { now: 1.5, freezeAt: 10, marginPct: 0 }, 'A').ok).toBe(false);
    expect(exhume(board, { now: 0, freezeAt: 10, marginPct: 7 }, 'A').ok).toBe(false);
  });
});

describe('exhume (coverage of the property below, fixed seed)', () => {
  test('the generated cases include applied and rejected exhumations', () => {
    const cases = fc.sample(arbSolveCase({ maxTickets: 12, withWontDo: true, mustHaveRate: 5 }), { numRuns: 400, seed: 11 });
    let applied = 0;
    let rejected = 0;
    for (const c of cases) {
      const { board, freeze } = atCapacity(c.board, c.capacity, c.marginPct);
      const before = solveFreeze(board, freeze);
      if (!before.ok || before.value.status !== 'ok') continue;
      for (const b of before.value.buried) {
        const out = exhume(board, freeze, b.key);
        if (out.ok) out.value.kind === 'applied' ? applied++ : rejected++;
      }
    }
    expect(applied).toBeGreaterThan(100);
    expect(rejected).toBeGreaterThan(5);
  });
});

describe('exhume (properties)', () => {
  test('P10 exhume: the exhumed ticket is kept and the saved cod never rises', () => {
    fc.assert(
      fc.property(arbSolveCase({ maxTickets: 12, withWontDo: true, mustHaveRate: 5 }), fc.nat(), (c, pick) => {
        const { board, freeze } = atCapacity(c.board, c.capacity, c.marginPct);
        const before = solveFreeze(board, freeze);
        if (!before.ok || before.value.status !== 'ok' || before.value.buried.length === 0) return;
        const key = before.value.buried[pick % before.value.buried.length]?.key as string;
        const copy = snapshot(board);

        const out = exhumeOk(board, freeze, key);
        expect(snapshot(board)).toBe(copy); // the input is never changed

        // What the freeze would need with this ticket as a must-have, computed independently.
        const demanded: Board = { ...board, tickets: board.tickets.map((t) => (t.key === key ? { ...t, mustHave: true } : t)) };
        const impossible = mustHaveNeeded(demanded) > withMargin(c.capacity, c.marginPct) || blockedMustHaves(demanded).length > 0;
        expect(out.kind === 'rejected').toBe(impossible);

        if (out.kind === 'applied') {
          expect(out.after.kept).toContain(key);
          expect(out.after.savedCod).toBeLessThanOrEqual(out.before.savedCod);
          expect(out.diff.codDelta).toBe(out.after.savedCod - out.before.savedCod);
          // The re-solved board agrees with brute force.
          const oracle = oracleSolve(valid(out.board), out.after.effectiveCapacity);
          expect(oracle.status === 'ok' && oracle.kept).toEqual(out.after.kept);
        } else {
          expect(out.impossible.needed).toBe(mustHaveNeeded(demanded));
        }
      }),
      { numRuns: 500 },
    );
  });
});
