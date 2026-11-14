import { hashFinish, hashStart, hashStep } from './hash';
import { compareKeys } from './keys';
import { solveFreeze } from './solver';
import { err, ok } from './types';
import type { EngineError, Key, Result, ValidBoard } from './types';

/**
 * The fog of estimates: how often the kept work still fits the team when estimates are wrong. Pure and integer-only: no clock, no
 * randomness, no floating point in any decision. See `docs/rule.md` and `.kiro/specs/fog`.
 */

/** Nights simulated for every chance. */
export const FOG_NIGHTS = 1000;
/** A ticket's estimate turns into between these percentages of itself (inclusive), each night. */
export const FOG_MIN_PCT = 80;
export const FOG_MAX_PCT = 150;

const FACTORS = FOG_MAX_PCT - FOG_MIN_PCT + 1; // 71

/** The state after the words of a key: one word per UTF-16 code unit. Does not depend on the night. */
function keyState(seed: number, key: Key): number {
  let state = hashStart(seed);
  for (let i = 0; i < key.length; i++) state = hashStep(state, key.charCodeAt(i));
  return state;
}

/** The factor of a night, from the state after the key words (`words` = the key length). */
function factorOf(state: number, keyLength: number, night: number): number {
  const h = hashFinish(hashStep(state, night), keyLength + 1);
  return FOG_MIN_PCT + (h % FACTORS);
}

/**
 * The percentage (80 to 150) a ticket's estimate becomes on a night: `80 + MurmurHash3(seed; key code units, night) mod 71`. It depends on the
 * seed, the key and the night and on nothing else, which is what makes the random numbers common to every ticket set.
 */
export function fogFactor(seed: number, key: Key, night: number): number {
  return factorOf(keyState(seed, key), key.length, night);
}

// ---- the simulation -----------------------------------------------------------------------------------------------------

export interface FogResult {
  readonly nights: number;
  /** Nights in which the kept work fitted the capacity. */
  readonly holds: number;
  /** `floor(100 x holds / nights)`: it can be 0 while `holds` is above 0. */
  readonly pct: number;
}

/**
 * What every ticket takes on every night: `data[row * nights + night] = ceil(effort x f / 100)`, tickets in key order. Opaque to callers: make
 * one with `fogTable` and read it with `fogFromTable`.
 */
export interface FogTable {
  readonly seed: number;
  readonly nights: number;
  /** Row of each key. */
  readonly rows: ReadonlyMap<Key, number>;
  readonly data: Float64Array;
}

interface Sized {
  readonly key: Key;
  readonly effort: number;
}

function buildTable(seed: number, tickets: readonly Sized[]): FogTable {
  const sorted = [...tickets].sort((a, b) => compareKeys(a.key, b.key));
  const data = new Float64Array(sorted.length * FOG_NIGHTS);
  const rows = new Map<Key, number>();
  sorted.forEach((ticket, row) => {
    rows.set(ticket.key, row);
    const state = keyState(seed, ticket.key);
    const base = row * FOG_NIGHTS;
    for (let night = 0; night < FOG_NIGHTS; night++) {
      const f = factorOf(state, ticket.key.length, night);
      data[base + night] = Math.floor((ticket.effort * f + 99) / 100); // ceil(effort x f / 100) in integers
    }
  });
  return { seed, nights: FOG_NIGHTS, rows, data };
}

/** The table of every ticket of the board. Hashes once; reading it costs only additions. */
export function fogTable(board: ValidBoard): FogTable {
  return buildTable(board.fogSeed, board.tickets);
}

function badCapacity(capacity: number): EngineError {
  return { code: 'not-integer', value: Number.isFinite(capacity) ? capacity : String(capacity) };
}

/** The chance that the kept tickets (a set: a repeated key counts once) fit `capacity`, read from a table. */
export function fogFromTable(table: FogTable, kept: readonly Key[], capacity: number): Result<FogResult> {
  if (!Number.isSafeInteger(capacity) || capacity < 0) return err(badCapacity(capacity));
  const chosen = [...new Set(kept)].sort(compareKeys);
  const rows: number[] = [];
  for (const key of chosen) {
    const row = table.rows.get(key);
    if (row === undefined) return err({ code: 'unknown-key', key });
    rows.push(row);
  }
  const { nights, data } = table;
  const sums = new Float64Array(nights); // one array per call, nothing allocated per night
  for (const row of rows) {
    const base = row * nights;
    for (let night = 0; night < nights; night++) sums[night] = (sums[night] as number) + (data[base + night] as number);
  }
  let holds = 0;
  for (let night = 0; night < nights; night++) if ((sums[night] as number) <= capacity) holds++;
  return ok({ nights, holds, pct: Math.floor((100 * holds) / nights) });
}

/**
 * The chance for a kept set, by the simplest route: a table of just the kept tickets, then the read. The curve and the screen use one shared
 * table instead; a test checks that both give the same answer.
 */
export function simulateFog(board: ValidBoard, kept: readonly Key[], capacity: number): Result<FogResult> {
  const sizes = new Map(board.tickets.map((t) => [t.key, t.effort] as const));
  const chosen = [...new Set(kept)].sort(compareKeys);
  const tickets: Sized[] = [];
  for (const key of chosen) {
    const effort = sizes.get(key);
    if (effort === undefined) return err({ code: 'unknown-key', key });
    tickets.push({ key, effort });
  }
  return fogFromTable(buildTable(board.fogSeed, tickets), chosen, capacity);
}

// ---- the curve ----------------------------------------------------------------------------------------------------------

/** The reserves the screen offers: 0, 5, ..., 30 percent. */
export const FOG_RESERVE_STEPS: readonly number[] = [0, 5, 10, 15, 20, 25, 30];

export interface FogPointOk {
  readonly status: 'ok';
  readonly marginPct: number;
  /** The full capacity: the chance is measured against it, not against the capacity after the reserve. */
  readonly capacity: number;
  readonly effectiveCapacity: number;
  readonly keptCount: number;
  readonly keptEffort: number;
  readonly fog: FogResult;
}

export interface FogPointImpossible {
  readonly status: 'impossible';
  readonly marginPct: number;
  readonly capacity: number;
  readonly effectiveCapacity: number;
  /** Effort of the must-haves with their dependencies. */
  readonly needed: number;
  readonly fog: null;
}

export type FogPoint = FogPointOk | FogPointImpossible;

/** The chance at each reserve step: solve with that reserve, then simulate the kept set against the full capacity. */
export function fogCurve(board: ValidBoard, when: { readonly now: number; readonly freezeAt: number }, table?: FogTable): Result<readonly FogPoint[]> {
  const shared = table ?? fogTable(board);
  const points: FogPoint[] = [];
  for (const marginPct of FOG_RESERVE_STEPS) {
    const solved = solveFreeze(board, { now: when.now, freezeAt: when.freezeAt, marginPct });
    if (!solved.ok) return solved;
    const solution = solved.value;
    if (solution.status === 'impossible') {
      points.push({
        status: 'impossible',
        marginPct,
        capacity: solution.capacity,
        effectiveCapacity: solution.effectiveCapacity,
        needed: solution.needed,
        fog: null,
      });
      continue;
    }
    const fog = fogFromTable(shared, solution.kept, solution.capacity);
    if (!fog.ok) return fog;
    points.push({
      status: 'ok',
      marginPct,
      capacity: solution.capacity,
      effectiveCapacity: solution.effectiveCapacity,
      keptCount: solution.kept.length,
      keptEffort: solution.keptEffort,
      fog: fog.value,
    });
  }
  return ok(points);
}
