import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { deathCertificateTool } from '../../mcp/certificate';
import { solveFreezeTool } from '../../mcp/solve-freeze';
import { whatIfTool } from '../../mcp/what-if';
import { TOOLS } from '../../mcp/tools';
import { SAMPLE_REQUEST, leaks } from './helpers';

const handlers = [solveFreezeTool, whatIfTool, deathCertificateTool] as const;

/** Whatever a handler returns must be an answer or a list of errors, and never leak. */
function check(result: unknown): void {
  const r = result as { ok: boolean; errors?: { code: string; message: string }[]; text?: string; structured?: unknown };
  expect(typeof r.ok).toBe('boolean');
  if (r.ok) {
    expect(typeof r.text).toBe('string');
    expect(r.structured).toBeTypeOf('object');
  } else {
    expect(r.errors?.length).toBeGreaterThan(0);
    for (const e of r.errors ?? []) {
      expect(typeof e.code).toBe('string');
      expect(typeof e.message).toBe('string');
      expect(leaks(e.message)).toBe(false);
      expect(e.code).not.toBe('internal-error');
    }
  }
}

const arbInstant = fc.oneof(fc.string(), fc.integer(), fc.double({ noNaN: false }), fc.constant(undefined), fc.constantFrom('2026-11-20T18:00:00+01:00', '2026-11-20T18:00', '2026-02-30T10:00:00Z'));
const arbChange = fc.oneof(
  fc.record({ kind: fc.constant('exhume'), key: fc.oneof(fc.string(), fc.constantFrom('HB-117', 'HB-119', 'HB-101')) }),
  fc.record({ kind: fc.constant('put_down'), key: fc.oneof(fc.string(), fc.constantFrom('HB-110', 'HB-112', 'HB-101')) }),
  fc.record({ kind: fc.constant('away'), person: fc.oneof(fc.string(), fc.constantFrom('Ana', 'Dev')), date: fc.oneof(fc.string(), fc.constant(undefined)) }),
  fc.record({ kind: fc.constant('back'), person: fc.string() }),
  fc.record({ kind: fc.constant('move_freeze'), freezeAt: arbInstant }),
  fc.record({ kind: fc.constant('margin'), marginPct: fc.oneof(fc.integer(), fc.double(), fc.constantFrom(0, 10, 30)) }),
);
const arbBoard = fc.oneof(
  fc.constant({ source: 'sample' }),
  fc.record({ source: fc.constant('csv'), text: fc.oneof(fc.string(), fc.constant('Issue key,Summary,Story Points,Value,Urgency,Risk\nA-1,x,3,1,1,1')) }),
  fc.record({ source: fc.constant('json'), board: fc.jsonValue() }),
);
const arbRequest = fc.record(
  { board: arbBoard, now: arbInstant, freezeAt: arbInstant, marginPct: fc.oneof(fc.integer(), fc.double(), fc.constantFrom(0, 5, 30)), away: fc.array(fc.record({ person: fc.string(), date: fc.string() }, { requiredKeys: ['person'] }), { maxLength: 3 }) },
  { requiredKeys: ['board'] },
);

describe('MCP: fuzz', () => {
  test('arbitrary JSON to every handler gives only answers or errors', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        for (const handler of handlers) check(handler(value));
      }),
      { numRuns: 300 },
    );
  });

  test('arbitrary strings, times, margins, people and changes inside well-formed requests', () => {
    fc.assert(
      fc.property(arbRequest, arbChange, fc.array(fc.string(), { maxLength: 3 }), (request, change, keys) => {
        check(solveFreezeTool(request));
        check(whatIfTool({ ...request, change }));
        check(deathCertificateTool({ ...request, exhumed: keys, put_down: keys }));
      }),
      { numRuns: 150 },
    );
  });

  test('arbitrary text as a CSV never throws, and every error names a row that exists', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (text) => {
        const r = solveFreezeTool({ board: { source: 'csv', text }, now: 0, freezeAt: 1000 });
        check(r);
        if (!r.ok) {
          const rows = text.split(/\r\n|\n|\r/).length;
          for (const e of r.errors) if (e.row !== undefined) expect(e.row).toBeLessThanOrEqual(rows + 1);
        }
      }),
      { numRuns: 300 },
    );
  });

  test('the zod schemas of every tool never throw on arbitrary input', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        for (const tool of Object.values(TOOLS)) {
          expect(() => tool.inputSchema.safeParse(value)).not.toThrow();
          expect(() => tool.outputSchema.safeParse(value)).not.toThrow();
        }
      }),
      { numRuns: 300 },
    );
  });

  test('the sample request itself is accepted by the three input schemas', () => {
    expect(TOOLS.solve_freeze.inputSchema.safeParse(SAMPLE_REQUEST).success).toBe(true);
    expect(TOOLS.what_if.inputSchema.safeParse({ ...SAMPLE_REQUEST, change: { kind: 'exhume', key: 'HB-117' } }).success).toBe(true);
    expect(TOOLS.death_certificate.inputSchema.safeParse(SAMPLE_REQUEST).success).toBe(true);
  });
});
