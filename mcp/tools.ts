import { deathCertificateTool } from './certificate';
import type { HandlerResult } from './errors';
import { solveFreezeTool } from './solve-freeze';
import { CertificateInput, CertificateOutput, SolveFreezeInput, SolveFreezeOutput, WhatIfInput, WhatIfOutput } from './schemas';
import { whatIfTool } from './what-if';

/** What the model reads when it lists the server. No SDK type here: `server.ts` is the only file that knows the SDK. */
export const INSTRUCTIONS =
  'Deadline Seance decides which tickets to cut the night before a freeze. Three read-only tools ask the same rule as the web app: ' +
  'solve_freeze (the cut list with the reason for every ticket outside), what_if (one change: exhume, put down, someone away or back, move the freeze, change the reserve) ' +
  'and death_certificate (the note for stakeholders). Every time is an input: give an ISO 8601 time with a zone, or epoch milliseconds. ' +
  'With board {"source":"sample"} now and freezeAt are optional (Monday 2026-11-16 09:00 and Friday 2026-11-20 18:00, Europe/Madrid). ' +
  'Every number in an answer comes from the engine; do not recompute it.';

export const READ_ONLY = { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false } as const;

export const TOOLS = {
  solve_freeze: {
    title: 'Solve a freeze',
    description:
      'Which tickets stay and which go for a freeze: points, cost of delay, the reason for each ticket outside, zombies, and the chance (of 1000 simulated nights) that the kept work fits. ' +
      'Example: {"board":{"source":"sample"}} answers for Friday 18:00 with 12 tickets kept. A freeze that cannot be met is a result with status "impossible", not an error.',
    inputSchema: SolveFreezeInput,
    outputSchema: SolveFreezeOutput,
    handler: solveFreezeTool as (raw: unknown) => HandlerResult<unknown>,
  },
  what_if: {
    title: 'Try one change',
    description:
      'Same inputs as solve_freeze plus one change: {"kind":"exhume","key":"HB-117"}, {"kind":"put_down","key":"HB-105"}, {"kind":"away","person":"Ana","date":"2026-11-20"}, ' +
      '{"kind":"back","person":"Ana"}, {"kind":"move_freeze","freezeAt":"2026-11-19T18:00:00+01:00"} or {"kind":"margin","marginPct":10}. ' +
      'Returns before and after, what comes in, what goes out and the cost-of-delay difference. A change that makes the freeze impossible says so with the numbers.',
    inputSchema: WhatIfInput,
    outputSchema: WhatIfOutput,
    handler: whatIfTool as (raw: unknown) => HandlerResult<unknown>,
  },
  death_certificate: {
    title: 'Write the death certificate',
    description:
      'The Markdown note for stakeholders for a given night (the cut, the chance, every ticket outside with its reason and cost of waiting), and the verdict of the number guard on it. ' +
      'Optional: release (a name), exhumed and put_down (keys to apply first).',
    inputSchema: CertificateInput,
    outputSchema: CertificateOutput,
    handler: deathCertificateTool as (raw: unknown) => HandlerResult<unknown>,
  },
} as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];
