import * as fc from 'fast-check';
import { allClosures } from '../../src/engine/chain';
import { SCALE } from '../../src/engine/types';
import type { Absence, Board, Cost, Key, Part, Person, Ticket } from '../../src/engine/types';

/** Scale values (1, 2, 3, 5, 8, 13, 20). */
export const arbScale: fc.Arbitrary<number> = fc.constantFrom(...SCALE);

/** Margins the engine accepts: 0, 5, ..., 30. */
export const arbMargin: fc.Arbitrary<number> = fc.constantFrom(0, 5, 10, 15, 20, 25, 30);

// ---------------------------------------------------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------------------------------------------------

export interface BoardOptions {
  /** Default 0. */
  readonly minTickets?: number;
  readonly maxTickets: number;
  /** Largest effort of one ticket. Default 13 (30 above 12 tickets). */
  readonly maxEffort?: number;
  /** Chance, in percent, that a ticket is a must-have. Default 10. */
  readonly mustHaveRate?: number;
  /** Add put-down keys and tickets that depend on them. Default false. */
  readonly withWontDo?: boolean;
  /** Most dependencies per ticket. Default 3. */
  readonly maxDeps?: number;
  /** Tiny efforts (0-2) and imported cods (0-2), so many sets tie and the tie-breaks decide. Default false. */
  readonly ties?: boolean;
}

export const arbCost: fc.Arbitrary<Cost> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .record({ value: arbScale, urgency: arbScale, risk: arbScale })
      .map((c): Cost => ({ kind: 'formula', value: c.value, urgency: c.urgency, risk: c.risk })),
  },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 40 }).map((cod): Cost => ({ kind: 'imported', cod })) },
);

interface TicketSpec {
  readonly prefix: string;
  readonly effort: number;
  readonly cost: Cost;
  readonly mustHave: boolean;
  readonly past: number;
  readonly deps: readonly number[];
  readonly wont: readonly number[];
  readonly order: number;
}

function arbTicketSpec(i: number, wontCount: number, o: Required<Omit<BoardOptions, 'minTickets' | 'withWontDo'>>): fc.Arbitrary<TicketSpec> {
  const arbEffort: fc.Arbitrary<number> = o.ties
    ? fc.integer({ min: 0, max: 2 })
    : fc.oneof({ weight: 1, arbitrary: fc.constant(0) }, { weight: 7, arbitrary: fc.integer({ min: 1, max: o.maxEffort }) });
  const arbTicketCost: fc.Arbitrary<Cost> = o.ties
    ? fc.integer({ min: 0, max: 2 }).map((cod): Cost => ({ kind: 'imported', cod }))
    : arbCost;
  const arbDeps: fc.Arbitrary<number[]> =
    i === 0 || o.maxDeps === 0
      ? fc.constant([])
      : fc.uniqueArray(fc.integer({ min: 0, max: i - 1 }), { maxLength: Math.min(i, o.maxDeps) });
  const arbWont: fc.Arbitrary<number[]> =
    wontCount === 0
      ? fc.constant([])
      : fc.oneof(
          { weight: 5, arbitrary: fc.constant<number[]>([]) },
          { weight: 1, arbitrary: fc.integer({ min: 0, max: wontCount - 1 }).map((k) => [k]) },
        );
  return fc.record({
    prefix: fc.constantFrom('A', 'B', 'CRYPT'),
    effort: arbEffort,
    cost: arbTicketCost,
    // noBias: fast-check favors small integers, which would make "n < rate" far more likely than rate percent.
    mustHave: fc.noBias(fc.integer({ min: 0, max: 99 })).map((n) => n < o.mustHaveRate),
    past: fc.integer({ min: 0, max: 5 }),
    deps: arbDeps,
    wont: arbWont,
    order: fc.nat(),
  });
}

/**
 * Random valid boards. Dependencies only point to lower indexes, so there are no cycles; the final ticket order is
 * shuffled. Keys mix prefixes ('A', 'B', 'CRYPT') with unpadded numbers, so alphabetical order differs from numeric order.
 */
