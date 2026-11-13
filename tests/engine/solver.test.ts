import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { effectiveCapacity } from '../../src/engine/capacity';
import { oracleSolve } from '../../src/engine/oracle';
import { solveFreeze, solveWithCapacity } from '../../src/engine/solver';
import type { Board, Key, Solution, SolvedSolution, ValidBoard } from '../../src/engine/types';
import { ticket, validOf, valid } from './fixtures';
import { arbBoardForImpossible, arbPermutedBoard, arbSolveCase } from './generators';
import type { SolveCase } from './generators';

// ---- helpers (independent of the engine's own graph code) -------------------------------------------------------------

function solve(board: Board, capacity: number, margin = 0): Solution {
  const r = solveWithCapacity(valid(board), capacity, margin);
  if (!r.ok) throw new Error(`solver error: ${r.error.code}`);
  return r.value;
}

function solveOk(board: ValidBoard, capacity: number, margin = 0): SolvedSolution {
  const r = solveWithCapacity(board, capacity, margin);
  if (!r.ok) throw new Error(`solver error: ${r.error.code}`);
  if (r.value.status !== 'ok') throw new Error('expected a solution, got impossible');
  return r.value;
}

/** Keys in the chain of `key` (itself included), skipping put-down keys. */
function chainOf(board: Board, key: Key): Set<Key> {
  const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
  const seen = new Set<Key>();
  const todo = [key];
  while (todo.length > 0) {
    const k = todo.pop() as Key;
    if (seen.has(k) || !byKey.has(k)) continue;
    seen.add(k);
    for (const d of byKey.get(k)?.dependsOn ?? []) todo.push(d);
  }
  return seen;
}

/** Smallest put-down key reached from the chain of `key`, if any. */
function reachedPutDown(board: Board, key: Key): Key | undefined {
  const wont = new Set(board.wontDo);
  const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
  let smallest: Key | undefined;
  for (const k of chainOf(board, key)) {
    for (const d of byKey.get(k)?.dependsOn ?? []) {
      if (wont.has(d) && (smallest === undefined || d < smallest)) smallest = d;
    }
  }
  return smallest;
}

const RUNS = 300;

/** Runs `check` on every solved (status ok) case; impossible cases are skipped on purpose and counted in the coverage test. */
function forSolved(c: SolveCase, check: (sol: SolvedSolution, board: Board) => void): void {
  const sol = solve(c.board, c.capacity, c.marginPct);
  if (sol.status === 'ok') check(sol, c.board);
}

const largeCases = arbSolveCase({ maxTickets: 80, mustHaveRate: 3 });
const wontDoCases = arbSolveCase({ maxTickets: 12, withWontDo: true });

// ---- examples ---------------------------------------------------------------------------------------------------------

