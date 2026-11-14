import { blockedBy } from './chain';
import { codParts, effectiveUrgency } from './cod';
import type { CodParts } from './cod';
import { FOG_MAX_PCT, FOG_MIN_PCT, simulateFog } from './fog';
import { compareKeys } from './keys';
import { solveFreeze } from './solver';
import { err, ok } from './types';
import type { FreezeInput, Key, Result, SolvedSolution, Ticket, ValidBoard } from './types';

/**
 * The facts of one night: every number and name a stakeholder note may say, computed here and nowhere else. The note (`certificate.ts`), the
 * epitaphs and a later model only read them. Pure: no clock (the "as of" is `freeze.now`), no DOM, no randomness.
 */

export interface NightInput {
  /** The board as loaded: it tells which must-haves were exhumed, and the titles of put-down tickets. */
  readonly home: ValidBoard;
  /** The full team, with the exhumes and put-downs applied. */
  readonly board: ValidBoard;
  readonly freeze: FreezeInput;
  /** Names of the people sent away. */
  readonly away: readonly string[];
  /** The board has no name field, so the caller says what the release is called. */
  readonly release: string | null;
}

/** A local time in the board's zone: `Fri`, `2026-11-20`, `18:00`. */
export interface LocalStamp {
  readonly weekday: string;
  readonly date: string;
  readonly time: string;
}

export type OutsideReason =
  | { readonly kind: 'no-room'; readonly needed: number; readonly left: number }
  | { readonly kind: 'depends-on-buried'; readonly buriedDependencies: readonly Key[] }
  | { readonly kind: 'blocked-by-put-down'; readonly putDownKey: Key }
  | {
      readonly kind: 'pushed-out-by-exhume';
      /** The exhumed tickets that did it. With `together: false` each of them alone is enough; with `together: true` none is, and they did it as a group. */
      readonly exhumed: readonly Key[];
      readonly together: boolean;
      readonly needed: number;
      readonly left: number;
    };

export interface OutsideFact {
  readonly key: Key;
  readonly title: string;
  readonly effort: number;
  readonly cod: number;
  readonly costParts: CodParts;
  /** `cod x weeks`: the solver's own burial cost. */
  readonly waitingCost: number;
  readonly isZombie: boolean;
  /** The urgency after one more release left out; null for an imported cost. */
  readonly nextUrgency: number | null;
  readonly reason: OutsideReason;
}

export interface PushedOut {
  readonly key: Key;
  readonly cod: number;
  /** True when this exhume alone was not enough: the ticket went out because of this one and the others in `with`. */
  readonly together: boolean;
  /** The other exhumed tickets named with this one for the same ticket. */
  readonly with: readonly Key[];
}

interface NightBase {
  readonly release: string | null;
  readonly zone: string;
  readonly asOf: LocalStamp;
  readonly freeze: LocalStamp;
  readonly capacity: number;
  readonly reservePct: number;
  readonly effectiveCapacity: number;
  /** Every key of the board and of the put-down list, for the guard. */
  readonly keys: readonly Key[];
}

export interface SolvedNight extends NightBase {
  readonly status: 'ok';
  readonly weeks: number;
  readonly kept: { readonly count: number; readonly effort: number; readonly cod: number };
  readonly fog: { readonly nights: number; readonly holds: number; readonly pct: number; readonly minPct: number; readonly maxPct: number; readonly capacity: number };
  /** Waiting cost, highest first, then by key. */
  readonly outside: readonly OutsideFact[];
  readonly outsideTotals: { readonly count: number; readonly effort: number; readonly cod: number; readonly waitingCost: number };
  /** A ticket is a zombie when leaving it out again makes this many releases in a row. The Zombies section is `outside` filtered by `isZombie`. */
  readonly zombieThreshold: number;
  readonly putDown: readonly { readonly key: Key; readonly title: string | null; readonly blocks: readonly Key[] }[];
  readonly away: readonly string[];
  readonly exhumed: readonly {
    readonly key: Key;
    readonly title: string;
    readonly effort: number;
    readonly cod: number;
    readonly pushedOut: readonly PushedOut[];
  }[];
}

export interface ImpossibleNight extends NightBase {
  readonly status: 'impossible';
  /** Points the must-haves need, with their dependencies. */
  readonly needed: number;
  readonly blockedMustHaves: readonly { readonly key: Key; readonly putDownKey: Key }[];
  readonly away: readonly string[];
}