export function arbBoard(options: BoardOptions): fc.Arbitrary<Board> {
  const min = options.minTickets ?? 0;
  const o = {
    maxTickets: options.maxTickets,
    maxEffort: options.maxEffort ?? (options.maxTickets > 12 ? 30 : 13),
    mustHaveRate: options.mustHaveRate ?? 10,
    maxDeps: options.maxDeps ?? 3,
    ties: options.ties ?? false,
  };
  const arbCount = fc.integer({ min, max: options.maxTickets });
  const arbWontCount = options.withWontDo ? fc.integer({ min: 0, max: 3 }) : fc.constant(0);

  return fc
    .tuple(arbCount, arbWontCount)
    .chain(([n, wontCount]) => {
      const specs = Array.from({ length: n }, (_, i) => arbTicketSpec(i, wontCount, o));
      return fc.tuple(
        fc.tuple(...specs) as fc.Arbitrary<TicketSpec[]>,
        fc.constant(wontCount),
        arbPeople(),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 1, max: 5 }),
      );
    })
    .map(([specs, wontCount, people, nextReleaseWeeks, zombieThreshold]): Board => {
      const keys: Key[] = specs.map((s, i) => `${s.prefix}-${i}`);
      const wontKeys: Key[] = Array.from({ length: wontCount }, (_, j) => `W-${j}`);
      const tickets: Ticket[] = specs.map((s, i) => ({
        key: keys[i] as Key,
        title: `Ticket ${keys[i] as Key}`,
        effort: s.effort,
        cost: s.cost,
        mustHave: s.mustHave,
        dependsOn: [...s.deps.map((d) => keys[d] as Key), ...s.wont.map((w) => wontKeys[w] as Key)],
        past: s.past,
      }));
      const order = specs.map((s, i) => ({ s, i })).sort((a, b) => a.s.order - b.s.order || a.i - b.i);
      return {
        tickets: order.map(({ i }) => tickets[i] as Ticket),
        people,
        timeZone: 'Europe/Madrid',
        nextReleaseWeeks,
        zombieThreshold,
        wontDo: wontKeys,
      };
    });
}

export interface SolveCase {
  readonly board: Board;
  readonly capacity: number;
  readonly marginPct: number;
}

/** A board, a capacity and a margin, for the solver properties. */
export function arbSolveCase(options: BoardOptions): fc.Arbitrary<SolveCase> {
  return arbBoard(options).chain((board) =>
    fc.tuple(arbCapacity(board), arbMargin).map(([capacity, marginPct]) => ({ board, capacity, marginPct })),
  );
}

/** Total effort of all tickets. */
export function totalEffort(board: Board): number {
  return board.tickets.reduce((sum, t) => sum + t.effort, 0);
}

/** A capacity from 0 to a little above the total effort, biased toward tight capacities so both fits and misses happen. */
export function arbCapacity(board: Board): fc.Arbitrary<number> {
  const total = totalEffort(board);
  return fc.oneof(
    { weight: 2, arbitrary: fc.integer({ min: 0, max: total + 3 }) },
    { weight: 2, arbitrary: fc.integer({ min: 0, max: Math.max(1, Math.floor(total / 2)) }) },
  );
}

/** Effort of the union of the closures of every must-have (what the freeze needs at least). */
export function mustHaveNeed(board: Board): number {
  const closures = allClosures(board.tickets);
  const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
  const needed = new Set<Key>();
  for (const t of board.tickets) {
    if (t.mustHave) for (const k of closures.get(t.key) ?? []) needed.add(k);
  }
  let sum = 0;
  for (const k of needed) sum += byKey.get(k)?.effort ?? 0;
  return sum;
}

export interface ImpossibleCase {
  readonly board: Board;
  readonly capacity: number;
  readonly marginPct: number;
}

/**
 * Boards with many must-haves and a capacity close to what they need, so "impossible" and "possible" both happen
 * (used for P9). The capacity is within a few points of the must-have need, before the margin.
 */
export function arbBoardForImpossible(options: { maxTickets?: number; withWontDo?: boolean } = {}): fc.Arbitrary<ImpossibleCase> {
  return arbBoard({ maxTickets: options.maxTickets ?? 12, mustHaveRate: 35, withWontDo: options.withWontDo ?? false }).chain((board) =>
    fc.tuple(fc.integer({ min: -8, max: 8 }), arbMargin).map(([delta, marginPct]) => ({
      board,
      capacity: Math.max(0, Math.ceil((mustHaveNeed(board) * 100) / (100 - marginPct)) + delta),
      marginPct,
    })),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Permutations
// ---------------------------------------------------------------------------------------------------------------------

function arbShuffled<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

/** The same board with tickets, dependencies, people, absences and put-down keys in a random order. */
export function arbPermutedBoard(board: Board): fc.Arbitrary<Board> {
  const tickets = fc.tuple(...board.tickets.map((t) => arbShuffled(t.dependsOn).map((dependsOn): Ticket => ({ ...t, dependsOn })))) as fc.Arbitrary<Ticket[]>;
  return fc
    .tuple(
      tickets.chain((ts) => arbShuffled(ts)),
      arbShuffled(board.people),
      arbShuffled(board.wontDo),
    )
    .map(([ts, people, wontDo]) => ({ ...board, tickets: ts, people, wontDo }));
}

function sortedJson<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  return [...items].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0));
}

