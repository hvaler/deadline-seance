// Sentences for the errors of a board and of a CSV file, made only of the error's own fields. The UI shows them and the MCP server returns them.
import { MAX_FOG_SEED, SCALE } from './types';
import type { CsvError } from './csv';
import type { ValidationError } from './types';
/** "A", "A and B", "A, B and C". */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** An integer with a comma between thousands: 1000 → "1,000". Formatting only. */
export function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function valueOf(e: ValidationError): string {
  return e.value === undefined ? 'nothing' : String(e.value);
}

/** One sentence per validation error, with the keys and values the engine reported. */
export function describeValidationError(e: ValidationError): string {
  const subject = e.subject ?? 'the board';
  const field = e.field ?? 'value';
  switch (e.code) {
    case 'duplicate-key':
      return e.field === 'wontDo' ? `The put-down key ${subject} is listed twice.` : `Duplicate key ${subject}: two tickets use it.`;
    case 'unknown-dependency':
      return `${subject} depends on ${(e.keys ?? []).join(', ')}, which is not on the board.`;
    case 'self-dependency':
      return `${subject} depends on itself.`;
    case 'dependency-cycle': {
      const keys = e.keys ?? [];
      return `Dependency cycle: ${[...keys, ...keys.slice(0, 1)].join(' → ')}.`;
    }
    case 'not-integer':
      return `${subject}: ${field} must be a whole number (got ${valueOf(e)}).`;
    case 'negative-number':
      return `${subject}: ${field} cannot be negative (got ${valueOf(e)}).`;
    case 'urgency-off-scale':
      return `${subject}: ${field} must be ${listOf(SCALE.map(String)).replace(' and ', ' or ')} (got ${valueOf(e)}).`;
    case 'invalid-time-zone':
      return `Unknown time zone "${valueOf(e)}".`;
    case 'invalid-threshold':
      return `The zombie threshold must be a whole number of 1 or more (got ${valueOf(e)}).`;
    case 'wont-do-key-in-tickets':
      return `${subject} is both a ticket and a put-down key.`;
    case 'seed-out-of-range':
      return `The fog seed must be a whole number from 0 to ${thousands(MAX_FOG_SEED)} (got ${valueOf(e)}).`;
    case 'invalid-absence':
      return `${subject} has an invalid day off: ${valueOf(e)}.`;
    case 'board-too-large':
      return 'The board is too large to solve exactly.';
    default: {
      const unreachable: never = e.code;
      return `Invalid board: ${String(unreachable)}.`;
    }
  }
}

// ---- your tickets (the CSV import) -------------------------------------------------------------------------------------------

/** "Row 7, column E (Story Points)", "Row 7", or "The file". */
function placeOf(e: CsvError): string {
  if (e.row === null) return 'The file';
  if (e.column === null) return `Row ${e.row}`;
  return `Row ${e.row}, column ${e.column.letter} (${e.column.header})`;
}

/** A cell's text, short enough for a sentence. */
function quoted(value: string | undefined): string {
  return `"${value ?? ''}"`;
}

/** One plain sentence for an error of the CSV import, made only of the error's own row, column, value, keys and limit. */
export function describeCsvError(e: CsvError): string {
  const place = placeOf(e);
  const key = e.keys?.[0] ?? '';
  switch (e.code) {
    case 'empty-file':
      return 'The file: it is empty.';
    case 'no-tickets':
      return 'The file: it has no tickets to import.';
    case 'unterminated-quote':
      return `Row ${e.row ?? 0}: a quote is opened and never closed.`;
    case 'missing-column':
      return `The file: the column ${e.value ?? ''} is missing.`;
    case 'duplicate-column':
      return `${place}: this column is also in column ${e.value ?? ''}; keep only one.`;
    case 'missing-value':
      return `${place}: this cell is empty.`;
    case 'bad-key':
      return `${place}: ${quoted(e.value)} cannot be a key (no spaces, commas or semicolons, at most ${e.limit ?? 0} characters).`;
    case 'too-long':
      return `${place}: the text is longer than ${e.limit ?? 0} characters.`;
    case 'not-integer':
      return `${place}: must be a whole number (got ${quoted(e.value)}).`;
    case 'negative-number':
      return `${place}: cannot be negative (got ${quoted(e.value)}).`;
    case 'off-scale':
      return `${place}: must be ${listOf(SCALE.map(String)).replace(' and ', ' or ')} (got ${quoted(e.value)}).`;
    case 'cost-incomplete':
      return `${place}: ${e.value ?? ''} is empty. Give Value, Urgency and Risk together, or only a Cost of Delay.`;
    case 'cost-both':
      return `${place}: this row has a Cost of Delay and also Value, Urgency or Risk. Give one or the other.`;
    case 'cost-missing':
      return `${place}: this row has no cost of delay. Fill Cost of Delay, or Value, Urgency and Risk.`;
    case 'bad-flag':
      return `${place}: must be yes or no (got ${quoted(e.value)}).`;
    case 'duplicate-key':
      return `${place}: ${key} is also used in row ${e.value ?? ''}.`;
    case 'unknown-dependency':
      return `${place}: ${key} is not in the file. Remove the link, or add that issue to the file.`;
    case 'self-dependency':
      return `${place}: ${key} depends on itself.`;
    case 'dependency-cycle': {
      const keys = e.keys ?? [];
      return `${place}: these tickets depend on each other in a circle: ${[...keys, ...keys.slice(0, 1)].join(' → ')}.`;
    }
    case 'too-many-rows':
      return `The file: it has ${e.value ?? ''} rows; the most is ${thousands(e.limit ?? 0)}.`;
    case 'too-many-tickets':
      return `The file: it has ${e.value ?? ''} open tickets; the most is ${e.limit ?? 0}. Filter the Jira export by fix version or sprint, then import it again.`;
    case 'too-many-columns':
      return `${place}: it has ${e.value ?? ''} columns; the most is ${e.limit ?? 0}.`;
    case 'file-too-large':
      return `The file: it is larger than ${thousands(e.limit ?? 0)} bytes.`;
    case 'board-too-large':
      return 'The file: the board is too large to solve exactly.';
    case 'too-many-errors':
      return `The file has ${e.total ?? 0} problems; the first ${e.limit ?? 0} are listed.`;
  }
}

