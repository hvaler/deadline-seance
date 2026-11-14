import { describe, expect, test } from 'vitest';
import { deathCertificateTool } from '../../mcp/certificate';
import { failure } from '../../mcp/errors';
import type { HandlerResult } from '../../mcp/errors';
import { run } from '../../mcp/run';
import { SolveFreezeInput } from '../../mcp/schemas';
import { solveFreezeTool } from '../../mcp/solve-freeze';
import { whatIfTool } from '../../mcp/what-if';
import { SAMPLE_REQUEST, SMALL_JSON, SMALL_TIMES, failures, leaks } from './helpers';

describe('MCP: errors are results', () => {
  test('bad-request: input that does not fit the schema names the field', () => {
    for (const tool of [solveFreezeTool, whatIfTool, deathCertificateTool]) {
      const e = failures(tool({ board: { source: 'oracle' } }));
      expect(e.length).toBeGreaterThan(0);
      expect(new Set(e.map((x) => x.code))).toEqual(new Set(['bad-request']));
    }
    expect(failures(solveFreezeTool(null))[0]?.code).toBe('bad-request');
    expect(failures(solveFreezeTool('text'))[0]?.code).toBe('bad-request');
    expect(failures(whatIfTool({ ...SAMPLE_REQUEST }))[0]?.message).toContain('change');
    expect(failures(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'explode' } }))[0]?.code).toBe('bad-request');
  });

  test('bad-time, unknown-person and the engine\'s codes keep their code and subject', () => {
    expect(failures(solveFreezeTool({ ...SAMPLE_REQUEST, now: '2026-11-16T09:00' }))[0]?.code).toBe('bad-time');
    expect(failures(solveFreezeTool({ ...SAMPLE_REQUEST, away: [{ person: 'Zoe' }] }))[0]).toMatchObject({ code: 'unknown-person', subject: 'Zoe' });
    expect(failures(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'exhume', key: 'NOPE-1' } }))[0]).toMatchObject({ code: 'unknown-key', subject: 'NOPE-1' });
  });

  test('too-large: a JSON board of more than 1 MiB is refused before the engine sees it', () => {
    const absences = Array.from({ length: 400 }, () => ({ date: '2026-11-20', part: 'full' }));
    const people = Array.from({ length: 100 }, (_, i) => ({ name: `P${i}`, pointsPerHalfDay: 1, daysOff: absences }));
    const e = failures(solveFreezeTool({ board: { source: 'json', board: { ...SMALL_JSON, people } }, ...SMALL_TIMES }));
    expect(e.map((x) => x.code)).toEqual(['too-large']);
  });

  test('internal-error: a body that throws becomes a fixed sentence with no stack, no path and no message of the exception', () => {
    const r = run(SolveFreezeInput, SAMPLE_REQUEST, () => {
      throw new Error('boom at C:\\secret\\place.ts:12');
    });
    const e = failures(r);
    expect(e).toHaveLength(1);
    expect(e[0]?.code).toBe('internal-error');
    expect(e[0]?.message).not.toContain('boom');
    expect(leaks(e[0]?.message ?? '')).toBe(false);
  });

  test('an error carries at least a code and a sentence, and no sentence leaks a path or a stack', () => {
    const requests: [(raw: unknown) => HandlerResult<unknown>, unknown][] = [
      [solveFreezeTool, { board: { source: 'csv', text: 'a,b\n1' } }],
      [solveFreezeTool, { board: { source: 'json', board: { tickets: [], people: [], timeZone: 'X/Y' } }, ...SMALL_TIMES }],
      [whatIfTool, { ...SAMPLE_REQUEST, change: { kind: 'put_down', key: 'HB-101' } }],
      [deathCertificateTool, { ...SAMPLE_REQUEST, exhumed: ['HB-119'] }],
    ];
    for (const [tool, request] of requests) {
      const e = failures(tool(request));
      expect(e.length).toBeGreaterThan(0);
      for (const x of e) {
        expect(x.code).not.toBe('');
        expect(x.message.length).toBeGreaterThan(10);
        expect(leaks(x.message)).toBe(false);
      }
    }
    expect(failure('bad-request', 'x').code).toBe('bad-request');
  });
});
