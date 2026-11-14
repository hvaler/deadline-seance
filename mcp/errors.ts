import { describeCsvError, describeValidationError, listOf } from '../src/engine/index';
import type { CsvError, EngineError, ValidationError } from '../src/engine/index';

/** The codes the server adds to the engine's own (`EngineErrorCode`, `ValidationErrorCode`, `CsvErrorCode`). */
export type ServerErrorCode = 'bad-time' | 'unknown-person' | 'bad-request' | 'too-large' | 'internal-error';

/** One failure, as data. `code` is the engine's code when the engine found the problem. */
export interface ToolError {
  readonly code: string;
  /** A plain sentence that names the problem and, where it helps, the fix. */
  readonly message: string;
  readonly subject?: string;
  /** The spreadsheet row of a CSV error. */
  readonly row?: number;
  /** The spreadsheet column letter and the header text of a CSV error. */
  readonly column?: string;
  readonly header?: string;
  readonly keys?: readonly string[];
  readonly value?: string | number;
}

/** A handler's answer: the structured value and its text, or a list of errors. Never a throw. */
export type HandlerResult<T> =
  | { readonly ok: true; readonly structured: T; readonly text: string }
  | { readonly ok: false; readonly errors: readonly ToolError[] };

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly ToolError[] };

export function good<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function bad(...errors: readonly ToolError[]): Outcome<never> {
  return { ok: false, errors };
}

export function failure(code: ServerErrorCode | string, message: string, extra: Omit<ToolError, 'code' | 'message'> = {}): ToolError {
  return { code, message, ...extra };
}

/** The sentence for an engine error: made only of the error's own fields. */
function engineMessage(e: EngineError): string {
  const key = e.key ?? '';
  const value = e.value === undefined ? 'nothing' : String(e.value);
  switch (e.code) {
    case 'margin-invalid':
      return `The margin must be 0, 5, 10, 15, 20, 25 or 30 percent (got ${value}).`;
    case 'range-too-long':
      return 'The freeze is too far from now: the engine counts capacity over at most 366 days.';
    case 'invalid-time-zone':
      return `Unknown time zone "${value}".`;
    case 'unknown-key':
      return `${key} is not on the board.`;
    case 'not-a-zombie':
      return `${key} is not a buried zombie, so it cannot be put down.`;
    case 'not-integer':
      return `A number must be a whole number (got ${value}).`;
    case 'solution-impossible':
      return 'The freeze is impossible with these inputs, so there is no cut list to work with.';
    case 'oracle-too-large':
      return 'The board is too large to check by brute force.';
  }
}

export function fromEngine(e: EngineError): ToolError {
  return {
    code: e.code,
    message: engineMessage(e),
    ...(e.key === undefined ? {} : { subject: e.key }),
    ...(e.value === undefined ? {} : { value: e.value }),
  };
}

export function fromValidation(e: ValidationError): ToolError {
  return {
    code: e.code,
    message: describeValidationError(e),
    ...(e.subject === undefined ? {} : { subject: e.subject }),
    ...(e.keys === undefined ? {} : { keys: e.keys }),
    ...(e.value === undefined ? {} : { value: e.value }),
  };
}

export function fromCsv(e: CsvError): ToolError {
  return {
    code: e.code,
    message: describeCsvError(e),
    ...(e.row === null ? {} : { row: e.row }),
    ...(e.column === null ? {} : { column: e.column.letter, header: e.column.header }),
    ...(e.keys === undefined ? {} : { keys: e.keys }),
    ...(e.value === undefined ? {} : { value: e.value }),
  };
}

/** The error for a person who is not on the team: it lists the team, so the caller can fix the name. */
export function unknownPerson(name: string, team: readonly string[]): ToolError {
  return failure('unknown-person', `${name} is not on the team. The team is ${listOf(team)}.`, { subject: name });
}

/** The text of an error result: one line per error. */
export function errorText(errors: readonly ToolError[]): string {
  return errors.map((e) => e.message).join('\n');
}
