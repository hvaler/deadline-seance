import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { FOG_MAX_PCT, FOG_MIN_PCT, FOG_NIGHTS, FOG_RESERVE_STEPS, fogCurve, fogFactor, fogFromTable, fogTable, simulateFog, solveFreeze } from '../../src/engine/index';
import type { Board, FogPoint, ValidBoard } from '../../src/engine/index';
import { murmur3Words } from '../../src/engine/hash';
import { oracleSolve } from '../../src/engine/oracle';
import { atCapacity, makeBoard, ticket, valid, validOf } from './fixtures';
import { arbBoard, arbCapacity, arbPermutedBoard } from './generators';
import { refFactor, refMurmur, refSimulate } from './fog-reference';

const RUNS = 200;

describe('the hash: MurmurHash3 x86 32-bit over words', () => {
  // Published vectors for MurmurHash3_x86_32. A block is one 4-byte little-endian word, so 0x87654321 is the bytes 21 43 65 87.
  const vectors: [string, number, number[], number][] = [
    ['no data, seed 0', 0, [], 0x00000000],
    ['no data, seed 1', 1, [], 0x514e28b7],
    ['no data, seed 0xFFFFFFFF', 0xffffffff, [], 0x81f16f39],
    ['0xFFFFFFFF, seed 0', 0, [0xffffffff], 0x76293b50],
    ['0x87654321, seed 0', 0, [0x87654321], 0xf55b516b],
    ['0x87654321, seed 0x5082EDEE', 0x5082edee, [0x87654321], 0x2362f9de],
    ['0x00000000, seed 0', 0, [0], 0x2362f9de],
  ];
  for (const [name, seed, words, expected] of vectors) {
    test(`known answer: ${name}`, () => {
      expect(murmur3Words(seed, words)).toBe(expected);
      expect(refMurmur(seed, words)).toBe(expected);
    });
  }

  test('the engine hash and the BigInt reference agree on any seed and any words', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.array(fc.integer({ min: 0, max: 0xffffffff }), { maxLength: 12 }), (seed, words) => {
        expect(murmur3Words(seed, words)).toBe(refMurmur(seed, words));
      }),
      { numRuns: RUNS },
    );
  });

  test('the length is part of the hash: a key with a code unit equal to the night cannot collide with a shorter key', () => {
    // words [A, 5, 0] (key "A\u0005", night 0) against [A, 5] (key "A", night 5)
    expect(murmur3Words(7, [65, 5, 0])).not.toBe(murmur3Words(7, [65, 5]));
    expect(fogFactor(7, 'A\u0005', 0)).toBe(refFactor(7, 'A\u0005', 0));
  });
});

describe('the draw: fogFactor', () => {
  test('constants of the rule', () => {
    expect([FOG_NIGHTS, FOG_MIN_PCT, FOG_MAX_PCT]).toEqual([1000, 80, 150]);
  });

  test('is an integer from 80 to 150 for any seed, key and night, including odd keys', () => {
    const arbKey = fc.oneof(fc.string({ maxLength: 12 }), fc.string({ unit: 'binary', maxLength: 6 }), fc.constantFrom('', 'HB-101', 'Ünï', '😀', '<img src=x onerror=alert(1)>', '\ud800'));
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), arbKey, fc.integer({ min: 0, max: 999 }), (seed, key, night) => {
        const f = fogFactor(seed, key, night);
        expect(Number.isInteger(f)).toBe(true);
        expect(f).toBeGreaterThanOrEqual(80);
        expect(f).toBeLessThanOrEqual(150);
      }),
      { numRuns: RUNS },
    );
  });

  test('agrees exactly with the independent BigInt reference', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.string({ maxLength: 10 }), fc.integer({ min: 0, max: 999 }), (seed, key, night) => {
        expect(fogFactor(seed, key, night)).toBe(refFactor(seed, key, night));
      }),
      { numRuns: RUNS },
    );
  });

  test('is a function of seed, key and night only: the same call gives the same number', () => {
    expect(fogFactor(20261116, 'HB-101', 17)).toBe(fogFactor(20261116, 'HB-101', 17));
  });

  test('all 71 values occur, about evenly, over 80 000 draws', () => {
    const counts = new Array<number>(71).fill(0);
    for (let t = 0; t < 80; t++) {
      for (let night = 0; night < FOG_NIGHTS; night++) {
        const slot = fogFactor(12345, `HB-${100 + t}`, night) - 80;
        counts[slot] = (counts[slot] as number) + 1;
      }
    }
    const expected = 80_000 / 71;
    for (const [i, c] of counts.entries()) {
      expect(c, `factor ${80 + i}`).toBeGreaterThan(expected * 0.8);
      expect(c, `factor ${80 + i}`).toBeLessThan(expected * 1.2);
    }
  });

  test('two keys do not draw the same nights, and two seeds do not either', () => {
    const series = (seed: number, key: string): string => Array.from({ length: 40 }, (_, n) => fogFactor(seed, key, n)).join(',');
    expect(series(1, 'HB-101')).not.toBe(series(1, 'HB-102'));
    expect(series(1, 'HB-101')).not.toBe(series(2, 'HB-101'));
  });
});

