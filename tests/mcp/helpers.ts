import { SAMPLE_FREEZE_AT, SAMPLE_NOW, sampleBoard, validateBoard } from '../../src/engine/index';
import type { Board, FreezeInput, ValidBoard } from '../../src/engine/index';
import type { HandlerResult, ToolError } from '../../mcp/errors';

/** The sample board, validated, for calls to the engine made directly. */
export const SAMPLE: ValidBoard = (() => {
  const r = validateBoard(sampleBoard());
  if (!r.ok) throw new Error('the sample board is invalid');
  return r.value;
})();

/** Friday 18:00 with no reserve: the golden night. */
export const GOLDEN: FreezeInput = { now: SAMPLE_NOW, freezeAt: SAMPLE_FREEZE_AT, marginPct: 0 };

export const SAMPLE_REQUEST = { board: { source: 'sample' } } as const;

export function answer<T>(r: HandlerResult<T>): { structured: T; text: string } {
  if (!r.ok) throw new Error(`expected an answer, got ${JSON.stringify(r.errors)}`);
  return r;
}

export function failures(r: HandlerResult<unknown>): readonly ToolError[] {
  if (r.ok) throw new Error('expected errors, got an answer');
  return r.errors;
}

export function valid(board: Board): ValidBoard {
  const r = validateBoard(board);
  if (!r.ok) throw new Error(`invalid test board: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** A small board as the JSON a client would send. Friday 2026-11-20 18:00 Madrid is 17:00Z. */
export const SMALL_JSON = {
  tickets: [
    { key: 'T-1', title: 'First', effort: 3, cost: { kind: 'imported', cod: 9 }, mustHave: true },
    { key: 'T-2', title: 'Second', effort: 4, cost: { kind: 'imported', cod: 7 } },
    { key: 'T-3', title: 'Third', effort: 5, cost: { kind: 'imported', cod: 5 }, dependsOn: ['T-2'] },
  ],
  people: [{ name: 'Ana', pointsPerHalfDay: 2, daysOff: [] }],
};
export const SMALL_TIMES = { now: '2026-11-16T09:00:00+01:00', freezeAt: '2026-11-16T13:00:00+01:00' } as const;

/** Every integer in a text, as numbers. */
export function integersIn(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number);
}

/** A message must not carry a stack, a source location or a path of this machine. */
export function leaks(message: string): boolean {
  return /\n\s+at |node_modules|\.(ts|mjs|js):\d+|[A-Za-z]:\\|\/Users\/|\/home\//.test(message);
}

