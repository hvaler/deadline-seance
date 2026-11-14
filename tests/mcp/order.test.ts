import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import sampleCsv from '../../docs/examples/sample-board.csv?raw';
import { deathCertificateTool } from '../../mcp/certificate';
import { solveFreezeTool } from '../../mcp/solve-freeze';
import { whatIfTool } from '../../mcp/what-if';
import { arbPermutedBoard, arbSolveCase } from '../engine/generators';
import { atCapacity } from '../engine/fixtures';
import { GOLDEN, SAMPLE_REQUEST } from './helpers';

describe('MCP: the same request gives the same answer', () => {
  test('two identical calls to each tool are identical', () => {
    const change = { kind: 'exhume', key: 'HB-117' };
    expect(solveFreezeTool(SAMPLE_REQUEST)).toEqual(solveFreezeTool(SAMPLE_REQUEST));
    expect(whatIfTool({ ...SAMPLE_REQUEST, change })).toEqual(whatIfTool({ ...SAMPLE_REQUEST, change }));
    expect(deathCertificateTool(SAMPLE_REQUEST)).toEqual(deathCertificateTool(SAMPLE_REQUEST));
  });

  test('a JSON board with its tickets in another order gives exactly the same answers', () => {
    fc.assert(
      fc.property(
        arbSolveCase({ maxTickets: 12, withWontDo: true }).chain((c) => arbPermutedBoard(c.board).map((shuffled) => ({ c, shuffled }))),
        ({ c, shuffled }) => {
          const a = atCapacity(c.board, c.capacity, c.marginPct);
          const b = atCapacity(shuffled, c.capacity, c.marginPct);
          const req = (board: unknown) => ({ board: { source: 'json', board }, now: a.freeze.now, freezeAt: a.freeze.freezeAt, marginPct: a.freeze.marginPct });
          expect(solveFreezeTool(req(b.board))).toEqual(solveFreezeTool(req(a.board)));
          expect(deathCertificateTool(req(b.board))).toEqual(deathCertificateTool(req(a.board)));
        },
      ),
      { numRuns: 80 },
    );
  });

  test('a CSV with its rows in another order gives the same answer', () => {
    const [header, ...rows] = sampleCsv.trim().split(/\r?\n/);
    fc.assert(
      fc.property(fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }), (shuffled) => {
        const text = [header, ...shuffled].join('\n');
        const times = { now: GOLDEN.now, freezeAt: GOLDEN.freezeAt };
        expect(solveFreezeTool({ board: { source: 'csv', text }, ...times })).toEqual(solveFreezeTool({ board: { source: 'csv', text: sampleCsv }, ...times }));
      }),
      { numRuns: 40 },
    );
  });
});
