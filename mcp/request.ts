import {
  CSV_LIMITS,
  DEFAULT_FOG_SEED,
  DEFAULT_NEXT_RELEASE_WEEKS,
  DEFAULT_TIME_ZONE,
  DEFAULT_ZOMBIE_THRESHOLD,
  SAMPLE_FREEZE_AT,
  SAMPLE_NOW,
  SAMPLE_RELEASE,
  importCsv,
  sampleBoard,
  validateBoard,
} from '../src/engine/index';
import type { Board, FreezeInput, NightInput, Part, Person, ValidBoard } from '../src/engine/index';
import { bad, failure, fromCsv, fromEngine, fromValidation, good, unknownPerson } from './errors';
import type { Outcome, ToolError } from './errors';
import type { AwayEntryInput, BoardSourceInput, JsonBoardValue } from './schemas';
import { parseInstant } from './time';

/** What every tool shares: the board as loaded, and the name of the release when there is one. */
export interface LoadedBoard {
  readonly board: ValidBoard;
  readonly release: string | null;
  readonly isSample: boolean;
}

/** The request after defaults: exactly what the engine's `nightFacts` takes. */
export type RequestState = NightInput;

export interface RequestParams {
  readonly now?: string | number | undefined;
  readonly freezeAt?: string | number | undefined;
  readonly marginPct?: number | undefined;
  readonly away?: readonly AwayEntryInput[] | undefined;
}

function validated(board: Board): Outcome<ValidBoard> {
  const r = validateBoard(board);
  return r.ok ? good(r.value) : bad(...r.error.map(fromValidation));
}

function fromJson(source: JsonBoardValue): Outcome<ValidBoard> {
  if (source.tickets.length > CSV_LIMITS.tickets) {
    return bad(
      failure('board-too-large', `The board has ${source.tickets.length} tickets; the most is ${CSV_LIMITS.tickets}. Send fewer tickets.`, {
        value: source.tickets.length,
      }),
    );
  }
  if (JSON.stringify(source).length > CSV_LIMITS.bytes) {
    return bad(failure('too-large', `The board is larger than ${CSV_LIMITS.bytes} bytes.`, { value: CSV_LIMITS.bytes }));
  }
  return validated({
    tickets: source.tickets.map((t) => ({
      key: t.key,
      title: t.title,
      effort: t.effort,
      cost: t.cost,
      mustHave: t.mustHave ?? false,
      dependsOn: t.dependsOn ?? [],
      past: t.past ?? 0,
    })),
    people: source.people.map((p) => ({ name: p.name, pointsPerHalfDay: p.pointsPerHalfDay, daysOff: p.daysOff ?? [] })),
    timeZone: source.timeZone ?? DEFAULT_TIME_ZONE,
    nextReleaseWeeks: source.nextReleaseWeeks ?? DEFAULT_NEXT_RELEASE_WEEKS,
    zombieThreshold: source.zombieThreshold ?? DEFAULT_ZOMBIE_THRESHOLD,
    wontDo: source.wontDo ?? [],
    fogSeed: source.fogSeed ?? DEFAULT_FOG_SEED,
  });
}

/** Names the board: the sample, a Jira CSV (through the engine's importer, with the sample's team as the web app does), or a board object. */
export function loadBoard(source: BoardSourceInput): Outcome<LoadedBoard> {
  const sample = validated(sampleBoard());
  if (!sample.ok) return sample;
  switch (source.source) {
    case 'sample':
      return good({ board: sample.value, release: SAMPLE_RELEASE, isSample: true });
    case 'csv': {
      const base = sample.value;
      const imported = importCsv(source.text, {
        people: base.people,
        timeZone: base.timeZone,
        nextReleaseWeeks: base.nextReleaseWeeks,
        zombieThreshold: base.zombieThreshold,
      });
      return imported.ok ? good({ board: imported.value.board, release: null, isSample: false }) : bad(...imported.error.map(fromCsv));
    }
    case 'json': {
      const board = fromJson(source.board);
      return board.ok ? good({ board: board.value, release: null, isSample: false }) : board;
    }
  }
}

/** The team of a board, with the away entries applied: whole-night entries leave the team; dated ones add one absence. */
function applyAway(home: ValidBoard, entries: readonly AwayEntryInput[]): Outcome<{ readonly board: ValidBoard; readonly away: readonly string[] }> {
  const team = home.people.map((p) => p.name);
  const gone = new Set<string>();
  const added = new Map<string, { date: string; part: Part }[]>();
  for (const entry of entries) {
    if (!team.includes(entry.person)) return bad(unknownPerson(entry.person, team));
    if (entry.date === undefined) {
      if (entry.part !== undefined) {
        return bad(failure('bad-request', `${entry.person}: "part" needs a "date". Without a date the person is away for the whole night.`, { subject: entry.person }));
      }
      gone.add(entry.person);
    } else {
      const list = added.get(entry.person) ?? [];
      list.push({ date: entry.date, part: entry.part ?? 'full' });
      added.set(entry.person, list);
    }
  }
  const away = [...gone].sort();
  if (added.size === 0) return good({ board: home, away });
  const people: Person[] = home.people.map((p) => ({ ...p, daysOff: [...p.daysOff, ...(added.get(p.name) ?? [])] }));
  const board = validated({ ...home, people });
  return board.ok ? good({ board: board.value, away }) : board;
}

/** The request after defaults and checks: the board with its absences, the freeze in epoch milliseconds, and who is away. */
export function buildState(loaded: LoadedBoard, params: RequestParams): Outcome<RequestState> {
  const errors: ToolError[] = [];
  const instant = (name: 'now' | 'freezeAt', value: string | number | undefined, fallback: number): number | null => {
    if (value === undefined) {
      if (loaded.isSample) return fallback;
      errors.push(failure('bad-time', `${name} is required unless the board is the sample.`));
      return null;
    }
    const r = parseInstant(name, value);
    if (r.ok) return r.value;
    errors.push(...r.errors);
    return null;
  };
  const now = instant('now', params.now, SAMPLE_NOW);
  const freezeAt = instant('freezeAt', params.freezeAt, SAMPLE_FREEZE_AT);
  if (now !== null && freezeAt !== null && freezeAt < now) {
    errors.push(failure('bad-time', 'freezeAt is before now: the freeze must be at or after the moment of the question.'));
  }
  if (errors.length > 0 || now === null || freezeAt === null) return bad(...errors);
  const team = applyAway(loaded.board, params.away ?? []);
  if (!team.ok) return team;
  const freeze: FreezeInput = { now, freezeAt, marginPct: params.marginPct ?? 0 };
  return good({ home: team.value.board, board: team.value.board, freeze, away: team.value.away, release: loaded.release });
}

/** The board the engine solves: the full team with the people who are away taken out (as the web app does). */
export function presentBoard(state: RequestState): Outcome<ValidBoard> {
  const gone = new Set(state.away);
  return validated({ ...state.board, people: state.board.people.filter((p) => !gone.has(p.name)) });
}

/** Wraps an engine error as a list. */
export function engineErrors(e: Parameters<typeof fromEngine>[0]): Outcome<never> {
  return bad(fromEngine(e));
}
