import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { exhume, nightFacts, solveFreeze, simulateFog, putDown } from '../../src/engine/index';
import { deathCertificateTool } from '../../mcp/certificate';
import { solveFreezeTool } from '../../mcp/solve-freeze';
import { whatIfTool } from '../../mcp/what-if';
import { arbSolveCase } from '../engine/generators';
import { atCapacity } from '../engine/fixtures';
import { SAMPLE_REQUEST, answer, integersIn } from './helpers';

/** Every integer of the text must be one the structured value carries: the text only places the engine's values. */
function textIsFromStructure(text: string, structured: unknown): void {
  const known = new Set(integersIn(JSON.stringify(structured)));
  for (const n of integersIn(text)) expect(known.has(n), `${n} in: ${text}`).toBe(true);
}

describe('MCP: every number comes from the engine', () => {
  test('golden calls: the integers of each text are in its structured value', () => {
    const a = answer(solveFreezeTool(SAMPLE_REQUEST));
    textIsFromStructure(a.text, a.structured);
    for (const change of [
      { kind: 'exhume', key: 'HB-117' },
      { kind: 'exhume', key: 'HB-119' },
      { kind: 'put_down', key: 'HB-110' },
      { kind: 'away', person: 'Ana', date: '2026-11-20' },
      { kind: 'margin', marginPct: 15 },
      { kind: 'move_freeze', freezeAt: '2026-11-18T18:00:00+01:00' },
    ]) {
      const w = answer(whatIfTool({ ...SAMPLE_REQUEST, change }));
      textIsFromStructure(w.text, w.structured);
    }
  });

  test('the certificate of the golden night passes the guard', () => {
    expect(answer(deathCertificateTool(SAMPLE_REQUEST)).structured.guard).toEqual({ ok: true, offending: [] });
  });

  test('generated boards: structure equals the engine, text integers are in the structure, the certificate passes the guard', () => {
    fc.assert(
      fc.property(arbSolveCase({ maxTickets: 12, withWontDo: true, mustHaveRate: 5 }), fc.nat(), (c, pick) => {
        const { board, freeze } = atCapacity({ ...c.board, zombieThreshold: 1 }, c.capacity, c.marginPct);
        const request = { board: { source: 'json', board }, now: freeze.now, freezeAt: freeze.freezeAt, marginPct: freeze.marginPct };
        const direct = solveFreeze(board, freeze);
        if (!direct.ok) return;
        const solved = solveFreezeTool(request);
        const { structured, text } = answer(solved);
        textIsFromStructure(text, structured);
        expect(structured.status).toBe(direct.value.status);
        expect(structured.capacity).toBe(direct.value.capacity);
        if (direct.value.status === 'ok') {
          expect(structured.kept.map((k) => k.key)).toEqual(direct.value.kept);
          expect(structured.totals).toEqual({ tickets: direct.value.kept.length, points: direct.value.keptEffort, cod: direct.value.savedCod });
          const fog = simulateFog(board, direct.value.kept, direct.value.capacity);
          expect(fog.ok && structured.fog?.holds === fog.value.holds).toBe(true);
          const facts = nightFacts({ home: board, board, freeze, away: [], release: null });
          expect(facts.ok && facts.value.status === 'ok' && structured.outside.length === facts.value.outside.length).toBe(true);
          const keys = board.tickets.map((t) => t.key);
          const key = keys[pick % Math.max(keys.length, 1)];
          if (key !== undefined) {
            const w = whatIfTool({ ...request, change: { kind: pick % 2 === 0 ? 'exhume' : 'put_down', key } });
            const engine = pick % 2 === 0 ? exhume(board, freeze, key) : putDown(board, freeze, key);
            if (w.ok) {
              textIsFromStructure(w.text, w.structured);
              expect(engine.ok).toBe(true);
            } else {
              expect(engine.ok === false || w.errors.length > 0).toBe(true);
            }
          }
        }
        const cert = answer(deathCertificateTool(request));
        expect(cert.structured.guard.ok, JSON.stringify(cert.structured.guard.offending)).toBe(true);
      }),
      { numRuns: 120 },
    );
  });
});
