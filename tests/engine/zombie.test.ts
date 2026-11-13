import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { putDown } from '../../src/engine/diff';
import type { PutDownApplied } from '../../src/engine/diff';
import { solveFreeze, solveWithCapacity } from '../../src/engine/solver';
import { validateBoard } from '../../src/engine/validate';
import type { Board, FreezeInput, ValidBoard } from '../../src/engine/types';
import { atCapacity, ticket, validOf, valid } from './fixtures';
import { arbSolveCase } from './generators';

function putDownOk(board: ValidBoard, freeze: FreezeInput, key: string): PutDownApplied {
  const r = putDown(board, freeze, key);
  if (!r.ok) throw new Error(`putDown error: ${r.error.code}`);
  return r.value;
}

const snapshot = (board: Board): string => JSON.stringify(board);

describe('zombies (examples)', () => {
  test('a buried ticket is a zombie when past + 1 reaches the threshold', () => {
    const board = validOf(
      [
        ticket('K', 5, 50),
        ticket('Z2', 5, 1, { past: 2 }), // 2 + 1 >= 3: zombie
        ticket('Z1', 5, 1, { past: 1 }), // 1 + 1 < 3: not yet
        ticket('Z9', 5, 1, { past: 9 }), // far past: zombie
      ],
      { zombieThreshold: 3 },
    );
    const r = solveWithCapacity(board, 5, 0);
    if (!r.ok || r.value.status !== 'ok') throw new Error('expected a solution');
    expect(r.value.kept).toEqual(['K']);
    expect(r.value.zombies).toEqual(['Z2', 'Z9']);
    expect(r.value.buried.map((b) => [b.key, b.isZombie])).toEqual([
      ['Z1', false],
      ['Z2', true],
      ['Z9', true],
    ]);
  });

  test('a kept ticket is never a zombie, however long it was out before', () => {
    const board = validOf([ticket('A', 1, 5, { past: 7 })], { zombieThreshold: 1 });
    const r = solveWithCapacity(board, 5, 0);
    expect(r.ok && r.value.status === 'ok' && r.value.zombies).toEqual([]);
  });

  test('threshold 1: every buried ticket is a zombie', () => {
    const board = validOf([ticket('A', 5, 9), ticket('B', 5, 1)], { zombieThreshold: 1 });
    const r = solveWithCapacity(board, 5, 0);
    expect(r.ok && r.value.status === 'ok' && r.value.zombies).toEqual(['B']);
  });
});

describe('putDown (examples)', () => {
  const base = validOf(
    [
      ticket('K', 5, 50),
      ticket('A', 5, 1, { past: 2 }),
      ticket('B', 1, 40, { dependsOn: ['A'] }),
      ticket('C', 1, 2, { past: 0 }),
    ],
    { zombieThreshold: 3, wontDo: ['OLD-1'] },
  );

  test('putting down a zombie removes it, records its key and blocks its dependents', () => {
    const { board, freeze } = atCapacity(base, 5);
    const copy = snapshot(board);
    const out = putDownOk(board, freeze, 'A');

    expect(out.board.tickets.map((t) => t.key)).toEqual(['K', 'B', 'C']);
    expect(out.board.wontDo).toEqual(['A', 'OLD-1']);
    expect(validateBoard(out.board).ok).toBe(true);
    expect(snapshot(board)).toBe(copy); // the input is never changed

    expect(out.diff).toEqual({ raised: [], sunk: [], codDelta: 0 });
    expect(out.after.kept).toEqual(out.before.kept);
    const b = out.after.buried.find((x) => x.key === 'B');
    expect(b?.reason).toEqual({ kind: 'blocked-by-put-down', putDownKey: 'A' });
    expect(out.after.buried.map((x) => x.key)).toEqual(['B', 'C']);
  });

  test('a buried ticket that is not a zombie yet cannot be put down', () => {
    const { board, freeze } = atCapacity(base, 5);
    expect(putDown(board, freeze, 'C')).toEqual({ ok: false, error: { code: 'not-a-zombie', key: 'C' } });
  });

  test('a kept ticket cannot be put down', () => {
    const { board, freeze } = atCapacity(base, 5);
    expect(putDown(board, freeze, 'K')).toEqual({ ok: false, error: { code: 'not-a-zombie', key: 'K' } });
  });

  test('an unknown key is an error, and so is putting the same ticket down twice', () => {
    const { board, freeze } = atCapacity(base, 5);
    expect(putDown(board, freeze, 'Z-9')).toEqual({ ok: false, error: { code: 'unknown-key', key: 'Z-9' } });
    const once = putDownOk(board, freeze, 'A');
    expect(putDown(once.board, freeze, 'A')).toEqual({ ok: false, error: { code: 'unknown-key', key: 'A' } });
  });

  test('an impossible freeze has no cut list, so nothing can be put down', () => {
    const must = validOf([ticket('M', 9, 1, { mustHave: true }), ticket('Z', 1, 1, { past: 5 })]);
    const { board, freeze } = atCapacity(must, 3);
    expect(putDown(board, freeze, 'Z')).toEqual({ ok: false, error: { code: 'solution-impossible' } });
  });

  test('capacity errors pass through', () => {
    const { board } = atCapacity(base, 5);
    expect(putDown(board, { now: 0, freezeAt: 10, marginPct: 7 }, 'A').ok).toBe(false);
  });

  test('the solution after a put down is the same one the engine gives for the board without it', () => {
    const { board, freeze } = atCapacity(base, 5);
    const out = putDownOk(board, freeze, 'A');
    const again = solveFreeze(out.board, freeze);
    expect(again.ok && again.value).toEqual(out.after);
  });
});