export type NightFacts = SolvedNight | ImpossibleNight;

// ---- local time ----------------------------------------------------------------------------------------------------------

function stampOf(ms: number, zone: string): LocalStamp {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of format.formatToParts(ms)) parts[part.type] = part.value;
  const pad = (text: string | undefined, width: number): string => (text ?? '').padStart(width, '0');
  const hour = pad(parts.hour, 2) === '24' ? '00' : pad(parts.hour, 2);
  return {
    weekday: parts.weekday ?? '',
    date: `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`,
    time: `${hour}:${pad(parts.minute, 2)}`,
  };
}

// ---- the night -------------------------------------------------------------------------------------------------------------

/** The same board with some must-have flags changed. No key, number or dependency changes, so it stays valid (as in `exhume`). */
function withMustHave(board: ValidBoard, flags: ReadonlyMap<Key, boolean>): ValidBoard {
  return { ...board, tickets: board.tickets.map((t) => (flags.has(t.key) ? { ...t, mustHave: flags.get(t.key) as boolean } : t)) } as ValidBoard;
}

function keptOf(board: ValidBoard, freeze: FreezeInput): Set<Key> | null {
  const solved = solveFreeze(board, freeze);
  if (!solved.ok || solved.value.status !== 'ok') return null;
  return new Set(solved.value.kept);
}

/** The exhumed tickets and, for every ticket the solver left out for lack of room, whether the exhumes pushed it out and which of them did. */
function pushedOutBy(
  present: ValidBoard,
  home: ValidBoard,
  freeze: FreezeInput,
  solution: SolvedSolution,
  exhumed: readonly Key[],
): ReadonlyMap<Key, { readonly exhumed: readonly Key[]; readonly together: boolean }> {
  const out = new Map<Key, { readonly exhumed: readonly Key[]; readonly together: boolean }>();
  if (exhumed.length === 0) return out;
  const homeFlag = new Map<Key, boolean>(home.tickets.map((t) => [t.key, t.mustHave] as const));
  const flagsOf = (keys: readonly Key[], asHome: boolean): ReadonlyMap<Key, boolean> =>
    new Map(keys.map((k) => [k, asHome ? (homeFlag.get(k) as boolean) : true] as const));

  const candidates = solution.buried.filter((b) => b.reason.kind === 'no-room').map((b) => b.key);
  if (candidates.length === 0) return out;
  // Every exhume undone: what the night would keep without any decision.
  const without = keptOf(withMustHave(present, flagsOf(exhumed, true)), freeze);
  if (without === null) return out;
  const pushed = candidates.filter((k) => without.has(k));
  if (pushed.length === 0) return out;

  // Each exhume alone (the others undone), and each exhume undone alone (the others kept).
  const alone = new Map<Key, Set<Key> | null>();
  const undone = new Map<Key, Set<Key> | null>();
  for (const e of exhumed) {
    alone.set(e, keptOf(withMustHave(present, flagsOf(exhumed.filter((k) => k !== e), true)), freeze));
    undone.set(e, keptOf(withMustHave(present, flagsOf([e], true)), freeze));
  }
  for (const key of pushed) {
    const sufficient = exhumed.filter((e) => {
      const kept = alone.get(e);
      return kept !== null && kept !== undefined && !kept.has(key);
    });
    if (sufficient.length > 0) {
      out.set(key, { exhumed: sufficient, together: false });
      continue;
    }
    const necessary = exhumed.filter((e) => undone.get(e)?.has(key) === true);
    out.set(key, { exhumed: necessary.length > 0 ? necessary : [...exhumed], together: true });
  }
  return out;
}

/**
 * The facts of the night the user is looking at. An unknown name in `away` is an error; an impossible freeze is a result (`status: 'impossible'`).
 */
