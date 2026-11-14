import { FOG_MAX_PCT, FOG_MIN_PCT, MAX_FOG_SEED, SCALE } from '../engine/index';
import type { CodParts, CsvError, FogPoint, FogPointImpossible, FogPointOk, ImpossibleSolution, Reason, ValidationError } from '../engine/index';
import { CANDLE_STEPS } from './candle-steps';
import type { Totals, TombstoneView, View } from './derive';
import type { AppState, Change, Comparison, Subject } from './model';

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

/** An integer with a comma between thousands: 1000 → "1,000". Formatting only. */
export function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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

// ---- the fog of estimates ----------------------------------------------------------------------------------------------

export interface FogHeadline {
  readonly lead: string;
  /** The painted figure: the floored percentage, as the engine returned it. */
  readonly figure: string;
  readonly tail: string;
}

/** "Holds in" + "20 %" + "of 1,000 nights": the figure is `pct`, the nights are `FOG_NIGHTS`. */
export function fogHeadline(point: FogPointOk): FogHeadline {
  return { lead: 'Holds in', figure: `${point.fog.pct} %`, tail: `of ${thousands(point.fog.nights)} nights` };
}

/**
 * The numbers behind the figure. The percentage is floored, so it can read 0 % while some nights hold: the sentence always ends with the raw
 * count. "The team has" is the full capacity (the chance is measured against it, not against what is left after the reserve).
 */
export function fogSentence(point: FogPointOk): string {
  return (
    `Inside needs ${count(point.keptEffort, 'point')} on paper; the team has ${point.capacity}; ` +
    `estimates land between ${FOG_MIN_PCT} % and ${FOG_MAX_PCT} %. It held on ${thousands(point.fog.holds)} of ${thousands(point.fog.nights)} nights.`
  );
}

/** The headline when there is no cut to test. */
export const FOG_NO_CUT = 'No cut to test';

export function fogImpossibleSentence(point: FogPointImpossible): string {
  return `${FOG_NO_CUT}: the must-haves need ${count(point.needed, 'point')}; ${point.effectiveCapacity} are available after the ${point.marginPct} % reserve.`;
}

