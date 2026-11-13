import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { diffSolutions } from '../../src/engine/diff';
import { solveWithCapacity } from '../../src/engine/solver';
import type { Diff, Solution, SolvedSolution } from '../../src/engine/types';
import { ticket, validOf, valid } from './fixtures';
import { arbBoard, arbCapacity, arbMargin } from './generators';

function solved(board: ReturnType<typeof validOf>, capacity: number, margin = 0): SolvedSolution {
  const r = solveWithCapacity(board, capacity, margin);
  if (!r.ok || r.value.status !== 'ok') throw new Error('expected a solution');
  return r.value;
}

function diffOf(before: Solution, after: Solution): Diff {
  const r = diffSolutions(before, after);
  if (!r.ok) throw new Error(`diff error: ${r.error.code}`);
  return r.value;
}

const sum = (entries: readonly { cod: number }[]): number => entries.reduce((s, e) => s + e.cod, 0);

describe('diffSolutions (examples)', () => {
  const board = validOf([ticket('A', 6, 12), ticket('B', 4, 10), ticket('C', 11, 30)]);

  test('"C rises (30). A and B sink (22). Gain: 8": the jump when the candle moves', () => {
    const diff = diffOf(solved(board, 10), solved(board, 11));
    expect(diff).toEqual({
      raised: [{ key: 'C', cod: 30 }],
      sunk: [
        { key: 'A', cod: 12 },
        { key: 'B', cod: 10 },
      ],
      codDelta: 8,
    });
  });

  test('the reverse move reverses the diff', () => {
    const diff = diffOf(solved(board, 11), solved(board, 10));
    expect(diff).toEqual({
      raised: [
        { key: 'A', cod: 12 },
        { key: 'B', cod: 10 },
      ],
      sunk: [{ key: 'C', cod: 30 }],
      codDelta: -8,
    });
  });

  test('the same solution twice: nothing rises, nothing sinks, no change', () => {
    expect(diffOf(solved(board, 10), solved(board, 10))).toEqual({ raised: [], sunk: [], codDelta: 0 });
  });

  test('a change that only adds tickets: they all rise, nothing sinks', () => {
    const easy = validOf([ticket('A', 2, 3), ticket('B', 2, 4), ticket('C', 2, 5)]);
    const diff = diffOf(solved(easy, 2), solved(easy, 6));
    expect(diff.sunk).toEqual([]);
    expect(diff.raised.map((r) => r.key)).toEqual(['A', 'B']);
    expect(diff.codDelta).toBe(7);
  });

  test('entries are sorted by key', () => {
    const wide = validOf([ticket('Z', 1, 1), ticket('M', 1, 1), ticket('B', 1, 1)]);
    expect(diffOf(solved(wide, 0), solved(wide, 3)).raised.map((r) => r.key)).toEqual(['B', 'M', 'Z']);
  });

  test('an impossible solution on either side is an error, not a partial diff', () => {
    const must = validOf([ticket('A', 5, 1, { mustHave: true })]);
    const impossible = solveWithCapacity(must, 1, 0);
    expect(impossible.ok && impossible.value.status).toBe('impossible');
    const fine = solved(must, 5);
    if (!impossible.ok) throw new Error('unexpected');
    expect(diffSolutions(impossible.value, fine)).toEqual({ ok: false, error: { code: 'solution-impossible' } });
    expect(diffSolutions(fine, impossible.value)).toEqual({ ok: false, error: { code: 'solution-impossible' } });
  });

  test('solutions of unrelated boards are refused when a raised ticket is unknown to the other side', () => {
    const one = solved(validOf([ticket('A', 1, 1)]), 0);
    const other = solved(validOf([ticket('Q', 1, 1)]), 5);
    expect(diffSolutions(one, other)).toEqual({ ok: false, error: { code: 'unknown-key', key: 'Q' } });
  });
});

describe('diffSolutions (coverage of the property below, fixed seed)', () => {
  test('the generated pairs include real changes in both directions', () => {
    const arb = arbBoard({ maxTickets: 40, withWontDo: true, mustHaveRate: 3 }).chain((board) =>
      fc.tuple(fc.constant(board), arbCapacity(board), arbCapacity(board), arbMargin),
    );
    let raisedAndSunk = 0;
    let changed = 0;
    for (const [board, a, b, m] of fc.sample(arb, { numRuns: 400, seed: 11 })) {
      const x = solveWithCapacity(valid(board), a, m);
      const y = solveWithCapacity(valid(board), b, m);
      if (!x.ok || !y.ok || x.value.status !== 'ok' || y.value.status !== 'ok') continue;
      const d = diffOf(x.value, y.value);
      if (d.raised.length + d.sunk.length > 0) changed++;
      if (d.raised.length > 0 && d.sunk.length > 0) raisedAndSunk++;
    }
    expect(changed).toBeGreaterThan(100);
    expect(raisedAndSunk).toBeGreaterThan(10);
  });
});

describe('diffSolutions (properties)', () => {
  test('P15 diff: cod(raised) - cod(sunk) = change in saved cod, and nothing rises and sinks at once', () => {
    fc.assert(
      fc.property(
        arbBoard({ maxTickets: 40, withWontDo: true, mustHaveRate: 3 }).chain((board) =>
          fc.tuple(fc.constant(board), arbCapacity(board), arbCapacity(board), arbMargin),
        ),
        ([board, capacityA, capacityB, margin]) => {
          const a = solveWithCapacity(valid(board), capacityA, margin);
          const b = solveWithCapacity(valid(board), capacityB, margin);
          if (!a.ok || !b.ok || a.value.status !== 'ok' || b.value.status !== 'ok') return;

          const diff = diffOf(a.value, b.value);
          expect(sum(diff.raised) - sum(diff.sunk)).toBe(diff.codDelta);
          expect(diff.codDelta).toBe(b.value.savedCod - a.value.savedCod);

          const raised = new Set(diff.raised.map((e) => e.key));
          for (const e of diff.sunk) expect(raised.has(e.key)).toBe(false);

          // Raised were buried before and are kept after; sunk the other way round.
          const keptBefore = new Set(a.value.kept);
          const keptAfter = new Set(b.value.kept);
          for (const e of diff.raised) expect(!keptBefore.has(e.key) && keptAfter.has(e.key)).toBe(true);
          for (const e of diff.sunk) expect(keptBefore.has(e.key) && !keptAfter.has(e.key)).toBe(true);

          // Everything that changed is listed.
          expect(diff.raised.length).toBe(b.value.kept.filter((k) => !keptBefore.has(k)).length);
          expect(diff.sunk.length).toBe(a.value.kept.filter((k) => !keptAfter.has(k)).length);

          // Sorted, and the reverse diff swaps the two lists.
          const keys = (list: readonly { key: string }[]) => list.map((e) => e.key);
          expect(keys(diff.raised)).toEqual([...keys(diff.raised)].sort());
          expect(keys(diff.sunk)).toEqual([...keys(diff.sunk)].sort());
          const back = diffOf(b.value, a.value);
          expect(back.raised).toEqual(diff.sunk);
          expect(back.sunk).toEqual(diff.raised);
          expect(back.codDelta).toBe(0 - diff.codDelta); // 0 - x, not -x, so a zero delta is +0 on both sides
        },
      ),
      { numRuns: 500 },
    );
  });
});
