import { findCycles } from './chain';
import { compareKeys } from './keys';
import { MAX_FOG_SEED, SCALE } from './types';
import type { Board, Key, Result, Ticket, ValidBoard, ValidationError } from './types';
import { weightsFitSafeIntegers } from './weights';

const SCALE_SET: ReadonlySet<number> = new Set(SCALE);
const MAX_SCALE = SCALE[SCALE.length - 1] as number;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function isRealDate(text: string): boolean {
  const m = DATE_RE.exec(text);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Checks a non-negative integer field. Returns true when it is usable. */
function checkCount(errors: ValidationError[], subject: string, field: string, value: number): boolean {
  if (!Number.isSafeInteger(value)) {
    errors.push({ code: 'not-integer', subject, field, value: String(value) });
    return false;
  }
  if (value < 0) {
    errors.push({ code: 'negative-number', subject, field, value });
    return false;
  }
  return true;
}

function checkScale(errors: ValidationError[], subject: string, field: string, value: number): boolean {
  if (!Number.isSafeInteger(value)) {
    errors.push({ code: 'not-integer', subject, field, value: String(value) });
    return false;
  }
  if (!SCALE_SET.has(value)) {
    errors.push({ code: 'urgency-off-scale', subject, field, value });
    return false;
  }
  return true;
}

function errorOrder(a: ValidationError, b: ValidationError): number {
  return (
    compareKeys(a.code, b.code) ||
    compareKeys(a.subject ?? '', b.subject ?? '') ||
    compareKeys(a.field ?? '', b.field ?? '') ||
    compareKeys((a.keys ?? []).join('\u0000'), (b.keys ?? []).join('\u0000')) ||
    compareKeys(String(a.value ?? ''), String(b.value ?? ''))
  );
}

/**
 * Validates a board. Returns the same board, branded, when it is valid; otherwise the complete list of errors, sorted
 * deterministically, so the result does not depend on the order of tickets, people or dependencies.
 */
export function validateBoard(board: Board): Result<ValidBoard, ValidationError[]> {
  const errors: ValidationError[] = [];
  let numbersOk = true;

  // Board-level fields.
  if (!isValidTimeZone(board.timeZone)) {
    errors.push({ code: 'invalid-time-zone', subject: 'timeZone', value: board.timeZone });
  }
  if (!checkCount(errors, 'board', 'nextReleaseWeeks', board.nextReleaseWeeks)) numbersOk = false;
  if (!Number.isSafeInteger(board.zombieThreshold) || board.zombieThreshold < 1) {
    errors.push({ code: 'invalid-threshold', subject: 'board', field: 'zombieThreshold', value: String(board.zombieThreshold) });
  }

  if (!Number.isSafeInteger(board.fogSeed)) {
    errors.push({ code: 'not-integer', subject: 'board', field: 'fogSeed', value: String(board.fogSeed) });
  } else if (board.fogSeed < 0 || board.fogSeed > MAX_FOG_SEED) {
    errors.push({ code: 'seed-out-of-range', subject: 'board', field: 'fogSeed', value: board.fogSeed });
  }
  // Duplicate keys among tickets, and among wontDo.
  const ticketKeys = new Set<Key>();
  const dupTickets = new Set<Key>();
  for (const t of board.tickets) {
    if (ticketKeys.has(t.key)) dupTickets.add(t.key);
    ticketKeys.add(t.key);
  }
  for (const key of dupTickets) errors.push({ code: 'duplicate-key', subject: key });

  const wontDo = new Set<Key>();
  const dupWont = new Set<Key>();
  for (const key of board.wontDo) {
    if (wontDo.has(key)) dupWont.add(key);
    wontDo.add(key);
  }
  for (const key of dupWont) errors.push({ code: 'duplicate-key', subject: key, field: 'wontDo' });
  for (const key of wontDo) {
    if (ticketKeys.has(key)) errors.push({ code: 'wont-do-key-in-tickets', subject: key });
  }

  // Ticket numbers and dependency targets.
  let totalEffort = 0;
  let totalCodBound = 0;
  for (const t of board.tickets) {
    if (checkCount(errors, t.key, 'effort', t.effort)) totalEffort += t.effort;
    else numbersOk = false;
    if (!checkCount(errors, t.key, 'past', t.past)) numbersOk = false;
    totalCodBound += costBound(errors, t, () => (numbersOk = false));

    for (const dep of new Set(t.dependsOn)) {
      if (dep === t.key) errors.push({ code: 'self-dependency', subject: t.key });
      else if (!ticketKeys.has(dep) && !wontDo.has(dep)) {
        errors.push({ code: 'unknown-dependency', subject: t.key, keys: [dep] });
      }
    }
  }

  // People and absences.
  for (const p of board.people) {
    if (!checkCount(errors, p.name, 'pointsPerHalfDay', p.pointsPerHalfDay)) numbersOk = false;
    for (const a of p.daysOff) {
      if (!isRealDate(a.date) || !(a.part === 'morning' || a.part === 'afternoon' || a.part === 'full')) {
        errors.push({ code: 'invalid-absence', subject: p.name, value: `${a.date} ${String(a.part)}` });
      }
    }
  }

  // Cycles (self-loops were reported above).
  for (const cycle of findCycles(board.tickets)) {
    errors.push({ code: 'dependency-cycle', subject: cycle[0] as Key, keys: cycle });
  }

  // The solver needs exact integer arithmetic; refuse boards where it could not be exact.
  if (errors.length === 0 && numbersOk && !weightsFitSafeIntegers(board.tickets.length, totalEffort, totalCodBound)) {
    errors.push({ code: 'board-too-large', subject: 'board' });
  }

  if (errors.length > 0) return { ok: false, error: errors.sort(errorOrder) };
  return { ok: true, value: board as ValidBoard };
}

/** Validates the cost fields and returns an upper bound of the ticket's cod (hunger can raise urgency to the top of the scale). */
function costBound(errors: ValidationError[], t: Ticket, markBad: () => void): number {
  if (t.cost.kind === 'imported') {
    if (!checkCount(errors, t.key, 'cod', t.cost.cod)) {
      markBad();
      return 0;
    }
    return t.cost.cod;
  }
  const { value, urgency, risk } = t.cost;
  const a = checkScale(errors, t.key, 'value', value);
  const b = checkScale(errors, t.key, 'urgency', urgency);
  const c = checkScale(errors, t.key, 'risk', risk);
  if (!(a && b && c)) {
    markBad();
    return 0;
  }
  return value + MAX_SCALE + risk;
}