describe('solver (examples)', () => {
  test('an empty board has nothing to keep', () => {
    expect(solveOk(validOf([]), 10)).toMatchObject({ status: 'ok', kept: [], buried: [], savedCod: 0, keptEffort: 0 });
  });

  test('everything fits: nothing is buried', () => {
    const sol = solveOk(validOf([ticket('A', 2, 3), ticket('B', 3, 4)]), 5);
    expect(sol.kept).toEqual(['A', 'B']);
    expect(sol.buried).toEqual([]);
    expect(sol.savedCod).toBe(7);
  });

  test('"C beats A + B": more capacity can change which tickets are kept', () => {
    const board = validOf([ticket('A', 6, 12), ticket('B', 4, 10), ticket('C', 11, 30)]);
    const ten = solveOk(board, 10);
    expect(ten.kept).toEqual(['A', 'B']);
    expect(ten.savedCod).toBe(22);
    const eleven = solveOk(board, 11);
    expect(eleven.kept).toEqual(['C']);
    expect(eleven.savedCod).toBe(30);
    expect(eleven.buried.map((b) => b.key)).toEqual(['A', 'B']);
  });

  test('tie-break 1: equal cod, bury fewer tickets', () => {
    const sol = solveOk(validOf([ticket('A', 3, 4), ticket('B', 2, 2), ticket('C', 1, 2)]), 3);
    expect(sol.kept).toEqual(['B', 'C']);
  });

  test('tie-break 2: equal cod and count, bury less effort', () => {
    const sol = solveOk(validOf([ticket('X', 4, 5), ticket('Y', 3, 5)]), 4);
    expect(sol.kept).toEqual(['X']);
  });

  test('tie-break 3: everything equal, the alphabetically smaller key is buried', () => {
    expect(solveOk(validOf([ticket('A-1', 5, 7), ticket('B-1', 5, 7)]), 5).kept).toEqual(['B-1']);
    expect(solveOk(validOf([ticket('CRYPT-12', 5, 7), ticket('CRYPT-2', 5, 7)]), 5).kept).toEqual(['CRYPT-2']);
  });

  test('tie-break 3 with three equal tickets: the smallest buried list wins, so the last key is kept', () => {
    // Buried lists are [B,C], [A,C] and [A,B]; the smallest is [A,B], which keeps C.
    const board = validOf([ticket('A', 5, 7), ticket('B', 5, 7), ticket('C', 5, 7)]);
    expect(solveOk(board, 5).kept).toEqual(['C']);
    expect(solveOk(board, 10).kept).toEqual(['B', 'C']);
  });

  test('a zero-cod ticket that fits is kept; one that does not is buried', () => {
    const sol = solveOk(validOf([ticket('A', 2, 5), ticket('Z', 1, 0), ticket('Y', 9, 0)]), 3);
    expect(sol.kept).toEqual(['A', 'Z']);
  });

  test('must-haves are kept even when worth little', () => {
    const sol = solveOk(validOf([ticket('A', 5, 1, { mustHave: true }), ticket('B', 5, 50)]), 5);
    expect(sol.kept).toEqual(['A']);
  });

  test('the margin shrinks the capacity the solver fits to', () => {
    const board = validOf([ticket('A', 10, 10), ticket('B', 10, 5)]);
    expect(solveOk(board, 20, 0).kept).toEqual(['A', 'B']);
    const margin = solveOk(board, 20, 25);
    expect(margin.capacity).toBe(20);
    expect(margin.effectiveCapacity).toBe(15);
    expect(margin.kept).toEqual(['A']);
  });

  test('an invalid margin or capacity is an error, not a solution', () => {
    const board = validOf([ticket('A', 1, 1)]);
    expect(solveWithCapacity(board, 10, 7)).toEqual({ ok: false, error: { code: 'margin-invalid', value: '7' } });
    expect(solveWithCapacity(board, -1, 0).ok).toBe(false);
    expect(solveWithCapacity(board, 1.5, 0).ok).toBe(false);
  });

  test('a larger capacity than all the effort is fine', () => {
    expect(solveOk(validOf([ticket('A', 2, 3)]), 1_000_000).kept).toEqual(['A']);
  });

  test('solveFreeze computes the capacity from the board team and the time window', () => {
    const board = validOf([ticket('A', 10, 5), ticket('B', 10, 4)], {
      people: [{ name: 'Ana', pointsPerHalfDay: 2, daysOff: [] }],
    });
    const mon0900 = Date.UTC(2026, 10, 16, 8, 0);
    const fri1800 = Date.UTC(2026, 10, 20, 17, 0);
    const r = solveFreeze(board, { now: mon0900, freezeAt: fri1800, marginPct: 15 });
    expect(r.ok).toBe(true);
    if (r.ok && r.value.status === 'ok') {
      expect(r.value.capacity).toBe(20);
      expect(r.value.effectiveCapacity).toBe(17);
      expect(r.value.kept).toEqual(['A']);
    }
  });

  test('solveFreeze passes capacity errors through', () => {
    const board = validOf([ticket('A', 1, 1)], { timeZone: 'UTC' });
    const r = solveFreeze(board, { now: 0.5, freezeAt: 10, marginPct: 0 });
    expect(r.ok).toBe(false);
  });
});

