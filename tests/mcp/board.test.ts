import { describe, expect, test } from 'vitest';
import { CSV_LIMITS, importCsv, sampleBoard, validateBoard } from '../../src/engine/index';
import sampleCsv from '../../docs/examples/sample-board.csv?raw';
import { solveFreezeTool } from '../../mcp/solve-freeze';
import { GOLDEN, SAMPLE_REQUEST, SMALL_JSON, SMALL_TIMES, answer, failures } from './helpers';

const TIMES = { now: GOLDEN.now, freezeAt: GOLDEN.freezeAt };
const json = (board: unknown, extra: object = {}) => solveFreezeTool({ board: { source: 'json', board }, ...SMALL_TIMES, ...extra });
const csv = (text: string, extra: object = TIMES) => solveFreezeTool({ board: { source: 'csv', text }, ...extra });

describe('MCP: naming the board', () => {
  test('the sample CSV of the repository gives the sample board\'s tickets and the same cut', () => {
    const fromCsv = answer(csv(sampleCsv));
    const fromSample = answer(solveFreezeTool(SAMPLE_REQUEST));
    expect(fromCsv.structured.kept).toEqual(fromSample.structured.kept);
    expect(fromCsv.structured.outside).toEqual(fromSample.structured.outside);
    expect(fromCsv.structured.totals).toEqual({ tickets: 12, points: 59, cod: 167 });
  });

  test('the "sample" source is the engine\'s sample board', () => {
    const { structured } = answer(solveFreezeTool(SAMPLE_REQUEST));
    const board = sampleBoard();
    const keys = new Set([...structured.kept, ...structured.outside].map((t) => t.key));
    expect(keys).toEqual(new Set(board.tickets.map((t) => t.key)));
  });

  test('a CSV error comes back with the engine\'s code, row, column letter and header, and its sentence', () => {
    const bad = sampleCsv.replace('HB-101,Fix stale balance after a transfer,5,', 'HB-101,Fix stale balance after a transfer,five,');
    const direct = importCsv(bad, { people: sampleBoard().people, timeZone: 'Europe/Madrid', nextReleaseWeeks: 2, zombieThreshold: 3 });
    if (direct.ok) throw new Error('the CSV must be refused');
    const errors = failures(csv(bad));
    expect(errors.map((e) => e.code)).toEqual(direct.error.map((e) => e.code));
    expect(errors[0]).toMatchObject({ code: 'not-integer', row: 2, column: 'C', header: 'Story Points', value: 'five' });
    expect(errors[0]?.message).toBe('Row 2, column C (Story Points): must be a whole number (got "five").');
  });

  test('CSV errors keep the engine\'s order and its cap of 100', () => {
    const rows = ['Issue key,Summary,Story Points,Value,Urgency,Risk'];
    for (let i = 0; i < 150; i += 1) rows.push(`K-${i},t,x,1,1,1`);
    const errors = failures(csv(rows.join('\n')));
    expect(errors).toHaveLength(CSV_LIMITS.errors + 1);
    expect(errors[CSV_LIMITS.errors]?.code).toBe('too-many-errors');
  });

  test('JSON: missing fields take the engine defaults (zone, weeks, threshold, seed, must-have, past)', () => {
    const { structured } = answer(json(SMALL_JSON, { freezeAt: '2026-11-17T18:00:00+01:00' }));
    expect(structured.zone).toBe('Europe/Madrid');
    expect(structured.status).toBe('ok');
  });

  test('JSON: a board that fails validation returns the engine\'s codes and subjects', () => {
    const dup = { ...SMALL_JSON, tickets: [SMALL_JSON.tickets[0], SMALL_JSON.tickets[0]] };
    expect(failures(json(dup)).map((e) => [e.code, e.subject])).toEqual([['duplicate-key', 'T-1']]);
    const unknown = { ...SMALL_JSON, tickets: [{ ...SMALL_JSON.tickets[0], dependsOn: ['NOPE-1'] }] };
    expect(failures(json(unknown)).map((e) => [e.code, e.keys])).toEqual([['unknown-dependency', ['NOPE-1']]]);
    const cycle = {
      ...SMALL_JSON,
      tickets: [
        { key: 'A-1', title: 'a', effort: 1, cost: { kind: 'imported', cod: 1 }, dependsOn: ['A-2'] },
        { key: 'A-2', title: 'b', effort: 1, cost: { kind: 'imported', cod: 1 }, dependsOn: ['A-1'] },
      ],
    };
    const [c] = failures(json(cycle));
    expect(c?.code).toBe('dependency-cycle');
    expect(c?.keys).toEqual(['A-1', 'A-2']);
    expect(c?.message).toBe('Dependency cycle: A-1 → A-2 → A-1.');
    const check = validateBoard({ tickets: [], people: [], timeZone: 'Nowhere/Land', nextReleaseWeeks: 2, zombieThreshold: 3, wontDo: [], fogSeed: 0 });
    expect(check.ok).toBe(false);
    expect(failures(json({ ...SMALL_JSON, timeZone: 'Nowhere/Land' })).map((e) => e.code)).toEqual(['invalid-time-zone']);
  });

  test('size limits: more tickets than the CSV limit is board-too-large before the solver runs; so is a CSV', () => {
    const many = Array.from({ length: CSV_LIMITS.tickets + 1 }, (_, i) => ({ key: `M-${i}`, title: 't', effort: 1, cost: { kind: 'imported', cod: 1 } }));
    expect(failures(json({ ...SMALL_JSON, tickets: many })).map((e) => e.code)).toEqual(['board-too-large']);
    const lines = ['Issue key,Summary,Story Points,Value,Urgency,Risk', ...many.map((t) => `${t.key},t,1,1,1,1`)];
    expect(failures(csv(lines.join('\n'))).map((e) => e.code)).toEqual(['too-many-tickets']);
    const huge = 'a'.repeat(CSV_LIMITS.bytes + 1);
    expect(failures(csv(huge)).map((e) => e.code)).toEqual(['file-too-large']);
  });
});