/** What a screen reader reads for one item of the strip: "5 % reserve (current): holds in 0 % of 1,000 nights (6 nights)". */
export function stripItemText(point: FogPoint, isCurrent: boolean): string {
  const lead = `${point.marginPct} % reserve${isCurrent ? ' (current)' : ''}`;
  if (point.status === 'impossible') return `${lead}: impossible freeze`;
  const { pct, nights, holds } = point.fog;
  return `${lead}: holds in ${pct} % of ${thousands(nights)} nights (${thousands(holds)} ${holds === 1 ? 'night' : 'nights'})`;
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
      return subject.yours === true ? 'Back to your tickets.' : 'Back to the sample board.';
    case 'sample':
      return 'Back to the sample board.';
    case 'load':
      return `Loaded your tickets from ${subject.name}.`;
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
    case 'new-board': {
      // A different board was loaded: nothing to compare with, even where some keys are the same.
      if (subject.kind !== 'load') return [];
      const lines = [`The file has ${count(subject.count, 'open ticket')}.`];
      if (subject.skipped > 0) lines.push(`Skipped ${count(subject.skipped, 'closed issue')}.`);
      return lines;
    }
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
    case 'seed-out-of-range':
      return `The fog seed must be a whole number from 0 to ${thousands(MAX_FOG_SEED)} (got ${valueOf(e)}).`;
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

// ---- your tickets (the CSV import) -------------------------------------------------------------------------------------------

/** What the sign shows in the place of the sentence while the chance is being worked out (plan B of the fog). */
export const FOG_UPDATING = 'updating';

/** "Row 7, column E (Story Points)", "Row 7", or "The file". */
function placeOf(e: CsvError): string {
  if (e.row === null) return 'The file';
  if (e.column === null) return `Row ${e.row}`;
  return `Row ${e.row}, column ${e.column.letter} (${e.column.header})`;
}

/** A cell's text, short enough for a sentence. */
function quoted(value: string | undefined): string {
  return `"${value ?? ''}"`;
}

/** One plain sentence for an error of the CSV import, made only of the error's own row, column, value, keys and limit. */
export function describeCsvError(e: CsvError): string {
  const place = placeOf(e);
  const key = e.keys?.[0] ?? '';
  switch (e.code) {
    case 'empty-file':
      return 'The file: it is empty.';
    case 'no-tickets':
      return 'The file: it has no tickets to import.';
    case 'unterminated-quote':
      return `Row ${e.row ?? 0}: a quote is opened and never closed.`;
    case 'missing-column':
      return `The file: the column ${e.value ?? ''} is missing.`;
    case 'duplicate-column':
      return `${place}: this column is also in column ${e.value ?? ''}; keep only one.`;
    case 'missing-value':
      return `${place}: this cell is empty.`;
    case 'bad-key':
      return `${place}: ${quoted(e.value)} cannot be a key (no spaces, commas or semicolons, at most ${e.limit ?? 0} characters).`;
    case 'too-long':
      return `${place}: the text is longer than ${e.limit ?? 0} characters.`;
    case 'not-integer':
      return `${place}: must be a whole number (got ${quoted(e.value)}).`;
    case 'negative-number':
      return `${place}: cannot be negative (got ${quoted(e.value)}).`;
    case 'off-scale':
      return `${place}: must be ${listOf(SCALE.map(String)).replace(' and ', ' or ')} (got ${quoted(e.value)}).`;
    case 'cost-incomplete':
      return `${place}: ${e.value ?? ''} is empty. Give Value, Urgency and Risk together, or only a Cost of Delay.`;
    case 'cost-both':
      return `${place}: this row has a Cost of Delay and also Value, Urgency or Risk. Give one or the other.`;
    case 'cost-missing':
      return `${place}: this row has no cost of delay. Fill Cost of Delay, or Value, Urgency and Risk.`;
    case 'bad-flag':
      return `${place}: must be yes or no (got ${quoted(e.value)}).`;
    case 'duplicate-key':
      return `${place}: ${key} is also used in row ${e.value ?? ''}.`;
    case 'unknown-dependency':
      return `${place}: ${key} is not in the file. Remove the link, or add that issue to the file.`;
    case 'self-dependency':
      return `${place}: ${key} depends on itself.`;
    case 'dependency-cycle': {
      const keys = e.keys ?? [];
      return `${place}: these tickets depend on each other in a circle: ${[...keys, ...keys.slice(0, 1)].join(' → ')}.`;
    }
    case 'too-many-rows':
      return `The file: it has ${e.value ?? ''} rows; the most is ${thousands(e.limit ?? 0)}.`;
    case 'too-many-tickets':
      return `The file: it has ${e.value ?? ''} open tickets; the most is ${e.limit ?? 0}. Filter the Jira export by fix version or sprint, then import it again.`;
    case 'too-many-columns':
      return `${place}: it has ${e.value ?? ''} columns; the most is ${e.limit ?? 0}.`;
    case 'file-too-large':
      return `The file: it is larger than ${thousands(e.limit ?? 0)} bytes.`;
    case 'board-too-large':
      return 'The file: the board is too large to solve exactly.';
    case 'too-many-errors':
      return `The file has ${e.total ?? 0} problems; the first ${e.limit ?? 0} are listed.`;
  }
}

/** The banner above the page while your tickets are loaded: what came from the file and what is the sample's. Null on the built-in board. */
export function bannerSentences(state: AppState): { readonly lead: string; readonly rest: string; readonly notes: readonly string[] } | null {
  const source = state.source;
  if (source.kind !== 'file') return null;
  const notes: string[] = [];
  if (source.skipped > 0) notes.push(`${count(source.skipped, 'closed issue')} skipped: a finished issue is not part of a freeze.`);
  if (source.warnings.includes('replacement-characters')) notes.push('Some characters could not be read. Save the file as UTF-8 and import it again.');
  return {
    lead: `Your tickets from ${source.name}: ${count(state.home.tickets.length, 'ticket')}. Team and calendar are the sample's.`,
    rest: `Release weeks and the zombie threshold are the sample's too (${count(state.home.nextReleaseWeeks, 'week')}, threshold ${state.home.zombieThreshold}); the fog uses seed ${state.home.fogSeed}.`,
    notes,
  };
}