describe('solver (reasons)', () => {
  const chain = validOf([
    ticket('A', 5, 1),
    ticket('B', 1, 20, { dependsOn: ['A'] }),
    ticket('C', 1, 20, { dependsOn: ['B'] }),
    ticket('D', 1, 3),
  ]);

  test('cascade: a buried dependency drags its dependents down, and says so', () => {
    const sol = solveOk(chain, 3);
    expect(sol.kept).toEqual(['D']);
    expect(sol.buried.map((b) => [b.key, b.reason])).toEqual([
      ['A', { kind: 'no-room', needed: 5, left: 2 }],
      ['B', { kind: 'depends-on-buried', buriedDependencies: ['A'] }],
      ['C', { kind: 'depends-on-buried', buriedDependencies: ['B'] }],
    ]);
  });

  test('a ticket that depends on a put-down key is blocked, and so are its dependents', () => {
    const board = validOf(
      [ticket('A', 1, 9, { dependsOn: ['W-1'] }), ticket('B', 1, 9, { dependsOn: ['A'] }), ticket('C', 1, 2)],
      { wontDo: ['W-1'] },
    );
    const sol = solveOk(board, 100);
    expect(sol.kept).toEqual(['C']);
    expect(sol.buried.map((b) => [b.key, b.reason])).toEqual([
      ['A', { kind: 'blocked-by-put-down', putDownKey: 'W-1' }],
      ['B', { kind: 'blocked-by-put-down', putDownKey: 'W-1' }],
    ]);
  });

  test('the smallest reachable put-down key is the one reported', () => {
    const board = validOf([ticket('A', 1, 1, { dependsOn: ['W-2', 'W-1'] })], { wontDo: ['W-1', 'W-2'] });
    expect(solveOk(board, 10).buried[0]?.reason).toEqual({ kind: 'blocked-by-put-down', putDownKey: 'W-1' });
  });

  test('buried tickets carry their cod, burial cost (cod x weeks) and zombie flag', () => {
    const board = validOf([ticket('A', 9, 7, { past: 2 }), ticket('B', 9, 6, { past: 0 })], { nextReleaseWeeks: 3, zombieThreshold: 3 });
    const sol = solveOk(board, 9);
    expect(sol.kept).toEqual(['A']);
    expect(sol.buried).toEqual([
      { key: 'B', reason: { kind: 'no-room', needed: 9, left: 0 }, cod: 6, burialCost: 18, isZombie: false },
    ]);
    const other = solveOk(validOf([ticket('A', 9, 6, { past: 2 }), ticket('B', 9, 7)], { zombieThreshold: 3 }), 9);
    expect(other.buried[0]).toMatchObject({ key: 'A', isZombie: true });
    expect(other.zombies).toEqual(['A']);
  });
});

// ---- properties -------------------------------------------------------------------------------------------------------

