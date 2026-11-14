import * as z from 'zod/v4';
import { CSV_LIMITS } from '../src/engine/index';
import { bad, failure, good } from './errors';
import type { Outcome } from './errors';

// The input and output schemas of the three tools. The only file of the handlers that imports zod. Types are inferred from the schemas, so a schema and its type
// cannot differ. Numbers are `z.number()` without `.int()` on purpose: a fraction reaches the engine, which names it in a sentence, instead of the SDK's own message.

const Text = (max: number) => z.string().max(max);

const Cost = z.union([
  z.object({ kind: z.literal('formula'), value: z.number(), urgency: z.number(), risk: z.number() }),
  z.object({ kind: z.literal('imported'), cod: z.number() }),
]);

const JsonTicket = z.object({
  key: Text(CSV_LIMITS.key),
  title: Text(CSV_LIMITS.summary),
  effort: z.number().describe('Points left, a whole number of 0 or more.'),
  cost: Cost.describe('{ kind: "formula", value, urgency, risk } on the scale 1, 2, 3, 5, 8, 13, 20, or { kind: "imported", cod }.'),
  mustHave: z.boolean().optional(),
  dependsOn: z.array(Text(CSV_LIMITS.key)).max(CSV_LIMITS.rows).optional(),
  past: z.number().optional().describe('Releases in a row the ticket has been left out.'),
});

const Absence = z.object({
  date: z.string().max(10).describe('YYYY-MM-DD in the board time zone.'),
  part: z.enum(['morning', 'afternoon', 'full']),
});

const JsonPerson = z.object({
  name: Text(CSV_LIMITS.key),
  pointsPerHalfDay: z.number(),
  daysOff: z.array(Absence).max(400).optional(),
});

export const JsonBoard = z.object({
  tickets: z.array(JsonTicket).max(CSV_LIMITS.rows),
  people: z.array(JsonPerson).max(200),
  timeZone: z.string().max(100).optional().describe('IANA name; default Europe/Madrid.'),
  nextReleaseWeeks: z.number().optional().describe('Default 2.'),
  zombieThreshold: z.number().optional().describe('Default 3.'),
  wontDo: z.array(Text(CSV_LIMITS.key)).max(CSV_LIMITS.rows).optional().describe('Keys of tickets already put down.'),
  fogSeed: z.number().optional().describe('An integer from 0 to 4294967295; default 0.'),
});

export const BoardSource = z
  .discriminatedUnion('source', [
    z.object({ source: z.literal('sample') }),
    z.object({ source: z.literal('csv'), text: z.string().describe('The text of a Jira CSV export.') }),
    z.object({ source: z.literal('json'), board: JsonBoard }),
  ])
  .describe('"sample" is the app\'s sample board (Hollow Bank app 3.2). "csv" is Jira CSV text. "json" is a board object.');

const Instant = z
  .union([z.string().max(64), z.number()])
  .describe('An ISO 8601 time with a zone (2026-11-20T18:00:00+01:00 or ...Z), or epoch milliseconds.');

export const AwayEntry = z.object({
  person: Text(CSV_LIMITS.key).describe('A name on the team.'),
  date: z.string().max(10).optional().describe('YYYY-MM-DD in the board time zone. Without it the person is away for the whole night.'),
  part: z.enum(['morning', 'afternoon', 'full']).optional().describe('Which part of that day; default full.'),
});

const requestShape = {
  board: BoardSource,
  now: Instant.optional().describe('Required unless the board is the sample (Monday 2026-11-16 09:00 Madrid).'),
  freezeAt: Instant.optional().describe('Required unless the board is the sample (Friday 2026-11-20 18:00 Madrid).'),
  marginPct: z.number().optional().describe('Reserve in percent: 0, 5, 10, 15, 20, 25 or 30. Default 0.'),
  away: z.array(AwayEntry).max(200).optional().describe('People away.'),
};

export const SolveFreezeInput = z.object(requestShape);

export const Change = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exhume'), key: Text(CSV_LIMITS.key) }),
  z.object({ kind: z.literal('put_down'), key: Text(CSV_LIMITS.key) }),
  z.object({ kind: z.literal('away'), person: Text(CSV_LIMITS.key), date: z.string().max(10).optional(), part: z.enum(['morning', 'afternoon', 'full']).optional() }),
  z.object({ kind: z.literal('back'), person: Text(CSV_LIMITS.key) }),
  z.object({ kind: z.literal('move_freeze'), freezeAt: Instant }),
  z.object({ kind: z.literal('margin'), marginPct: z.number() }),
]);

export const WhatIfInput = z.object({ ...requestShape, change: Change.describe('Exactly one change to try.') });

