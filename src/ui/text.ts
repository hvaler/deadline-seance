import { SCALE } from '../engine/index';
import type { CodParts, ImpossibleSolution, Reason, ValidationError } from '../engine/index';
import { CANDLE_STEPS } from './candle-steps';
import type { Totals, TombstoneView, View } from './derive';
import type { Change, Comparison, Subject } from './model';

/**
 * Every sentence the screen says. Each one is a pure function of facts: integers are put into the text exactly as the engine returned them,
 * with no arithmetic. The only transformations are wording ones: counting a list, choosing "Gain" or "Loss" from the sign of the engine's
 * `codDelta`, and showing the absolute value of a loss.
 */

// ---- small helpers -----------------------------------------------------------------------------------------------------

/** "1 ticket", "2 tickets". */
export function count(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "A", "A and B", "A, B and C". */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---- cost of delay -----------------------------------------------------------------------------------------------------

/** "value 5 + urgency 3 + risk 3 = 11", "value 3 + urgency 1 → 5 + risk 3 = 11", or "imported cost of delay 14". */
export function formulaText(cost: CodParts): string {
  if (cost.imported) return `imported cost of delay ${cost.cod}`;
  const urgency = cost.effectiveUrgency === cost.urgency ? `${cost.urgency}` : `${cost.urgency} → ${cost.effectiveUrgency}`;
  return `value ${cost.value} + urgency ${urgency} + risk ${cost.risk} = ${cost.cod}`;
}

/** "left out 3 releases", or null when the ticket has never been left out. */
export function releasesText(cost: CodParts): string | null {
  return cost.past > 0 ? `left out ${count(cost.past, 'release')}` : null;
}

// ---- why a ticket is buried --------------------------------------------------------------------------------------------

export function reasonText(reason: Reason): string {
  switch (reason.kind) {
    case 'no-room':
      return `Needs ${count(reason.needed, 'point')}, ${reason.left} left.`;
    case 'depends-on-buried': {
      const list = reason.buriedDependencies;
      return `Depends on ${listOf(list)}, which ${list.length === 1 ? 'is' : 'are'} buried.`;
    }
    case 'blocked-by-put-down':
      return `Depends on ${reason.putDownKey}, which was put down.`;
  }
}

/**
 * The epitaph: one line of mood and the cause, one fixed template per reason, built only from facts. It says nothing else: the waiting cost,
 * the releases left out and the hunger live in the detail block and the hunger line, which stay the source of truth for those numbers.
 * It is This is the single function a later spec replaces to add a
 * language model behind the number guard; the template stays as the fallback.
 */
export function epitaphFor(tombstone: TombstoneView): string {
  const reason = tombstone.reason;
  switch (reason.kind) {
    case 'no-room':
      return `Here lies ${tombstone.key}. It needed ${count(reason.needed, 'point')}; the night had ${reason.left} left.`;
    case 'depends-on-buried':
      return `Here lies ${tombstone.key}. It followed ${listOf(reason.buriedDependencies)} into the ground.`;
    case 'blocked-by-put-down':
      return `Here lies ${tombstone.key}. ${reason.putDownKey} was closed as Won't Do, so it can never ship.`;
  }
}
/** The line under a zombie's epitaph: what one more release left out does to its urgency. Null unless it is a zombie with a formula. */
export function hungerText(tombstone: TombstoneView): string | null {
  const next = tombstone.nextUrgency;
  if (!tombstone.isZombie || tombstone.cost.imported || next === null) return null;
  const now = tombstone.cost.effectiveUrgency;
  if (next === now) return `Urgency is already at the top: ${now}.`;
  return `Hungrier next release: urgency ${now} → ${next}`;
}

/** True when the epitaph already says the reason, so the "Why" row of a tombstone would only repeat it. */
export function reasonCovered(reason: Reason, epitaph: string): boolean {
  switch (reason.kind) {
    case 'no-room':
      return epitaph.includes(`${count(reason.needed, 'point')}; the night had ${reason.left} left`);
    case 'depends-on-buried':
      return reason.buriedDependencies.every((key) => epitaph.includes(key));
    case 'blocked-by-put-down':
      return epitaph.includes(reason.putDownKey);
  }
}

// ---- the title ---------------------------------------------------------------------------------------------------------

export const TAGLINE = 'Not everything gets inside before the freeze.';
// ---- the two grounds ---------------------------------------------------------------------------------------------------

/** The heading line of the safehouse: "12 tickets · 59 of 59 points · saved cod 167". */
export function safehouseSummary(totals: Totals, effectiveCapacity: number): string {
  return `${count(totals.keptCount, 'ticket')} · ${totals.keptEffort} of ${effectiveCapacity} points · saved cod ${totals.savedCod}`;
}

/** The heading line of the yard: "7 tickets · effort 129 · cod 101". */
export function yardSummary(totals: Totals): string {
  return `${count(totals.buriedCount, 'ticket')} · effort ${totals.buriedEffort} · cod ${totals.buriedCod}`;
}

export const IMPOSSIBLE_GROUND = 'Nothing can be decided until the must-haves fit.';
export const NOTHING_INSIDE = 'Nothing fits inside.';
export const NOTHING_OUTSIDE = 'Nothing is left outside.';

/** "Needs HB-104", with closed tickets marked: "Needs HB-112 (closed as Won't Do)". */
export function needsText(needs: readonly string[], closed: readonly string[]): string {
  if (needs.length === 0) return '';
  return `Needs ${listOf(needs.map((key) => (closed.includes(key) ? `${key} (closed as Won't Do)` : key)))}`;
}

export function chainedText(keys: readonly string[]): string {
  return keys.length === 0 ? '' : `Chained to ${listOf(keys)}`;
}

export function fellText(keys: readonly string[]): string {
  return keys.length === 0 ? '' : `Fell behind ${listOf(keys)}`;
}

/** "20 over 2 weeks": what waiting for the next release costs. */
export function waitingText(burialCost: number, weeks: number): string {
  return `${burialCost} over ${count(weeks, 'week')}`;
}

export function closedLine(keys: readonly string[]): string {
  return keys.length === 0 ? '' : `Closed as Won't Do: ${keys.join(', ')}`;
}

// ---- the verdict -------------------------------------------------------------------------------------------------------

/** `exhumed` names the ticket whose exhumation would need the room, for the rejected-exhume message. */
function impossibleSentences(impossible: ImpossibleSolution, exhumed?: string): string[] {
  const who = exhumed === undefined ? 'The must-haves' : `The must-haves with ${exhumed}`;
  const sentences = [
    `${who} need ${count(impossible.needed, 'point')}; there are ${impossible.capacity} (${impossible.effectiveCapacity} after the ${impossible.marginPct} % reserve).`,
  ];
  for (const blocked of impossible.blockedMustHaves) {
    sentences.push(`${blocked.key} can never ship: it depends on ${blocked.putDownKey}, which was put down.`);
  }
  sentences.push('Move the candle later, or drop a must-have.');
  return sentences;
}

/** The verdict of the current cut, as sentences. */
export function verdictSentences(view: View): string[] {
  const solution = view.solution;
  if (solution.status === 'impossible') return impossibleSentences(solution);
  const t = view.totals;
  if (t === null) return [];
  const sentences = [
    `Inside the safehouse: ${count(t.keptCount, 'ticket')}, ${t.keptEffort} of ${solution.effectiveCapacity} points, saved cod ${t.savedCod}. ` +
      `Left outside: ${count(t.buriedCount, 'ticket')}, cod ${t.buriedCod}.`,
  ];
  if (solution.marginPct > 0) sentences.push(`Capacity ${solution.capacity}, ${solution.marginPct} % reserve.`);
  return sentences;
}

export interface Figure {
  /** Which colour the painted number takes. */
  readonly tone: 'time' | 'available' | 'inside' | 'outside' | 'needed';
  readonly value: string;
  readonly label: string;
}

/** The painted headline of the sign: freeze time, points available, points inside, tickets outside (or points needed when impossible). */
export function verdictFigures(view: View): Figure[] {
  const solution = view.solution;
  const time: Figure = { tone: 'time', value: view.candle.label, label: 'freeze' };
  if (solution.status === 'impossible') {
    return [
      time,
      { tone: 'available', value: String(solution.effectiveCapacity), label: 'points available' },
      { tone: 'needed', value: String(solution.needed), label: 'points needed' },
    ];
  }
  const t = view.totals;
  if (t === null) return [time];
  return [
    time,
    { tone: 'available', value: String(solution.effectiveCapacity), label: 'points available' },
    { tone: 'inside', value: String(t.keptEffort), label: 'points inside' },
    { tone: 'outside', value: String(t.buriedCount), label: t.buriedCount === 1 ? 'ticket outside' : 'tickets outside' },
  ];
}

// ---- the change note ---------------------------------------------------------------------------------------------------

export interface ChangeNote {
  readonly kind: Change['kind'];
  /** What was done, in one short sentence. */
  readonly headline: string;
  /** The facts about it, one sentence each. */
  readonly lines: readonly string[];
  /** True when the user tried something and it did not happen: shown as an alert. */
  readonly alert: boolean;
}

function headlineOf(subject: Subject): string {
  switch (subject.kind) {
    case 'candle':
      return `Candle moved to ${CANDLE_STEPS[subject.to]?.label ?? ''}.`;
    case 'reserve':
      return `Reserve set to ${subject.to} %.`;
    case 'survivor':
      return subject.away ? `${subject.name} sent away.` : `${subject.name} is back.`;
    case 'exhume':
      return `${subject.key} exhumed.`;
    case 'resurrect':
      return `${subject.key} resurrected.`;
    case 'put-down':
      return `${subject.key} closed as Won't Do.`;
    case 'reset':
      return 'Back to the sample board.';
  }
}

function entriesText(label: string, entries: readonly { key: string; cod: number }[], total: number): string {
  const each = entries.map((e) => `${e.key} (${e.cod})`).join(', ');
  return entries.length === 1 ? `${label}: ${each}.` : `${label}: ${each}; together ${total}.`;
}

function comparisonLines(subject: Subject, comparison: Comparison): string[] {
  switch (comparison.kind) {
    case 'diff': {
      const { diff, before, after } = comparison;
      const lines: string[] = [];

      if (subject.kind === 'put-down') {
        const blocked = after.buried
          .filter((b) => b.reason.kind === 'blocked-by-put-down' && b.reason.putDownKey === subject.key)
          .map((b) => b.key);
        if (blocked.length > 0) lines.push(`${listOf(blocked)} can never ship.`);
        if (diff.raised.length === 0 && diff.sunk.length === 0) {
          lines.push('No change in the cut.');
          return lines;
        }
      }

      if (diff.raised.length === 0 && diff.sunk.length === 0) lines.push('Nothing rises and nothing sinks.');
      if (diff.raised.length > 0) lines.push(entriesText('Rises', diff.raised, diff.raisedCod));
      if (diff.sunk.length > 0) lines.push(entriesText('Sinks', diff.sunk, diff.sunkCod));
      if (diff.codDelta > 0) lines.push(`Gain: ${diff.codDelta}.`);
      else if (diff.codDelta < 0) lines.push(`Loss: ${Math.abs(diff.codDelta)}.`);
      else lines.push('No change in saved cod.');
      lines.push(`Saved cod ${before.savedCod} → ${after.savedCod}.`);
      return lines;
    }
    case 'not-comparable': {
      const side = comparison.after.status === 'impossible' ? comparison.after : comparison.before;
      if (side.status !== 'impossible') return [];
      return [`No comparison: the freeze is impossible (needs ${count(side.needed, 'point')}; ${side.effectiveCapacity} available).`];
    }
    case 'no-diff':
      return [
        `Saved cod ${comparison.before.savedCod} → ${comparison.after.savedCod}.`,
        'The board changed, so there is no ticket-by-ticket comparison.',
      ];
  }
}

function refusedLine(subject: Subject, code: string): string {
  const key = 'key' in subject ? subject.key : '';
  switch (code) {
    case 'unknown-key':
      return `${key} is not on the board.`;
    case 'not-a-zombie':
      return `${key} is not a zombie, so it cannot be put down.`;
    case 'solution-impossible':
      return 'The freeze is impossible, so there is no cut to change.';
    default:
      return `The engine refused: ${code}.`;
  }
}

/** The change note for the last action. */
export function changeNote(change: Change): ChangeNote {
  switch (change.kind) {
    case 'none':
      return { kind: 'none', headline: 'Nothing has moved yet.', lines: [], alert: false };
    case 'done':
      return { kind: 'done', headline: headlineOf(change.subject), lines: comparisonLines(change.subject, change.comparison), alert: false };
    case 'rejected': {
      const key = 'key' in change.subject ? change.subject.key : '';
      return { kind: 'rejected', headline: `${key} stays in the ground.`, lines: impossibleSentences(change.impossible, key), alert: true };
    }
    case 'refused':
      return {
        kind: 'refused',
        headline: 'Nothing was done.',
        lines: [refusedLine(change.subject, change.error.code)],
        alert: true,
      };
  }
}

/** The change note as one sentence, for the spoken announcement. */
export function noteSentence(note: ChangeNote): string {
  return [note.headline, ...note.lines].join(' ');
}

/** What a screen reader hears after a change: the change, then the verdict. */
export function announcementText(change: Change, view: View): string {
  return [noteSentence(changeNote(change)), ...verdictSentences(view)].join(' ');
}

// ---- boards that fail validation ---------------------------------------------------------------------------------------

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