/** Canonical form of a board: every list sorted. Two boards with the same content have the same canonical form. */
export function canonicalBoard(board: Board): unknown {
  return {
    ...board,
    tickets: sortedJson(
      board.tickets.map((t) => ({ ...t, dependsOn: [...t.dependsOn].sort() })),
      (t) => t.key,
    ),
    people: sortedJson(
      board.people.map((p) => ({ ...p, daysOff: sortedJson(p.daysOff, (a) => `${a.date} ${a.part}`) })),
      (p) => p.name,
    ),
    wontDo: [...board.wontDo].sort(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Time, people, absences
// ---------------------------------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** Time zones: DST in both hemispheres' conventions, a half-hour offset, and UTC. */
export const ZONES = ['Europe/Madrid', 'America/New_York', 'Asia/Kolkata', 'UTC'] as const;

/**
 * Three-week windows, each starting on a Monday and containing a daylight-saving change:
 * US (2026-03-08), EU (2026-03-29) and both EU (2026-10-25) and US (2026-11-01) in autumn.
 */
export const WINDOWS = ['2026-03-02', '2026-03-23', '2026-10-19'] as const;

export interface ZoneWindow {
  readonly timeZone: string;
  /** 'YYYY-MM-DD' of the first day (a Monday). */
  readonly startDate: string;
  /** Epoch ms of that date at 00:00 UTC. */
  readonly startMs: number;
}

export const arbZoneWindow: fc.Arbitrary<ZoneWindow> = fc
  .tuple(fc.constantFrom(...ZONES), fc.constantFrom(...WINDOWS))
  .map(([timeZone, startDate]) => {
    const [y, m, d] = startDate.split('-').map(Number) as [number, number, number];
    return { timeZone, startDate, startMs: Date.UTC(y, m - 1, d) };
  });

function dateAt(window: ZoneWindow, dayOffset: number): string {
  return new Date(window.startMs + dayOffset * DAY_MS).toISOString().slice(0, 10);
}

const arbPart: fc.Arbitrary<Part> = fc.constantFrom('morning', 'afternoon', 'full');

export function arbAbsences(window: ZoneWindow = defaultWindow): fc.Arbitrary<Absence[]> {
  return fc.array(
    fc.record({ day: fc.integer({ min: 0, max: 20 }), part: arbPart }).map(({ day, part }): Absence => ({ date: dateAt(window, day), part })),
    { maxLength: 6 },
  );
}

const defaultWindow: ZoneWindow = { timeZone: 'Europe/Madrid', startDate: '2026-10-19', startMs: Date.UTC(2026, 9, 19) };

/** 0 to 4 people with 0 to 5 points per half day and absences inside the window. */
export function arbPeople(window: ZoneWindow = defaultWindow): fc.Arbitrary<Person[]> {
  return fc
    .array(fc.record({ pointsPerHalfDay: fc.integer({ min: 0, max: 5 }), daysOff: arbAbsences(window) }), { maxLength: 4 })
    .map((list) => list.map((p, i): Person => ({ name: `P${i}`, pointsPerHalfDay: p.pointsPerHalfDay, daysOff: p.daysOff })));
}

export interface CapacityCase {
  readonly window: ZoneWindow;
  readonly people: Person[];
  /** Four instants (epoch ms, whole minutes) inside the window, in ascending order. */
  readonly instants: readonly [number, number, number, number];
}

/** A zone, a window, people and four sorted instants: enough for P11 (two instants) and P14 (three instants). */
export const arbCapacityCase: fc.Arbitrary<CapacityCase> = arbZoneWindow.chain((window) =>
  fc
    .tuple(arbPeople(window), fc.array(fc.integer({ min: 0, max: 21 * 24 * 60 }), { minLength: 4, maxLength: 4 }))
    .map(([people, minutes]) => {
      const sorted = [...minutes].sort((a, b) => a - b).map((m) => window.startMs + m * MINUTE_MS);
      return { window, people, instants: sorted as unknown as [number, number, number, number] };
    }),
);