export function nightFacts(input: NightInput): Result<NightFacts> {
  const { home, board, freeze } = input;
  const team = new Set(board.people.map((p) => p.name));
  for (const name of input.away) if (!team.has(name)) return err({ code: 'unknown-key', key: name });
  const away = [...new Set(input.away)].sort(compareKeys);
  const gone = new Set(away);
  // Removing people cannot make a valid board invalid.
  const present = { ...board, people: board.people.filter((p) => !gone.has(p.name)) } as ValidBoard;

  const solved = solveFreeze(present, freeze);
  if (!solved.ok) return solved;
  const solution = solved.value;
  const zone = board.timeZone;
  const keys = [...new Set([...board.tickets.map((t) => t.key), ...board.wontDo])].sort(compareKeys);
  const base: NightBase = {
    release: input.release,
    zone,
    asOf: stampOf(freeze.now, zone),
    freeze: stampOf(freeze.freezeAt, zone),
    capacity: solution.capacity,
    reservePct: solution.marginPct,
    effectiveCapacity: solution.effectiveCapacity,
    keys,
  };

  if (solution.status === 'impossible') {
    const blocked = [...solution.blockedMustHaves].sort((a, b) => compareKeys(a.key, b.key));
    return ok({ ...base, status: 'impossible', needed: solution.needed, blockedMustHaves: blocked, away });
  }

  const fog = simulateFog(present, solution.kept, solution.capacity);
  if (!fog.ok) return fog;

  const byKey = new Map<Key, Ticket>(present.tickets.map((t) => [t.key, t] as const));
  const homeByKey = new Map<Key, Ticket>(home.tickets.map((t) => [t.key, t] as const));
  const exhumedKeys = present.tickets
    .filter((t) => t.mustHave && homeByKey.get(t.key)?.mustHave === false)
    .map((t) => t.key)
    .sort(compareKeys);
  const pushed = pushedOutBy(present, home, freeze, solution, exhumedKeys);

  const outside: OutsideFact[] = solution.buried.map((b) => {
    const ticket = byKey.get(b.key) as Ticket;
    const r = b.reason;
    let reason: OutsideReason;
    if (r.kind === 'blocked-by-put-down') reason = { kind: 'blocked-by-put-down', putDownKey: r.putDownKey };
    else if (r.kind === 'depends-on-buried') reason = { kind: 'depends-on-buried', buriedDependencies: [...r.buriedDependencies] };
    else {
      const p = pushed.get(b.key);
      reason =
        p === undefined
          ? { kind: 'no-room', needed: r.needed, left: r.left }
          : { kind: 'pushed-out-by-exhume', exhumed: [...p.exhumed].sort(compareKeys), together: p.together, needed: r.needed, left: r.left };
    }
    return {
      key: b.key,
      title: ticket.title,
      effort: ticket.effort,
      cod: b.cod,
      costParts: codParts(ticket),
      waitingCost: b.burialCost,
      isZombie: b.isZombie,
      nextUrgency: ticket.cost.kind === 'imported' ? null : effectiveUrgency(ticket.cost.urgency, ticket.past + 1),
      reason,
    };
  });
  outside.sort((a, b) => b.waitingCost - a.waitingCost || compareKeys(a.key, b.key));

  const putDown = [...board.wontDo].sort(compareKeys).map((key) => ({
    key,
    title: homeByKey.get(key)?.title ?? null,
    blocks: [...blockedBy(present.tickets, [key]).keys()].sort(compareKeys),
  }));

  const exhumedFacts = exhumedKeys.map((key) => {
    const ticket = byKey.get(key) as Ticket;
    const pushedOut: PushedOut[] = [];
    for (const o of outside) {
      if (o.reason.kind !== 'pushed-out-by-exhume' || !o.reason.exhumed.includes(key)) continue;
      pushedOut.push({ key: o.key, cod: o.cod, together: o.reason.together, with: o.reason.exhumed.filter((k) => k !== key) });
    }
    pushedOut.sort((a, b) => compareKeys(a.key, b.key));
    const parts = codParts(ticket);
    return { key, title: ticket.title, effort: ticket.effort, cod: parts.cod, pushedOut };
  });

  return ok({
    ...base,
    status: 'ok',
    weeks: board.nextReleaseWeeks,
    kept: { count: solution.kept.length, effort: solution.keptEffort, cod: solution.savedCod },
    fog: {
      nights: fog.value.nights,
      holds: fog.value.holds,
      pct: fog.value.pct,
      minPct: FOG_MIN_PCT,
      maxPct: FOG_MAX_PCT,
      capacity: solution.capacity,
    },
    outside,
    outsideTotals: {
      count: solution.buried.length,
      effort: solution.buriedEffort,
      cod: solution.buriedCod,
      waitingCost: outside.reduce((sum, o) => sum + o.waitingCost, 0),
    },
    zombieThreshold: board.zombieThreshold,
    putDown,
    away,
    exhumed: exhumedFacts,
  });
}
