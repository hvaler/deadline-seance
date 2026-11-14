import { diffSolutions } from './diff';
import type { Data, KeyRef, Text } from './certificate';
import type { DiffEntry, Key, Solution } from './types';
/**
 * The night chronicle's facts and sentences. A decision is a small record (`DecisionFacts`): what was decided and what it did to the cut, the effect
 * being computed here from two solutions and nothing else. The sentence is a fixed template over those facts: no digit of its own, no clock, no state.
 * The panel, the spoken announcement and the death certificate all build their text from the same facts with the same functions.
 */
export type DecisionSubject =
  /** `weekday` and `time` are the local time of the candle step ("Wed", "18:00"), data the caller supplies. */
  | { readonly kind: 'candle'; readonly weekday: string; readonly time: string }
  | { readonly kind: 'reserve'; readonly from: number; readonly to: number }
  | { readonly kind: 'away' | 'back'; readonly name: string }
  | { readonly kind: 'exhume' | 'resurrect' | 'put-down'; readonly key: Key }
  | { readonly kind: 'reset' }
  | { readonly kind: 'load'; readonly file: string; readonly tickets: number; readonly skipped: number }
  | { readonly kind: 'sample'; readonly tickets: number };
export type DecisionEffect =
  | { readonly kind: 'diff'; readonly raised: readonly DiffEntry[]; readonly sunk: readonly DiffEntry[]; readonly codDelta: number }
  | { readonly kind: 'impossible'; readonly stillImpossible: boolean; readonly needed: number; readonly available: number }
  | { readonly kind: 'possible-again'; readonly kept: number; readonly savedCod: number }
  /** Both solved, but they come from boards that no longer share every ticket: only the totals compare. */
  | { readonly kind: 'totals'; readonly before: number; readonly after: number }
  /** A different board was loaded: nothing to compare. */
  | { readonly kind: 'new-board' };