describe('solver properties', () => {
  test('P1 fits: the kept effort never exceeds the capacity', () => {
    fc.assert(
      fc.property(largeCases, (c) => forSolved(c, (sol) => expect(sol.keptEffort).toBeLessThanOrEqual(c.capacity))),
      { numRuns: RUNS },
    );
  });

  test('P22 margin: the kept effort never exceeds the capacity with margin', () => {
    fc.assert(
      fc.property(largeCases, (c) =>
        forSolved(c, (sol) => {
          const limit = Math.floor((c.capacity * (100 - c.marginPct)) / 100);
          expect(sol.effectiveCapacity).toBe(limit);
          expect(sol.keptEffort).toBeLessThanOrEqual(limit);
          const direct = effectiveCapacity(c.capacity, c.marginPct);
          expect(direct.ok && direct.value).toBe(limit);
        }),
      ),
      { numRuns: RUNS },
    );
  });

  test('P2 must-haves: no must-have is buried', () => {
    fc.assert(
      fc.property(wontDoCases, (c) =>
        forSolved(c, (sol, board) => {
          const buried = new Set(sol.buried.map((b) => b.key));
          for (const t of board.tickets) if (t.mustHave) expect(buried.has(t.key)).toBe(false);
        }),
      ),
      { numRuns: RUNS },
    );
  });

  test('P3 dependencies: a kept ticket has all its dependencies kept (and none put down)', () => {
    fc.assert(
      fc.property(wontDoCases, (c) =>
        forSolved(c, (sol, board) => {
          const kept = new Set(sol.kept);
          for (const t of board.tickets) {
            if (!kept.has(t.key)) continue;
            for (const d of t.dependsOn) {
              expect(kept.has(d)).toBe(true);
              expect(board.wontDo).not.toContain(d);
            }
          }
        }),
      ),
      { numRuns: RUNS },
    );
  });

  test('P4 partition: kept and buried do not overlap and together are the whole board', () => {
    fc.assert(
      fc.property(largeCases, (c) =>
        forSolved(c, (sol, board) => {
          const buried = sol.buried.map((b) => b.key);
          const all = [...sol.kept, ...buried];
          expect(new Set(all).size).toBe(all.length);
          expect([...all].sort()).toEqual(board.tickets.map((t) => t.key).sort());
        }),
      ),
      { numRuns: RUNS },
    );
  });

  test('P5 optimal vs oracle: same saved cod and same kept set as brute force (boards of 12 or fewer)', () => {
    const cases = fc.oneof(
      wontDoCases,
      arbBoardForImpossible({ withWontDo: true }),
    );
    fc.assert(
      fc.property(cases, (c) => {
        const board = valid(c.board);
        const sol = solve(c.board, c.capacity, c.marginPct);
        const eff = effectiveCapacity(c.capacity, c.marginPct);
        if (!eff.ok) throw new Error('unexpected margin error');
        const oracle = oracleSolve(board, eff.value);
        expect(sol.status).toBe(oracle.status);
        if (sol.status === 'ok' && oracle.status === 'ok') {
          expect(sol.savedCod).toBe(oracle.savedCod);
          expect(sol.kept).toEqual(oracle.kept);
          expect(sol.keptEffort).toBe(oracle.keptEffort);
        }
      }),
      { numRuns: 1000 },
    );
  });

  test('P5 optimal vs oracle (tie-heavy boards, where the tie-breaks decide)', () => {
    fc.assert(
      fc.property(arbSolveCase({ maxTickets: 12, ties: true, withWontDo: true, mustHaveRate: 5 }), (c) => {
        const board = valid(c.board);
        const sol = solve(c.board, c.capacity, c.marginPct);
        const eff = effectiveCapacity(c.capacity, c.marginPct);
        if (!eff.ok) throw new Error('unexpected margin error');
        const oracle = oracleSolve(board, eff.value);
        expect(sol.status).toBe(oracle.status);
        if (sol.status === 'ok' && oracle.status === 'ok') {
          expect(sol.savedCod).toBe(oracle.savedCod);
          expect(sol.kept).toEqual(oracle.kept);
        }
      }),
      { numRuns: 1000 },
    );
  });

  test('P6 more capacity: the saved cod does not drop, and a solvable freeze stays solvable', () => {
    fc.assert(
      fc.property(largeCases, fc.nat(40), (c, extra) => {
        const before = solve(c.board, c.capacity, c.marginPct);
        const after = solve(c.board, c.capacity + extra, c.marginPct);
        if (before.status === 'ok') {
          expect(after.status).toBe('ok');
          if (after.status === 'ok') expect(after.savedCod).toBeGreaterThanOrEqual(before.savedCod);
        }
      }),
      { numRuns: RUNS },
    );
  });

  test('P7 determinism: the same board in any order gives exactly the same tombstones', () => {
    fc.assert(
      fc.property(
        arbSolveCase({ maxTickets: 20, withWontDo: true }).chain((c) => fc.tuple(fc.constant(c), arbPermutedBoard(c.board))),
        ([c, permuted]) => {
          expect(solve(permuted, c.capacity, c.marginPct)).toEqual(solve(c.board, c.capacity, c.marginPct));
        },
      ),
      { numRuns: 1000 },
    );
  });

  test('P8 nothing left over: no buried ticket worth something fits in the gap with its buried dependencies', () => {
    fc.assert(
      fc.property(wontDoCases, (c) =>
        forSolved(c, (sol, board) => {
          const gap = sol.effectiveCapacity - sol.keptEffort;
          const buried = new Set(sol.buried.map((b) => b.key));
          const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
          for (const b of sol.buried) {
            if (b.cod <= 0 || b.reason.kind === 'blocked-by-put-down') continue;
            let need = 0;
            for (const k of chainOf(board, b.key)) if (k === b.key || buried.has(k)) need += byKey.get(k)?.effort ?? 0;
            expect(need).toBeGreaterThan(gap);
          }
        }),
      ),
      { numRuns: RUNS },
    );
  });

  test('P27 cascade: if a ticket is buried, everything that depends on it is buried', () => {
    fc.assert(
      fc.property(wontDoCases, (c) =>
        forSolved(c, (sol, board) => {
          const buried = new Set(sol.buried.map((b) => b.key));
          for (const t of board.tickets) {
            for (const member of chainOf(board, t.key)) {
              if (buried.has(member)) expect(buried.has(t.key)).toBe(true);
            }
            if (reachedPutDown(board, t.key) !== undefined) expect(buried.has(t.key)).toBe(true);
          }
        }),
      ),
      { numRuns: RUNS },
    );
  });
});