// ---- the simulation -----------------------------------------------------------------------------------------------------

/** Board, a kept set (subset of its keys, any order, maybe repeated) and a capacity: the inputs of the fog. */
const arbFogCase = arbBoard({ maxTickets: 20, maxEffort: 13 }).chain((board) =>
  fc.tuple(fc.constant(board), fc.subarray(board.tickets.map((t) => t.key)), arbCapacity(board)),
);
const sized = (board: Board) => board.tickets.map((t) => ({ key: t.key, effort: t.effort }));
const must = <T,>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`unexpected error ${JSON.stringify(r.error)}`);
  return r.value;
};

describe('simulateFog', () => {
  test('an empty kept set holds on every night, whatever the capacity', () => {
    const board = validOf([ticket('A', 5, 1)], { fogSeed: 9 });
    for (const capacity of [0, 1, 1000]) expect(must(simulateFog(board, [], capacity))).toEqual({ nights: 1000, holds: 1000, pct: 100 });
  });

  test('tickets of effort 0 never take anything: they hold at capacity 0', () => {
    const board = validOf([ticket('A', 0, 1), ticket('B', 0, 1)]);
    expect(must(simulateFog(board, ['A', 'B'], 0))).toEqual({ nights: 1000, holds: 1000, pct: 100 });
  });

  test('one ticket by hand: effort 10 at capacity 10 holds exactly on the nights where the estimate does not grow (factor at most 100)', () => {
    const board = validOf([ticket('A', 10, 1)], { fogSeed: 20261116 });
    let expected = 0;
    for (let night = 0; night < 1000; night++) if (refFactor(20261116, 'A', night) <= 100) expected++;
    const r = must(simulateFog(board, ['A'], 10));
    expect(r.holds).toBe(expected);
    expect(r.pct).toBe(Math.floor(expected / 10));
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(1000);
  });

  test('the percentage is floored: a few holding nights read as 0 %', () => {
    // Find a capacity where very few nights hold, by lowering it until the count is between 1 and 9.
    const board = validOf([ticket('A', 20, 1), ticket('B', 20, 1), ticket('C', 20, 1)], { fogSeed: 1 });
    let found: { holds: number; pct: number } | null = null;
    for (let capacity = 48; capacity <= 90 && found === null; capacity++) {
      const r = must(simulateFog(board, ['A', 'B', 'C'], capacity));
      if (r.holds > 0 && r.holds < 10) found = r;
    }
    expect(found).not.toBeNull();
    expect(found?.pct).toBe(0);
  });

  test('a key that is not on the board is named; so is a capacity that is not a non-negative integer', () => {
    const board = validOf([ticket('A', 1, 1)]);
    expect(simulateFog(board, ['A', 'Z', 'Y'], 5)).toEqual({ ok: false, error: { code: 'unknown-key', key: 'Y' } });
    expect(fogFromTable(fogTable(board), ['Z'], 5)).toEqual({ ok: false, error: { code: 'unknown-key', key: 'Z' } });
    for (const capacity of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = simulateFog(board, ['A'], capacity);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('not-integer');
    }
  });

  test('the same board, kept set and capacity give the same answer as the independent reference (hash called again for every night)', () => {
    fc.assert(
      fc.property(arbFogCase, ([board, kept, capacity]) => {
        const reference = refSimulate(board.fogSeed, sized(board), kept, capacity);
        const v = valid(board);
        expect(must(simulateFog(v, kept, capacity))).toEqual(reference);
        expect(must(fogFromTable(fogTable(v), kept, capacity))).toEqual(reference);
      }),
      { numRuns: 60 },
    );
  });

  test('a board of 80 tickets agrees with the reference too', () => {
    fc.assert(
      fc.property(
        arbBoard({ minTickets: 60, maxTickets: 80, maxEffort: 13 }).chain((board) => fc.tuple(fc.constant(board), fc.subarray(board.tickets.map((t) => t.key)), arbCapacity(board))),
        ([board, kept, capacity]) => {
          expect(must(simulateFog(valid(board), kept, capacity))).toEqual(refSimulate(board.fogSeed, sized(board), kept, capacity));
        },
      ),
      { numRuns: 6 },
    );
  });

  test('a ticket draws the same whoever else is on the board (common random numbers): its row of the table does not change', () => {
    fc.assert(
      fc.property(arbBoard({ minTickets: 2, maxTickets: 20 }), fc.nat(), (board, pick) => {
        const chosen = board.tickets[pick % board.tickets.length]!;
        const alone = fogTable(valid({ ...board, tickets: [{ ...chosen, dependsOn: [] }], wontDo: [] }));
        const full = fogTable(valid(board));
        const rowAlone = alone.rows.get(chosen.key) as number;
        const rowFull = full.rows.get(chosen.key) as number;
        for (let night = 0; night < 1000; night++) expect(alone.data[rowAlone * 1000 + night]).toBe(full.data[rowFull * 1000 + night]);
      }),
      { numRuns: 25 },
    );
  });

  test('a board with an effort near the largest the engine accepts stays exact', () => {
    const board = validOf([ticket('A', 25_000_000, 1), ticket('B', 7, 1)], { fogSeed: 4_294_967_295 });
    const capacity = 29_000_000;
    expect(must(simulateFog(board, ['A', 'B'], capacity))).toEqual(refSimulate(4_294_967_295, sized(board), ['A', 'B'], capacity));
  });
});

