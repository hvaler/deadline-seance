import { decisionEffect } from '../engine/index';
import type { DecisionFacts, DecisionSubject } from '../engine/index';
import { CANDLE_STEPS } from './candle-steps';
import { CHRONICLE_CAP, EMPTY_CHRONICLE } from './model';
import type { AppState, Chronicle, Entry, Subject } from './model';
import { solveState } from './solve';
/**
 * The night chronicle as pure functions of the state: writing an entry and undoing. Nothing here touches the page. The sentence of an entry is
 * not made here: the engine writes it from the entry's facts (`engine/chronicle.ts`), so the panel, the announcement and the certificate agree.
 */
export { CHRONICLE_CAP, EMPTY_CHRONICLE };
/** The state without its chronicle: what an entry keeps. */
function withoutChronicle(state: AppState): Omit<AppState, 'chronicle'> {
  const { chronicle: _dropped, ...rest } = state;
  return rest;
}
/** True when the two states are the same night: same board, candle, reserve, team and source. */
export function sameNight(a: AppState, b: AppState): boolean {
  return (
    a.home === b.home &&
    a.board === b.board &&
    a.candle === b.candle &&
    a.marginPct === b.marginPct &&
    a.source === b.source &&
    a.away.length === b.away.length &&
    a.away.every((name, i) => name === b.away[i])
  );
}
/** What was decided, in the engine's words. `after` is the state the decision led to (its board has the tickets a load or a back to the sample brought). */
function subjectFor(subject: Subject, after: AppState): DecisionSubject {
  switch (subject.kind) {
    case 'candle': {
      const step = CANDLE_STEPS[subject.to];
      return { kind: 'candle', weekday: step?.weekday ?? '', time: step?.time ?? '' };
    }
    case 'reserve':
      return { kind: 'reserve', from: subject.from, to: subject.to };
    case 'survivor':
      return { kind: subject.away ? 'away' : 'back', name: subject.name };
    case 'exhume':
    case 'resurrect':
    case 'put-down':
      return { kind: subject.kind, key: subject.key };
    case 'reset':
      return { kind: 'reset' };
    case 'load':
      return { kind: 'load', file: subject.name, tickets: subject.count, skipped: subject.skipped };
    case 'sample':
      return { kind: 'sample', tickets: after.board.tickets.length };
  }
}
/** The facts of a decision: its subject and what it did to the cut (the engine's diff of the two solutions). */
export function factsFor(no: number, subject: Subject, before: AppState, after: AppState): DecisionFacts {
  const effect =
    subject.kind === 'load' || subject.kind === 'sample'
      ? ({ kind: 'new-board' } as const)
      : decisionEffect(solveState(before), solveState(after));
  return { no, subject: subjectFor(subject, after), effect };
}
/**
 * `after` with the entry for the decision that led from `before` to it. A load or a back to the sample starts a new chronicle whose entry 1
 * keeps the old one. Otherwise the entry is appended, and the 51st drops the oldest.
 */
export function recordEntry(before: AppState, after: AppState, subject: Subject): AppState {
  const newBoard = subject.kind === 'load' || subject.kind === 'sample';
  const base: Chronicle = newBoard ? EMPTY_CHRONICLE : before.chronicle;
  const no = base.dropped + base.entries.length + 1;
  const entry: Entry = {
    no,
    facts: factsFor(no, subject, before, after),
    before: withoutChronicle(before),
    previous: newBoard ? before.chronicle : null,
  };
  let entries = [...base.entries, entry];
  let dropped = base.dropped;
  let lost = base.lost;
  if (entries.length > CHRONICLE_CAP) {
    if (entries[0]?.previous !== null) lost = true;
    entries = entries.slice(entries.length - CHRONICLE_CAP);
    dropped += 1;
  }
  return { ...after, chronicle: { entries, dropped, lost } };
}
/** True when there is something to undo. */
export function canUndo(state: AppState): boolean {
  return state.chronicle.entries.length > 0;
}
/**
 * The state before the entry at index `to`, with that entry and every later one removed. `sound` stays as it is now (a preference) and so does
 * `release` while the board is the same one (a label the user may have typed since). An index that is not an entry returns the very same state.
 */
export function undoTo(state: AppState, to: number): AppState {
  const { entries, dropped } = state.chronicle;
  const entry = entries[to];
  if (!Number.isInteger(to) || entry === undefined) return state;
  const chronicle = entry.previous ?? { entries: entries.slice(0, to), dropped, lost: state.chronicle.lost };
  const release = entry.before.home === state.home ? state.release : entry.before.release;
  return { ...entry.before, chronicle, sound: state.sound, release };
}
