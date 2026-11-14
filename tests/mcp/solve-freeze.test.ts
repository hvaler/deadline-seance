import { describe, expect, test } from 'vitest';
import { effectiveCapacity, nightFacts, simulateFog, solveFreeze } from '../../src/engine/index';
import { solveFreezeTool } from '../../mcp/solve-freeze';
import { GOLDEN, SAMPLE, SAMPLE_REQUEST, SMALL_JSON, SMALL_TIMES, answer, valid } from './helpers';
import { sampleBoard } from '../../src/engine/index';

describe('MCP: solve_freeze on the sample board', () => {
  test('the golden night: 12 tickets, 59 points, cost of delay 167, holds on 0 of 1000', () => {
    const { structured } = answer(solveFreezeTool(SAMPLE_REQUEST));
    expect(structured.status).toBe('ok');
    expect(structured.totals).toEqual({ tickets: 12, points: 59, cod: 167 });
    expect(structured.fog).toEqual({ nights: 1000, holds: 0, pct: 0 });
    expect(structured.capacity).toBe(59);
    expect(structured.kept).toHaveLength(12);
  });

  test('every field equals what the engine says when called directly', () => {
    const { structured } = answer(solveFreezeTool(SAMPLE_REQUEST));
    const direct = solveFreeze(SAMPLE, GOLDEN);
    if (!direct.ok || direct.value.status !== 'ok') throw new Error('the golden night must be solved');
    expect(structured.kept.map((k) => k.key)).toEqual(direct.value.kept);
    expect(structured.zombies).toEqual(direct.value.zombies);
    expect(structured.totals?.points).toBe(direct.value.keptEffort);
    expect(structured.totals?.cod).toBe(direct.value.savedCod);
    expect(structured.outsideTotals?.cod).toBe(direct.value.buriedCod);
    expect(structured.outsideTotals?.points).toBe(direct.value.buriedEffort);
    const fog = simulateFog(SAMPLE, direct.value.kept, direct.value.capacity);
    expect(fog.ok && structured.fog?.holds === fog.value.holds && structured.fog.pct === fog.value.pct).toBe(true);
    const facts = nightFacts({ home: SAMPLE, board: SAMPLE, freeze: GOLDEN, away: [], release: null });
    if (!facts.ok || facts.value.status !== 'ok') throw new Error('facts');
    expect(structured.outside.map((o) => [o.key, o.reason, o.waitingCost, o.isZombie])).toEqual(
      facts.value.outside.map((o) => [o.key, o.reason, o.waitingCost, o.isZombie]),
    );
    expect(structured.freeze).toEqual(facts.value.freeze);
    expect(structured.asOf).toEqual(facts.value.asOf);
  });

  test('the reasons of the sample are "no room" and "depends on buried" (HB-114 follows HB-112)', () => {
    const { structured } = answer(solveFreezeTool(SAMPLE_REQUEST));
    const kinds = new Set(structured.outside.map((o) => o.reason.kind));
    expect(kinds).toEqual(new Set(['no-room', 'depends-on-buried']));
    expect(structured.outside.find((o) => o.key === 'HB-114')?.reason).toEqual({ kind: 'depends-on-buried', buriedDependencies: ['HB-112'] });
    expect(structured.zombies).toEqual(['HB-110', 'HB-112']);
  });

  test('a reserve changes the effective capacity by the engine\'s own formula', () => {
    const { structured } = answer(solveFreezeTool({ ...SAMPLE_REQUEST, marginPct: 10 }));
    const direct = effectiveCapacity(59, 10);
    expect(direct.ok && structured.effectiveCapacity === direct.value).toBe(true);
    expect(structured.marginPct).toBe(10);
  });

  test('a person away for the night equals the team without them; a dated absence equals daysOff', () => {
    const whole = answer(solveFreezeTool({ ...SAMPLE_REQUEST, away: [{ person: 'Ana' }] }));
    const sample = sampleBoard();
    const without = valid({ ...sample, people: sample.people.filter((p) => p.name !== 'Ana') });
    const d1 = solveFreeze(without, GOLDEN);
    if (!d1.ok || d1.value.status !== 'ok') throw new Error('solve');
    expect(whole.structured.kept.map((k) => k.key)).toEqual(d1.value.kept);
    expect(whole.structured.away).toEqual(['Ana']);

    const dated = answer(solveFreezeTool({ ...SAMPLE_REQUEST, away: [{ person: 'Ana', date: '2026-11-20' }] }));
    const withAbsence = valid({ ...sample, people: sample.people.map((p) => (p.name === 'Ana' ? { ...p, daysOff: [{ date: '2026-11-20', part: 'full' as const }] } : p)) });
    const d2 = solveFreeze(withAbsence, GOLDEN);
    if (!d2.ok || d2.value.status !== 'ok') throw new Error('solve');
    expect(dated.structured.kept.map((k) => k.key)).toEqual(d2.value.kept);
    expect(dated.structured.capacity).toBe(d2.value.capacity);
    expect(dated.structured.away).toEqual([]);
  });

  test('the same instant as ISO with an offset, with Z, and as epoch milliseconds gives the same answer', () => {
    const base = answer(solveFreezeTool(SAMPLE_REQUEST));
    const iso = answer(solveFreezeTool({ ...SAMPLE_REQUEST, now: '2026-11-16T09:00:00+01:00', freezeAt: '2026-11-20T18:00+01:00' }));
    const z = answer(solveFreezeTool({ ...SAMPLE_REQUEST, now: '2026-11-16T08:00:00Z', freezeAt: '2026-11-20T17:00:00.000Z' }));
    const ms = answer(solveFreezeTool({ ...SAMPLE_REQUEST, now: GOLDEN.now, freezeAt: GOLDEN.freezeAt }));
    expect(iso).toEqual(base);
    expect(z).toEqual(base);
    expect(ms).toEqual(base);
  });
});