// ---- the curve ----------------------------------------------------------------------------------------------------------

describe('fogCurve', () => {
  const arbCurveCase = arbBoard({ maxTickets: 12, maxEffort: 13 }).chain((board) =>
    fc.tuple(fc.constant(board), arbCapacity(board)).map(([b, capacity]) => atCapacity(b, capacity)),
  );

  test('has the seven reserve steps, in order', () => {
    const { board, freeze } = atCapacity(makeBoard([ticket('A', 3, 5)]), 10);
    const points = must(fogCurve(board, freeze));
    expect(points.map((p) => p.marginPct)).toEqual([0, 5, 10, 15, 20, 25, 30]);
    expect([...FOG_RESERVE_STEPS]).toEqual([0, 5, 10, 15, 20, 25, 30]);
  });

  test('each point is the fog of the solver kept set at that reserve, measured against the full capacity (reference and oracle)', () => {
    fc.assert(
      fc.property(arbCurveCase, ({ board, freeze }) => {
        const points = must(fogCurve(board, freeze));
        for (const p of points) {
          const solved = must(solveFreeze(board, { ...freeze, marginPct: p.marginPct }));
          const oracle = oracleSolve(board, solved.effectiveCapacity);
          if (solved.status === 'impossible') {
            expect(p).toEqual({
              status: 'impossible',
              marginPct: p.marginPct,
              capacity: solved.capacity,
              effectiveCapacity: solved.effectiveCapacity,
              needed: solved.needed,
              fog: null,
            });
            expect(oracle.status).toBe('impossible');
            continue;
          }
          expect(oracle.status).toBe('ok');
          if (oracle.status === 'ok') expect([...oracle.kept].sort()).toEqual([...solved.kept].sort());
          expect(p.status).toBe('ok');
          if (p.status !== 'ok') continue;
          expect(p.capacity).toBe(solved.capacity);
          expect(p.effectiveCapacity).toBe(solved.effectiveCapacity);
          expect(p.keptCount).toBe(solved.kept.length);
          expect(p.keptEffort).toBe(solved.keptEffort);
          expect(p.fog).toEqual(refSimulate(board.fogSeed, sized(board), solved.kept, solved.capacity));
          expect(p.fog).toEqual(must(simulateFog(board, solved.kept, solved.capacity)));
        }
      }),
      { numRuns: 60 },
    );
  });

  test('a table made by the caller gives the same curve as no table', () => {
    fc.assert(
      fc.property(arbCurveCase, ({ board, freeze }) => {
        expect(must(fogCurve(board, freeze, fogTable(board)))).toEqual(must(fogCurve(board, freeze)));
      }),
      { numRuns: 25 },
    );
  });

  test('a freeze that cannot be met gives impossible points and no chance', () => {
    const { board, freeze } = atCapacity(makeBoard([ticket('A', 9, 5, { mustHave: true })]), 4);
    const points = must(fogCurve(board, freeze));
    expect(points.every((p) => p.status === 'impossible' && p.fog === null)).toBe(true);
    expect(points[0]).toMatchObject({ status: 'impossible', needed: 9, capacity: 4 });
  });

  test('the whole curve is the same when the tickets come in another order', () => {
    fc.assert(
      fc.property(arbCurveCase.chain((c) => fc.tuple(fc.constant(c), arbPermutedBoard(c.board))), ([c, shuffled]) => {
        const other = atCapacity(shuffled, 7);
        const same = atCapacity(c.board, 7);
        expect(must(fogCurve(other.board, other.freeze))).toEqual(must(fogCurve(same.board, same.freeze)));
      }),
      { numRuns: 25 },
    );
  });
});

