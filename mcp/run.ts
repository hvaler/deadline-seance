import { failure } from './errors';
import type { HandlerResult, Outcome } from './errors';
import { parseWith } from './schemas';
import type { Schema } from './schemas';

/** What a handler body makes: the structured value and the text rendered from it. */
export interface Made<O> {
  readonly structured: O;
  readonly text: string;
}

/**
 * Runs one handler: parse the raw request, run the body, and turn every failure into data. A body that throws (a bug) becomes `internal-error` with a
 * fixed sentence: no stack, no file path and no message of the exception, which could carry either.
 */
export function run<I, O>(schema: Schema<I>, raw: unknown, body: (input: I) => Outcome<Made<O>>): HandlerResult<O> {
  try {
    const input = parseWith(schema, raw);
    if (!input.ok) return { ok: false, errors: input.errors };
    const made = body(input.value);
    if (!made.ok) return { ok: false, errors: made.errors };
    return { ok: true, structured: made.value.structured, text: made.value.text };
  } catch {
    return { ok: false, errors: [failure('internal-error', 'The server could not answer this request. Check the inputs and try again.')] };
  }
}
