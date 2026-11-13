import { err, ok } from './types';
import type { Part, Person, Result } from './types';

/**
 * Half-day capacity.
 *
 * Each Monday-to-Friday has two slots in the board time zone: morning 09:00-13:00 (midpoint 11:00) and afternoon
 * 14:00-18:00 (midpoint 16:00). A slot counts when `from <= midpoint < to`. The same rule applies at both ends, so the
 * capacity of an interval is the sum of the capacities of any two intervals that split it (P14).
 *
 * Only the ECMAScript `Intl` API is used for time zones, so the module runs in browsers, Node and Vitest.
 */

const DAY_MS = 86_400_000;
export const MAX_RANGE_DAYS = 366;
const SLOTS: readonly { readonly part: 'morning' | 'afternoon'; readonly hour: number }[] = [
  { part: 'morning', hour: 11 },
  { part: 'afternoon', hour: 16 },
];

// Caches of pure functions. They never change a result; they only avoid rebuilding formatters and recomputing offsets.
const formatters = new Map<string, Intl.DateTimeFormat | null>();
const midpoints = new Map<string, number>();
const MIDPOINT_CACHE_LIMIT = 5000;

function formatterFor(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  let made: Intl.DateTimeFormat | null;
  try {
    made = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    made = null;
  }
  formatters.set(timeZone, made);
  return made;
}

interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function localParts(ms: number, format: Intl.DateTimeFormat): LocalParts {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of format.formatToParts(ms)) {
    if (part.type in out) out[part.type as keyof typeof out] = Number(part.value);
  }
  return out;
}

/** Offset of the zone from UTC at an instant, in milliseconds (local time minus UTC). */
function offsetAt(ms: number, format: Intl.DateTimeFormat): number {
  const p = localParts(ms, format);
  const wholeSeconds = Math.floor(ms / 1000) * 1000;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - wholeSeconds;
}

/** The instant at which the zone's wall clock shows y-m-d h:00. */
function instantOfLocal(y: number, m: number, d: number, hour: number, format: Intl.DateTimeFormat): number {
  const guess = Date.UTC(y, m - 1, d, hour);
  const first = offsetAt(guess, format);
  const candidate = guess - first;
  const second = offsetAt(candidate, format);
  return second === first ? candidate : guess - second;
}

function isoDate(dayNumber: number): string {
  return new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
}

/** Midpoint instants are cached per zone, date and slot. */
function midpointOf(timeZone: string, date: string, y: number, m: number, d: number, hour: number, format: Intl.DateTimeFormat): number {
  const cacheKey = `${timeZone}|${date}|${hour}`;
  const hit = midpoints.get(cacheKey);
  if (hit !== undefined) return hit;
  const value = instantOfLocal(y, m, d, hour, format);
  if (midpoints.size >= MIDPOINT_CACHE_LIMIT) midpoints.clear();
  midpoints.set(cacheKey, value);
  return value;
}

function absentSlots(person: Person): Set<string> {
  const out = new Set<string>();
  for (const a of person.daysOff) {
    const parts: readonly Part[] = a.part === 'full' ? ['morning', 'afternoon'] : [a.part];
    for (const p of parts) out.add(`${a.date}|${p}`);
  }
  return out;
}

/**
 * Points available between `from` and `to` (epoch milliseconds). People are expected to come from a validated board.
 * Returns an engine error for non-integer instants, an unknown time zone, or a range longer than 366 days.
 */
export function capacityBetween(people: readonly Person[], timeZone: string, from: number, to: number): Result<number> {
  if (!Number.isSafeInteger(from)) return err({ code: 'not-integer', value: String(from) });
  if (!Number.isSafeInteger(to)) return err({ code: 'not-integer', value: String(to) });
  const format = formatterFor(timeZone);
  if (format === null) return err({ code: 'invalid-time-zone', value: timeZone });
  if (to <= from) return ok(0);

  const a = localParts(from, format);
  const b = localParts(to, format);
  const firstDay = Math.floor(Date.UTC(a.year, a.month - 1, a.day) / DAY_MS);
  const lastDay = Math.floor(Date.UTC(b.year, b.month - 1, b.day) / DAY_MS);
  if (lastDay - firstDay > MAX_RANGE_DAYS) return err({ code: 'range-too-long', value: lastDay - firstDay });

  // A slot on a date before the local date of `from` ends before `from`; one after the local date of `to` starts after it.
  const counted: string[] = [];
  for (let day = firstDay; day <= lastDay; day++) {
    const dow = new Date(day * DAY_MS).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const date = isoDate(day);
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7));
    const d = Number(date.slice(8, 10));
    for (const slot of SLOTS) {
      const mid = midpointOf(timeZone, date, y, m, d, slot.hour, format);
      if (from <= mid && mid < to) counted.push(`${date}|${slot.part}`);
    }
  }
  if (counted.length === 0) return ok(0);

  let total = 0;
  for (const person of people) {
    if (person.pointsPerHalfDay === 0) continue;
    const away = absentSlots(person);
    let present = 0;
    for (const slot of counted) if (!away.has(slot)) present++;
    total += present * person.pointsPerHalfDay;
  }
  return ok(total);
}

/** `floor(capacity * (100 - marginPct) / 100)`; the margin must be 0, 5, ..., 30. */
export function effectiveCapacity(capacity: number, marginPct: number): Result<number> {
  if (!Number.isSafeInteger(capacity) || capacity < 0) return err({ code: 'not-integer', value: String(capacity) });
  if (!Number.isInteger(marginPct) || marginPct < 0 || marginPct > 30 || marginPct % 5 !== 0) {
    return err({ code: 'margin-invalid', value: String(marginPct) });
  }
  return ok(Math.floor((capacity * (100 - marginPct)) / 100));
}