// ---- the properties -----------------------------------------------------------------------------------------------------

describe('the fog properties', () => {
  test('P19 the same board, seed and kept set give the same result, in any order, and the seed matters', () => {
    fc.assert(
      fc.property(arbFogCase.chain((c) => fc.tuple(fc.constant(c), arbPermutedBoard(c[0]), fc.shuffledSubarray(c[1]))), ([[board, kept, capacity], shuffledBoard, shuffledKept]) => {
        const first = must(simulateFog(valid(board), kept, capacity));
        expect(must(simulateFog(valid(board), kept, capacity))).toEqual(first);
        expect(must(simulateFog(valid(shuffledBoard), [...shuffledKept, ...shuffledKept], capacity))).toEqual(
          must(simulateFog(valid(board), shuffledKept, capacity)),
        );
        expect(must(simulateFog(valid(shuffledBoard), [...kept].reverse(), capacity))).toEqual(first);
      }),
      { numRuns: 60 },
    );
    // A different seed is allowed to give a different result, and does: the seed is not ignored.
    const base = [ticket('A', 10, 1), ticket('B', 10, 1), ticket('C', 10, 1)];
    const results = new Set<number>();
    for (let seed = 0; seed < 8; seed++) results.add(must(simulateFog(validOf(base, { fogSeed: seed }), ['A', 'B', 'C'], 34)).holds);
    expect(results.size).toBeGreaterThan(1);
  });

  test('P20 fewer inside holds at least as often: S\' within S never holds on fewer nights', () => {
    fc.assert(
      fc.property(
        arbFogCase.chain(([board, kept, capacity]) => fc.tuple(fc.constant(board), fc.constant(kept), fc.subarray(kept), fc.constant(capacity))),
        ([board, bigger, smaller, capacity]) => {
          const v = valid(board);
          const table = fogTable(v);
          const withMore = must(fogFromTable(table, bigger, capacity));
          const withLess = must(fogFromTable(table, smaller, capacity));
          expect(withLess.holds).toBeGreaterThanOrEqual(withMore.holds);
          expect(withLess.pct).toBeGreaterThanOrEqual(withMore.pct);
          // The same through the plain route that builds its own table.
          expect(must(simulateFog(v, smaller, capacity)).holds).toBe(withLess.holds);
        },
      ),
      { numRuns: 100 },
    );
  });

  test('P21 extremes: when even the worst nights fit it holds on all 1000, and when even the best nights do not fit it holds on none', () => {
    fc.assert(
      fc.property(
        arbFogCase.chain(([board, kept]) => fc.tuple(fc.constant(board), fc.constant(kept), fc.integer({ min: 0, max: 5 }))),
        ([board, kept, slack]) => {
          const v = valid(board);
          const chosen = new Set(kept);
          const efforts = board.tickets.filter((t) => chosen.has(t.key)).map((t) => t.effort);
          const worst = efforts.reduce((s, e) => s + Math.floor((3 * e + 1) / 2), 0); // sum of ceil(1.5 x effort)
          const best = efforts.reduce((s, e) => s + Math.floor((4 * e + 4) / 5), 0); // sum of ceil(0.8 x effort)
          const fits = must(simulateFog(v, kept, worst + slack));
          expect(fits).toEqual({ nights: 1000, holds: 1000, pct: 100 });
          if (best > 0) {
            const misses = must(simulateFog(v, kept, Math.max(0, best - 1 - slack)));
            expect(misses).toEqual({ nights: 1000, holds: 0, pct: 0 });
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---- more reserve is not always more chance ------------------------------------------------------------------------------

describe('what the screen must never promise', () => {
  /** The first pair of reserves, smaller then larger, where the larger one holds on fewer nights. */
  function decrease(points: readonly FogPoint[]): { from: number; to: number; holdsFrom: number; holdsTo: number } | null {
    for (const a of points) {
      for (const b of points) {
        if (a.status === 'ok' && b.status === 'ok' && b.marginPct > a.marginPct && b.fog.holds < a.fog.holds) {
          return { from: a.marginPct, to: b.marginPct, holdsFrom: a.fog.holds, holdsTo: b.fog.holds };
        }
      }
    }
    return null;
  }

  test('more reserve can lower the chance, so the screen must not say that it raises it (a search over small boards finds one)', () => {
    // Tickets without dependencies or must-haves, so the kept set is just "what fits best"; efforts 1 to 9, costs 1 to 20, capacity 6 to 36.
    const arbSmall = fc
      .record({
        tickets: fc.array(fc.record({ effort: fc.integer({ min: 1, max: 9 }), cod: fc.integer({ min: 1, max: 20 }) }), { minLength: 3, maxLength: 8 }),
        capacity: fc.integer({ min: 6, max: 36 }),
        seed: fc.integer({ min: 0, max: 999 }),
      })
      .map(({ tickets, capacity, seed }) => atCapacity(makeBoard(tickets.map((t, i) => ticket(`T${i}`, t.effort, t.cod)), { fogSeed: seed }), capacity));    const outcome = fc.check(
      fc.property(arbSmall, ({ board, freeze }) => decrease(must(fogCurve(board, freeze))) === null),
      { seed: 20261116, numRuns: 3000, verbose: 0 },
    );
    expect(outcome.failed, 'no board with a decrease found: the claim in docs/rule.md would not be shown').toBe(true);
  });

  test('a pinned example: 5 tickets, capacity 7. At 0 % the single big ticket fits; at 5 % four small ones replace it and the chance falls from 324 to 76 nights', () => {
    const { board, freeze } = atCapacity(
      makeBoard([ticket('T0', 3, 1), ticket('T1', 1, 1), ticket('T2', 7, 5), ticket('T3', 1, 1), ticket('T4', 1, 1)], { fogSeed: 0 }),
      7,
    );
    const keptAt = (marginPct: number): string[] => {
      const solved = must(solveFreeze(board, { ...freeze, marginPct }));
      return solved.status === 'ok' ? [...solved.kept].sort() : [];
    };
    expect(keptAt(0)).toEqual(['T2']);
    expect(keptAt(5)).toEqual(['T0', 'T1', 'T3', 'T4']); // not contained in the kept set of 0 %
    const points = must(fogCurve(board, freeze));
    expect(points.map((p) => (p.status === 'ok' ? p.fog.holds : -1))).toEqual([324, 76, 76, 547, 547, 547, 1000]);
    expect(decrease(points)).toEqual({ from: 0, to: 5, holdsFrom: 324, holdsTo: 76 });
  });
});