describe('zombie properties (coverage, fixed seed)', () => {
  test('the generated cases include many solvable boards with something buried, and with dependents of the put-down ticket', () => {
    const cases = fc.sample(arbSolveCase({ maxTickets: 12, withWontDo: true, mustHaveRate: 5 }), { numRuns: 400, seed: 11 });
    let withBuried = 0;
    let withDependents = 0;
    for (const c of cases) {
      const { board, freeze } = atCapacity({ ...c.board, zombieThreshold: 1 }, c.capacity, c.marginPct);
      const before = solveFreeze(board, freeze);
      if (!before.ok || before.value.status !== 'ok' || before.value.buried.length === 0) continue;
      withBuried++;
      const buried = new Set(before.value.buried.map((b) => b.key));
      if (board.tickets.some((t) => t.dependsOn.some((d) => buried.has(d)))) withDependents++;
    }
    expect(withBuried).toBeGreaterThan(100);
    expect(withDependents).toBeGreaterThan(30);
  });
});

describe('zombie properties', () => {
  test('P17 zombie: a ticket is a zombie if and only if it is buried and past + 1 >= threshold', () => {
    fc.assert(
      fc.property(arbSolveCase({ maxTickets: 40, withWontDo: true, mustHaveRate: 3 }), fc.integer({ min: 1, max: 8 }), (c, threshold) => {
        const board: Board = { ...c.board, zombieThreshold: threshold };
        const r = solveWithCapacity(valid(board), c.capacity, c.marginPct);
        if (!r.ok || r.value.status !== 'ok') return;
        const sol = r.value;
        const buried = new Set(sol.buried.map((b) => b.key));

        const expected = board.tickets
          .filter((t) => buried.has(t.key) && t.past + 1 >= threshold)
          .map((t) => t.key)
          .sort();
        expect([...sol.zombies]).toEqual(expected);

        const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
        for (const b of sol.buried) expect(b.isZombie).toBe((byKey.get(b.key)?.past ?? -1) + 1 >= threshold);
        for (const k of sol.kept) expect(sol.zombies).not.toContain(k);
      }),
      { numRuns: 500 },
    );
  });

  test('P18 put down: putting down a zombie changes neither the saved cod nor what is kept', () => {
    fc.assert(
      fc.property(arbSolveCase({ maxTickets: 12, withWontDo: true, mustHaveRate: 5 }), fc.nat(), (c, pick) => {
        // Threshold 1 makes every buried ticket a zombie, so any of them can be put down.
        const { board, freeze } = atCapacity({ ...c.board, zombieThreshold: 1 }, c.capacity, c.marginPct);
        const before = solveFreeze(board, freeze);
        if (!before.ok || before.value.status !== 'ok' || before.value.buried.length === 0) return;
        const key = before.value.buried[pick % before.value.buried.length]?.key as string;
        const copy = snapshot(board);

        const out = putDownOk(board, freeze, key);
        expect(snapshot(board)).toBe(copy);

        expect(out.after.savedCod).toBe(out.before.savedCod);
        expect(out.after.kept).toEqual(out.before.kept);
        expect(out.diff).toEqual({ raised: [], sunk: [], codDelta: 0 });
        expect(out.after.buried.map((b) => b.key)).toEqual(out.before.buried.map((b) => b.key).filter((k) => k !== key));
        expect(out.board.tickets.some((t) => t.key === key)).toBe(false);
        expect(out.board.wontDo).toContain(key);
        expect(validateBoard(out.board).ok).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
});
