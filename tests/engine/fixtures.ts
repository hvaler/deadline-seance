import { validateBoard } from '../../src/engine/validate';
import type { Board, Ticket, ValidBoard } from '../../src/engine/types';

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

export function validOf(tickets: Ticket[], over: Partial<Board> = {}): ValidBoard {
  return valid(makeBoard(tickets, over));
}
