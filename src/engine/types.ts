// Data model of the rule engine. Every quantity is a safe integer. No prose: the UI formats the facts.

export type Key = string;
export type Part = 'morning' | 'afternoon' | 'full';

/** A local calendar date 'YYYY-MM-DD' in the board time zone, and the part of the day the person is away. */
export interface Absence {
  readonly date: string;
  readonly part: Part;
}

export interface Person {
  readonly name: string;
  readonly pointsPerHalfDay: number;
  readonly daysOff: readonly Absence[];
}

export type Cost =
  | { readonly kind: 'formula'; readonly value: number; readonly urgency: number; readonly risk: number }
  | { readonly kind: 'imported'; readonly cod: number };

export interface Ticket {
  readonly key: Key;
  readonly title: string;
  /** Points left, integer >= 0. */
  readonly effort: number;
  readonly cost: Cost;
  readonly mustHave: boolean;
  readonly dependsOn: readonly Key[];
  /** Releases in a row the ticket has been left out, integer >= 0. */
  readonly past: number;
}

export interface Board {
  readonly tickets: readonly Ticket[];
  readonly people: readonly Person[];
  /** IANA time zone name. */
  readonly timeZone: string;
  /** Integer >= 0. */
  readonly nextReleaseWeeks: number;
  /** Integer >= 1. */
  readonly zombieThreshold: number;
  /** Keys of tickets that were put down (closed as Won't Do). Their dependents can never be kept. */
  readonly wontDo: readonly Key[];
  /** Seed of the fog of estimates: an integer from 0 to 4 294 967 295. The same board and seed give the same chance everywhere. */
  readonly fogSeed: number;
}

declare const validBoardBrand: unique symbol;

/** A board that passed `validateBoard`. Only the engine creates one. */
export type ValidBoard = Board & { readonly [validBoardBrand]: true };

/** Epoch milliseconds (integers) and the margin in percent. */
export interface FreezeInput {
  readonly now: number;
  readonly freezeAt: number;
  readonly marginPct: number;
}

export type Reason =
  | { readonly kind: 'depends-on-buried'; readonly buriedDependencies: readonly Key[] }
  | { readonly kind: 'blocked-by-put-down'; readonly putDownKey: Key }
  | { readonly kind: 'no-room'; readonly needed: number; readonly left: number };

export interface Buried {
  readonly key: Key;
  readonly reason: Reason;
  readonly cod: number;
  /** cod x nextReleaseWeeks. */
  readonly burialCost: number;
  readonly isZombie: boolean;
}

export interface SolvedSolution {
  readonly status: 'ok';
  readonly capacity: number;
  readonly effectiveCapacity: number;
  readonly marginPct: number;
  readonly kept: readonly Key[];
  readonly buried: readonly Buried[];
  readonly keptEffort: number;
  readonly savedCod: number;
  /** Sum of `effort` over the buried tickets: `keptEffort + buriedEffort` is the total effort of the board. */
  readonly buriedEffort: number;
  /** Sum of `cod` over the buried tickets: `savedCod + buriedCod` is the total cod of the board. */
  readonly buriedCod: number;
  readonly zombies: readonly Key[];
}

export interface ImpossibleSolution {
  readonly status: 'impossible';
  readonly capacity: number;
  readonly effectiveCapacity: number;
  readonly marginPct: number;
  /** Effort of the must-haves with their dependencies. */
  readonly needed: number;
  readonly blockedMustHaves: readonly { readonly key: Key; readonly putDownKey: Key }[];
}

export type Solution = SolvedSolution | ImpossibleSolution;

export interface DiffEntry {
  readonly key: Key;
  readonly cod: number;
}

export interface Diff {
  readonly raised: readonly DiffEntry[];
  readonly sunk: readonly DiffEntry[];
  /** Sum of `cod` over `raised`. */
  readonly raisedCod: number;
  /** Sum of `cod` over `sunk`. `raisedCod - sunkCod` equals `codDelta` when the costs did not change. */
  readonly sunkCod: number;
  readonly codDelta: number;
}

/** Errors for invalid arguments at call time. A freeze that cannot be met is not an error: see ImpossibleSolution. */
export type EngineErrorCode =
  | 'margin-invalid'
  | 'range-too-long'
  | 'invalid-time-zone'
  | 'unknown-key'
  | 'not-a-zombie'
  | 'not-integer'
  | 'solution-impossible'
  | 'oracle-too-large';

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly key?: Key;
  readonly value?: number | string;
}

export type ValidationErrorCode =
  | 'duplicate-key'
  | 'unknown-dependency'
  | 'self-dependency'
  | 'dependency-cycle'
  | 'not-integer'
  | 'negative-number'
  | 'urgency-off-scale'
  | 'invalid-time-zone'
  | 'invalid-threshold'
  | 'wont-do-key-in-tickets'
  | 'seed-out-of-range'
  | 'invalid-absence'
  | 'board-too-large';

export interface ValidationError {
  readonly code: ValidationErrorCode;
  /** Ticket key, person name or other subject of the error. */
  readonly subject?: string;
  /** For `dependency-cycle`: the keys in the cycle, starting at the smallest. For `unknown-dependency`: the missing key. */
  readonly keys?: readonly Key[];
  /** Which field of the subject is wrong (for example 'effort', 'urgency', 'pointsPerHalfDay'). */
  readonly field?: string;
  /** The offending value, when there is one. */
  readonly value?: number | string;
}

export type Result<T, E = EngineError> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Cost-of-delay scale. Also used for value and risk. */
export const SCALE = [1, 2, 3, 5, 8, 13, 20] as const;

export const DEFAULT_TIME_ZONE = 'Europe/Madrid';
export const DEFAULT_NEXT_RELEASE_WEEKS = 2;
export const DEFAULT_ZOMBIE_THRESHOLD = 3;
/** For callers that import a board from data with no seed (CSV, MCP). The engine itself never applies it. */
export const DEFAULT_FOG_SEED = 0;
/** The largest ogSeed: an unsigned 32-bit integer. */
export const MAX_FOG_SEED = 4_294_967_295;