export interface DecisionFacts {
  /** The entry's number: 1, 2, 3 ... in the order written. */
  readonly no: number;
  readonly subject: DecisionSubject;
  readonly effect: DecisionEffect;
}
/** What changed between two solutions, as a decision's effect. The only place the effect is computed. */
export function decisionEffect(before: Solution, after: Solution): DecisionEffect {
  if (after.status === 'impossible') {
    return { kind: 'impossible', stillImpossible: before.status === 'impossible', needed: after.needed, available: after.effectiveCapacity };
  }
  if (before.status === 'impossible') return { kind: 'possible-again', kept: after.kept.length, savedCod: after.savedCod };
  const d = diffSolutions(before, after);
  if (!d.ok) return { kind: 'totals', before: before.savedCod, after: after.savedCod };
  return { kind: 'diff', raised: d.value.raised, sunk: d.value.sunk, codDelta: d.value.codDelta };
}
// ---- the sentence ---------------------------------------------------------------------------------------------------------
const ARROW = ' \u2192 ';
const MINUS = '\u2212';
const d = (text: string): Data => ({ data: text });
const k = (key: Key): KeyRef => ({ key });
const count = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** "A, B, C" as pieces. */
function keysComma(keys: readonly Key[]): Text {
  const out: (string | KeyRef)[] = [];
  keys.forEach((key, i) => {
    if (i > 0) out.push(', ');
    out.push(k(key));
  });
  return out;
}
/** "A, B and C" as pieces (what `listOf` says). */
function keysAnd(keys: readonly Key[]): Text {
  const out: (string | KeyRef)[] = [];
  keys.forEach((key, i) => {
    if (i > 0) out.push(i === keys.length - 1 ? ' and ' : ', ');
    out.push(k(key));
  });
  return out;
}
function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${MINUS}${Math.abs(n)}`;
  return '0';
}
/** What was decided, with no effect: "Ana leaves", "Freeze moved to Wed 18:00", "Exhumed HB-108". */
export function describeWhat(s: DecisionSubject): Text {
  switch (s.kind) {
    case 'candle':
      return [`Freeze moved to ${s.weekday} ${s.time}`];
    case 'reserve':
      return [`Reserve ${s.to} %`];
    case 'away':
      return [d(s.name), ' leaves'];
    case 'back':
      return [d(s.name), ' is back'];
    case 'exhume':
      return ['Exhumed ', k(s.key)];
    case 'resurrect':
      return ['Resurrected ', k(s.key)];
    case 'put-down':
      return ['Put down ', k(s.key)];
    case 'reset':
      return ['Reset'];
    case 'load':
      return ['Loaded ', d(s.file), `: ${count(s.tickets, 'open ticket')}`];
    case 'sample':
      return [`Back to the sample board: ${count(s.tickets, 'ticket')}`];
  }
}
function effectParts(subject: DecisionSubject, effect: Extract<DecisionEffect, { kind: 'diff' }>): Text[] {
  const parts: Text[] = [];
  const own = subject.kind === 'exhume' || subject.kind === 'resurrect' ? subject.key : null;
  const raised = effect.raised.map((e) => e.key);
  if (own !== null && raised.includes(own)) {
    const others = raised.filter((key) => key !== own);
    parts.push(others.length === 0 ? ['in'] : ['in, with ', ...keysComma(others)]);
  } else if (raised.length > 0) {
    parts.push([...keysComma(raised), ' in']);
  }
  if (effect.sunk.length > 0) parts.push([...keysComma(effect.sunk.map((e) => e.key)), ' out']);
  return parts;
}
function joinParts(parts: readonly Text[], separator: string): Text {
  const out: (string | Data | KeyRef)[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push(separator);
    out.push(...part);
  });
  return out;
}
/** The effect of a decision, as in `Ana leaves → HB-105 in; HB-104 out (−34)`: the part after the arrow, or null when there is none. */
export function describeEffect(subject: DecisionSubject, effect: DecisionEffect): Text | null {
  switch (effect.kind) {
    case 'new-board':
      return null;
    case 'impossible':
      return [`${effect.stillImpossible ? 'still impossible' : 'impossible'}: needs ${count(effect.needed, 'point')}, ${effect.available} available`];
    case 'possible-again':
      return [`possible again: ${effect.kept} in, saved cod ${effect.savedCod}`];
    case 'totals':
      return [`saved cod ${effect.before} \u2192 ${effect.after}`];
    case 'diff': {
      const parts = effectParts(subject, effect);
      if (parts.length === 0 && effect.codDelta === 0) return ['no change'];
      return [...joinParts(parts, '; '), ` (${signed(effect.codDelta)})`];
    }
  }
}
/** The line of one decision: `<what> → <effect> (<change in saved cod>)`. */
export function describeDecision(facts: DecisionFacts): Text {
  const what = describeWhat(facts.subject);
  const effect = describeEffect(facts.subject, facts.effect);
  return effect === null ? what : [...what, ARROW, ...effect];
}
/** The line as plain text (what the panel shows). */
export function decisionLine(facts: DecisionFacts): string {
  return plain(describeDecision(facts));
}
function plain(text: Text): string {
  return text.map((p) => (typeof p === 'string' ? p : 'data' in p ? p.data : p.key)).join('');
}
// ---- the undo announcement ------------------------------------------------------------------------------------------------
function isAre(keys: readonly Key[]): string {
  return keys.length === 1 ? 'is' : 'are';
}
/** What an undo did to the cut, from the diff between the state it left and the state it restored. */
export function describeUndoEffect(effect: DecisionEffect): Text {
  switch (effect.kind) {
    case 'new-board':
      return ['Your earlier night is back.'];
    case 'impossible':
      return [`The freeze is ${effect.stillImpossible ? 'still ' : 'now '}impossible: needs ${count(effect.needed, 'point')}, ${effect.available} available.`];
    case 'possible-again':
      return ['The freeze is possible again.'];
    case 'totals':
      return [`Saved cod ${effect.before} \u2192 ${effect.after}.`];
    case 'diff': {
      const parts: Text[] = [];
      const raised = effect.raised.map((e) => e.key);
      const sunk = effect.sunk.map((e) => e.key);
      if (raised.length > 0) parts.push([...keysAnd(raised), ` ${isAre(raised)} back in`]);
      if (sunk.length > 0) parts.push([...keysAnd(sunk), ` ${isAre(sunk)} out again`]);
      if (parts.length === 0) return ['No change in the cut.'];
      return [...joinParts(parts, '; '), '.'];
    }
  }
}
/**
 * The announcement of an undo. `undone` is the first decision removed and `removed` how many were removed (a list length). The effect is the
 * engine's diff between the state the user left and the one restored (`decisionEffect(live, restored)`), not the sum of the entries' effects.
 */
export function describeUndo(undone: DecisionFacts, removed: number, effect: DecisionEffect): Text {
  const what = describeWhat(undone.subject);
  const lead: Text = removed === 1 ? ['Undone: ', ...what, '. '] : [`Undone ${removed} decisions, back to before "`, ...what, '". '];
  return [...lead, ...describeUndoEffect(effect)];
}
export function undoLine(undone: DecisionFacts, removed: number, effect: DecisionEffect): string {
  return plain(describeUndo(undone, removed, effect));
}