describe('MCP: solve_freeze on other boards', () => {
  test('a board that cannot meet its must-haves is a result with status "impossible" and the numbers', () => {
    const board = { ...SMALL_JSON, tickets: [{ key: 'T-1', title: 'Huge', effort: 50, cost: { kind: 'imported', cod: 9 }, mustHave: true }] };
    const { structured, text } = answer(solveFreezeTool({ board: { source: 'json', board }, ...SMALL_TIMES }));
    expect(structured.status).toBe('impossible');
    expect(structured.needed).toBe(50);
    expect(structured.kept).toEqual([]);
    expect(text).toContain('impossible');
    expect(text).toContain('50');
  });

  test('a ticket that depends on a put-down ticket is outside, with the reason "blocked by put down"', () => {
    const board = {
      ...SMALL_JSON,
      tickets: [
        { key: 'T-1', title: 'First', effort: 1, cost: { kind: 'imported', cod: 9 } },
        { key: 'T-2', title: 'Second', effort: 1, cost: { kind: 'imported', cod: 7 }, dependsOn: ['W-1'] },
      ],
      wontDo: ['W-1'],
    };
    const { structured } = answer(solveFreezeTool({ board: { source: 'json', board }, ...SMALL_TIMES }));
    expect(structured.outside.find((o) => o.key === 'T-2')?.reason).toEqual({ kind: 'blocked-by-put-down', putDownKey: 'W-1' });
  });

  test('a board with no room for everything keeps what fits and says "no room" with the numbers', () => {
    const { structured } = answer(solveFreezeTool({ board: { source: 'json', board: SMALL_JSON }, ...SMALL_TIMES, freezeAt: '2026-11-17T18:00:00+01:00' }));
    expect(structured.status).toBe('ok');
    expect(structured.kept.map((k) => k.key)).toEqual(['T-1', 'T-2']);
    expect(structured.outside.map((o) => [o.key, o.reason.kind])).toEqual([['T-3', 'no-room']]);
    expect(structured.outside[0]?.reason).toEqual({ kind: 'no-room', needed: 5, left: 1 });
  });
});
