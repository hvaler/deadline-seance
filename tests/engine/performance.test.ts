import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { capacityBetween } from '../../src/engine/capacity';
import { fogCurve, fogTable } from '../../src/engine/fog';
import { solveWithCapacity } from '../../src/engine/solver';
import { atCapacity, valid } from './fixtures';
import { arbSolveCase } from './generators';
import type { SolveCase } from './generators';

// The engine config has no DOM lib, so the timer and console are reached through globalThis.
const host = globalThis as unknown as { performance: { now(): number }; console: { log(...args: unknown[]): void } };
const now = (): number => host.performance.now();
const log = (message: string): void => host.console.log(message);

/** A generous ceiling that catches blow-ups without being flaky on a slow machine. Typical times are a few milliseconds. */
const CEILING_MS = 2000;
const BOARDS = 20;

function timeAll(cases: SolveCase[]): number[] {
  return cases.map((c) => {
    const board = valid(c.board);
    const t0 = now();
    const r = solveWithCapacity(board, c.capacity, c.marginPct);
    const elapsed = now() - t0;
    expect(r.ok).toBe(true);
    return elapsed;
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

describe('performance (80 tickets)', () => {
  test('20 generated boards of 80 tickets each solve in under 2 seconds', () => {
    const cases = fc.sample(arbSolveCase({ minTickets: 80, maxTickets: 80, mustHaveRate: 3 }), { numRuns: BOARDS, seed: 2026 });
    expect(cases).toHaveLength(BOARDS);
    const times = timeAll(cases);
    log(`solver, 80 tickets: median ${median(times).toFixed(2)} ms, max ${Math.max(...times).toFixed(2)} ms`);
    for (const t of times) expect(t).toBeLessThan(CEILING_MS);
  });

  test('20 tie-heavy boards of 80 tickets (the hard case for pruning) also stay under 2 seconds', () => {
    const cases = fc.sample(arbSolveCase({ minTickets: 80, maxTickets: 80, mustHaveRate: 0, ties: true }), { numRuns: BOARDS, seed: 2026 });
    const times = timeAll(cases);
    log(`solver, 80 tie-heavy tickets: median ${median(times).toFixed(2)} ms, max ${Math.max(...times).toFixed(2)} ms`);
    for (const t of times) expect(t).toBeLessThan(CEILING_MS);
  });

  test('boards with few dependencies and a tight capacity stay under 2 seconds', () => {
    const cases = fc.sample(arbSolveCase({ minTickets: 80, maxTickets: 80, mustHaveRate: 0, maxDeps: 0 }), { numRuns: BOARDS, seed: 2026 });
    for (const t of timeAll(cases)) expect(t).toBeLessThan(CEILING_MS);
  });
});

describe('performance (capacity)', () => {
  test('1,000 three-week capacity calculations for a team of four take well under 2 seconds', () => {
    const people = Array.from({ length: 4 }, (_, i) => ({ name: `P${i}`, pointsPerHalfDay: 2, daysOff: [{ date: '2026-10-21', part: 'full' as const }] }));
    const from = Date.UTC(2026, 9, 19, 7, 0);
    const t0 = now();
    for (let i = 0; i < 1000; i++) {
      const r = capacityBetween(people, 'Europe/Madrid', from + i * 60_000, from + 20 * 86_400_000);
      expect(r.ok).toBe(true);
    }
    const elapsed = now() - t0;
    log(`capacity: 1000 calls in ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(CEILING_MS);
  });
});

describe('performance (the fog, 80 tickets)', () => {
  test('the first curve (table built) and a cached one (table kept) of 80-ticket boards stay far under the ceiling', () => {
    const cases = fc.sample(arbSolveCase({ minTickets: 80, maxTickets: 80, mustHaveRate: 3 }), { numRuns: BOARDS, seed: 2026 });
    const first: number[] = [];
    const tableOnly: number[] = [];
    const cached: number[] = [];
    for (const c of cases) {
      const { board, freeze } = atCapacity(c.board, c.capacity);
      let t0 = now();
      const table = fogTable(board);
      tableOnly.push(now() - t0);
      t0 = now();
      const curve = fogCurve(board, freeze, table);
      cached.push(now() - t0);
      expect(curve.ok).toBe(true);
      t0 = now();
      fogCurve(board, freeze);
      first.push(now() - t0);
    }
    log(
      `fog, 80 tickets: table ${median(tableOnly).toFixed(2)} ms (max ${Math.max(...tableOnly).toFixed(2)}), ` +
        `curve with a kept table ${median(cached).toFixed(2)} ms (max ${Math.max(...cached).toFixed(2)}), ` +
        `first curve ${median(first).toFixed(2)} ms (max ${Math.max(...first).toFixed(2)})`,
    );
    for (const t of [...tableOnly, ...cached, ...first]) expect(t).toBeLessThan(CEILING_MS);
  });

  test('the same for the tie-heavy boards, where the solver works hardest', () => {
    const cases = fc.sample(arbSolveCase({ minTickets: 80, maxTickets: 80, mustHaveRate: 0, ties: true }), { numRuns: BOARDS, seed: 2026 });
    const cached: number[] = [];
    for (const c of cases) {
      const { board, freeze } = atCapacity(c.board, c.capacity);
      const table = fogTable(board);
      const t0 = now();
      expect(fogCurve(board, freeze, table).ok).toBe(true);
      cached.push(now() - t0);
    }
    log(`fog, 80 tie-heavy tickets: curve with a kept table ${median(cached).toFixed(2)} ms (max ${Math.max(...cached).toFixed(2)})`);
    for (const t of cached) expect(t).toBeLessThan(CEILING_MS);
  });
});