describe('solver reasons (properties)', () => {
  test('every buried ticket has the reason that its facts support', () => {
    fc.assert(
      fc.property(wontDoCases, (c) =>
        forSolved(c, (sol, board) => {
          const keptSet = new Set(sol.kept);
          const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
          for (const b of sol.buried) {
            const t = byKey.get(b.key);
            if (!t) throw new Error('buried ticket not on the board');
            const buriedDeps = [...new Set(t.dependsOn)].filter((d) => byKey.has(d) && !keptSet.has(d)).sort();
            const putDown = reachedPutDown(board, b.key);
            if (b.reason.kind === 'blocked-by-put-down') {
              expect(b.reason.putDownKey).toBe(putDown);
            } else {
              expect(putDown).toBeUndefined();
              if (b.reason.kind === 'depends-on-buried') {
                expect(b.reason.buriedDependencies).toEqual(buriedDeps);
                expect(buriedDeps.length).toBeGreaterThan(0);
              } else {
                // no-room: all dependencies are kept, and the ticket alone does not fit in what is left.
                expect(buriedDeps).toEqual([]);
                expect(b.reason.needed).toBe(t.effort);
                expect(b.reason.left).toBe(sol.effectiveCapacity - sol.keptEffort);
                expect(b.reason.needed).toBeGreaterThan(b.reason.left);
              }
            }
          }
        }),
      ),
      { numRuns: 1000 },
    );
  });
});

describe('generator coverage for the solver properties (fixed seed)', () => {
  test('large cases are mostly solvable, and some are impossible', () => {
    const cases = fc.sample(largeCases, { numRuns: 300, seed: 7 });
    const statuses = cases.map((c) => solve(c.board, c.capacity, c.marginPct).status);
    expect(statuses.filter((s) => s === 'ok').length).toBeGreaterThan(150);
    expect(statuses.filter((s) => s === 'impossible').length).toBeGreaterThan(0);
  });

  test('small cases with put-down keys produce all three reason kinds', () => {
    const cases = fc.sample(wontDoCases, { numRuns: 600, seed: 7 });
    const kinds = new Set<string>();
    for (const c of cases) {
      const sol = solve(c.board, c.capacity, c.marginPct);
      if (sol.status === 'ok') for (const b of sol.buried) kinds.add(b.reason.kind);
    }
    expect([...kinds].sort()).toEqual(['blocked-by-put-down', 'depends-on-buried', 'no-room']);
  });

  test('the cases include ones where capacity is the binding limit (something is buried)', () => {
    const cases = fc.sample(wontDoCases, { numRuns: 300, seed: 7 });
    const withBuried = cases.filter((c) => {
      const sol = solve(c.board, c.capacity, c.marginPct);
      return sol.status === 'ok' && sol.buried.length > 0 && sol.kept.length > 0;
    });
    expect(withBuried.length).toBeGreaterThan(60);
  });
});
