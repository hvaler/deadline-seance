import { bad, failure, good } from './errors';
import type { Outcome } from './errors';

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;
/** The range of instants a JavaScript date can hold. */
const MAX_MS = 8_640_000_000_000_000;

/**
 * An instant from the caller: an ISO 8601 string with an explicit zone (`Z` or `+hh:mm`), or an integer number of epoch milliseconds.
 * It never reads the clock and never guesses a zone: a string with no zone is an error that says what to add.
 */
export function parseInstant(name: string, value: unknown): Outcome<number> {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && Math.abs(value) <= MAX_MS) return good(value);
    return bad(failure('bad-time', `${name} must be a whole number of epoch milliseconds (got ${String(value)}).`, { value }));
  }
  if (typeof value !== 'string') {
    return bad(failure('bad-time', `${name} must be an ISO 8601 time with a zone, such as 2026-11-20T18:00:00+01:00, or epoch milliseconds.`));
  }
  const m = ISO.exec(value);
  if (m === null) {
    const hasZone = /(Z|[+-]\d{2}:\d{2})$/.test(value);
    const hint = hasZone
      ? 'Write it as YYYY-MM-DDThh:mm[:ss[.fff]] followed by Z or +hh:mm.'
      : 'It has no zone: add Z or an offset such as +01:00 (the server never guesses a zone).';
    return bad(failure('bad-time', `${name} "${value.slice(0, 40)}" is not a valid ISO 8601 time. ${hint}`, { value: value.slice(0, 40) }));
  }
  const [, y, mo, d, h, mi, s, f, z, sign, oh, om] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s ?? '0');
  const milli = Number((f ?? '0').padEnd(3, '0'));
  const offsetH = Number(oh ?? '0');
  const offsetM = Number(om ?? '0');
  const local = Date.UTC(year, month - 1, day, hour, minute, second, milli);
  const probe = new Date(local);
  const calendarOk =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59;
  if (!calendarOk || offsetH > 23 || offsetM > 59) {
    return bad(failure('bad-time', `${name} "${value}" is not a real date and time.`, { value }));
  }
  const offset = z === 'Z' ? 0 : (sign === '-' ? -1 : 1) * (offsetH * 60 + offsetM) * 60_000;
  return good(local - offset);
}
