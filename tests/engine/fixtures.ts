import { validateBoard } from '../../src/engine/validate';
import type { Board, FreezeInput, Ticket, ValidBoard } from '../../src/engine/types';

/** A ticket with an imported cod by default, so hand-made examples can use the numbers they talk about. */
export function ticket(key: string, effort: number, cod: number, over: Partial<Ticket> = {}): Ticket {
  return { key, title: key, effort, cost: { kind: 'imported', cod }, mustHave: false, dependsOn: [], past: 0, ...over };
}

export function makeBoard(tickets: Ticket[], over: Partial<Board> = {}): Board {
  return {
    tickets,
    people: [],
    timeZone: 'Europe/Madrid',
    nextReleaseWeeks: 2,
    zombieThreshold: 3,
    wontDo: [],
    ...over,
  };
}

/** Validates a board and fails the test if it is invalid. */
export function valid(board: Board): ValidBoard {
  const r = validateBoard(board);
  if (!r.ok) throw new Error(`invalid test board: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Monday 2026-10-19, 09:00 to 12:00 in Madrid: exactly one slot (the morning) counts. */
export const ONE_SLOT_FROM = Date.UTC(2026, 9, 19, 7, 0);
export const ONE_SLOT_TO = Date.UTC(2026, 9, 19, 10, 0);

/**
 * The same board with a one-person team that gives exactly `capacity` points in the one-slot window, so tests that
 * go through `solveFreeze` (exhume, put down) can still choose the capacity directly.
 */
export function atCapacity(board: Board, capacity: number, marginPct = 0): { board: ValidBoard; freeze: FreezeInput } {
  return {
    board: valid({ ...board, timeZone: 'Europe/Madrid', people: [{ name: 'Solo', pointsPerHalfDay: capacity, daysOff: [] }] }),
    freeze: { now: ONE_SLOT_FROM, freezeAt: ONE_SLOT_TO, marginPct },
  };
}

export function validOf(tickets: Ticket[], over: Partial<Board> = {}): ValidBoard {
  return valid(makeBoard(tickets, over));
}