export const CertificateInput = z.object({
  ...requestShape,
  release: Text(60).optional().describe('What the release is called; default the sample\'s name for the sample board.'),
  exhumed: z.array(Text(CSV_LIMITS.key)).max(200).optional().describe('Keys to exhume before writing.'),
  put_down: z.array(Text(CSV_LIMITS.key)).max(200).optional().describe('Keys of buried zombies to put down before writing.'),
});

// ---- outputs ----

const Int = z.number();
const Stamp = z.object({ weekday: z.string(), date: z.string(), time: z.string() });
const Fog = z.object({ nights: Int, holds: Int, pct: Int });
const TicketRow = z.object({ key: z.string(), title: z.string(), effort: Int, cod: Int });

const Reason = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('no-room'), needed: Int, left: Int }),
  z.object({ kind: z.literal('depends-on-buried'), buriedDependencies: z.array(z.string()) }),
  z.object({ kind: z.literal('blocked-by-put-down'), putDownKey: z.string() }),
  z.object({ kind: z.literal('pushed-out-by-exhume'), exhumed: z.array(z.string()), together: z.boolean(), needed: Int, left: Int }),
]);

const Outside = z.object({
  key: z.string(),
  title: z.string(),
  effort: Int,
  cod: Int,
  waitingCost: Int,
  isZombie: z.boolean(),
  reason: Reason,
});

const Blocked = z.object({ key: z.string(), putDownKey: z.string() });

export const SolveFreezeOutput = z.object({
  status: z.enum(['ok', 'impossible']),
  zone: z.string(),
  asOf: Stamp,
  freeze: Stamp,
  capacity: Int,
  effectiveCapacity: Int,
  marginPct: Int,
  away: z.array(z.string()),
  kept: z.array(TicketRow),
  totals: z.object({ tickets: Int, points: Int, cod: Int }).nullable(),
  outside: z.array(Outside),
  outsideTotals: z.object({ tickets: Int, points: Int, cod: Int, waitingCost: Int }).nullable(),
  zombies: z.array(z.string()),
  fog: Fog.nullable(),
  needed: Int.nullable().describe('For an impossible freeze: the points the must-haves need.'),
  blockedMustHaves: z.array(Blocked),
});

const Side = z.object({
  status: z.enum(['ok', 'impossible']),
  capacity: Int,
  effectiveCapacity: Int,
  marginPct: Int,
  tickets: Int.nullable(),
  points: Int.nullable(),
  cod: Int.nullable(),
  fog: Fog.nullable(),
  needed: Int.nullable(),
});

export const WhatIfOutput = z.object({
  change: z.string().describe('The change in words, from the request.'),
  before: Side,
  after: Side,
  rejected: z.boolean().describe('True when the change would make the freeze impossible.'),
  comes_in: z.array(TicketRow),
  goes_out: z.array(TicketRow),
  cod_delta: Int.nullable().describe('Cost of delay kept after, minus before. Null when either side is impossible.'),
});

export const CertificateOutput = z.object({
  markdown: z.string(),
  guard: z.object({
    ok: z.boolean(),
    offending: z.array(z.object({ text: z.string(), reason: z.string(), at: Int })),
  }),
});

export type BoardSourceInput = z.infer<typeof BoardSource>;
export type AwayEntryInput = z.infer<typeof AwayEntry>;
export type RequestInput = z.infer<typeof SolveFreezeInput>;
export type ChangeInput = z.infer<typeof Change>;
export type WhatIfInputValue = z.infer<typeof WhatIfInput>;
export type CertificateInputValue = z.infer<typeof CertificateInput>;
export type SolveFreezeOutputValue = z.infer<typeof SolveFreezeOutput>;
export type WhatIfOutputValue = z.infer<typeof WhatIfOutput>;
export type CertificateOutputValue = z.infer<typeof CertificateOutput>;
export type SideValue = z.infer<typeof Side>;
export type TicketRowValue = z.infer<typeof TicketRow>;
export type JsonBoardValue = z.infer<typeof JsonBoard>;

/** Parses a raw request with a schema. A mismatch is a `bad-request` error that names the field, never a throw. */
export type Schema<T> = z.ZodType<T>;

export function parseWith<T>(schema: Schema<T>, raw: unknown): Outcome<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return good(parsed.data);
  const errors = parsed.error.issues.slice(0, 10).map((issue) => {
    const path = issue.path.map(String).join('.');
    return failure('bad-request', `${path === '' ? 'The request' : path}: ${issue.message}`, path === '' ? {} : { subject: path });
  });
  return bad(...errors);
}