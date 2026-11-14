import { CANDLE_STEPS } from '../candle-steps';
import type { Snapshot, Scene, SceneFacts, Script } from './types';
import { count, listOf, thousands } from '../text';

/**
 * The sample board's tour (it always loads the sample first, so it plays the same on any loaded board): "Play the night", 59 seconds. Every subtitle is one sentence with one key number, built from the engine's answers
 * (`SceneFacts`) and nothing else; the screen carries the rest (the sign, the ring on a ticket, the fog strip). The keys named here are
 * constants of this script, used by the actions of the scenes too; `tests/ui/tour-script.test.ts` checks they are on the board.
 */
export const ZOMBIE = 'HB-112';
export const INSISTED = 'HB-108';
export const AWAY = 'Ana';

const WEDNESDAY_18 = 6; // index into CANDLE_STEPS

/** The capacity and totals of a solved freeze, or null when the freeze is impossible. */
function solved(s: Snapshot): { readonly capacity: number; readonly outside: number; readonly saved: number } | null {
  const solution = s.view.solution;
  const totals = s.view.totals;
  if (solution.status !== 'ok' || totals === null) return null;
  return { capacity: solution.capacity, outside: totals.buriedCount, saved: totals.savedCod };
}

/** A true sentence for the one case the sample never meets: no cut to talk about. */
function noCut(s: Snapshot): string {
  const solution = s.view.solution;
  return solution.status === 'impossible'
    ? `No cut to show: the must-haves need ${count(solution.needed, 'point')}; ${solution.effectiveCapacity} are available.`
    : 'No cut to show.';
}

/** "falls", "rises" or "stays": a word chosen from the sign of the engine's own change in saved cost of delay. */
function savedMoves(after: Snapshot): 'falls' | 'rises' | 'stays' | 'is' {
  const change = after.state.change;
  if (change.kind !== 'done' || change.comparison.kind !== 'diff') return 'is';
  const delta = change.comparison.diff.codDelta;
  return delta < 0 ? 'falls' : delta > 0 ? 'rises' : 'stays';
}

/** "saved cost of delay falls from 167 to 113": the two totals, and a word from the sign of the engine's change. */
function savedFrom(first: Snapshot, after: Snapshot): string {
  const a = solved(first);
  const b = solved(after);
  if (a === null || b === null) return 'saved cost of delay is not known';
  const word = savedMoves(after);
  return word === 'falls' || word === 'rises' ? `saved cost of delay ${word} from ${a.saved} to ${b.saved}` : `saved cost of delay ${word === 'stays' ? 'stays at' : 'is'} ${b.saved}`;
}
function savedTo(after: Snapshot): string {
  const b = solved(after);
  if (b === null) return 'saved cost of delay is not known';
  const word = savedMoves(after);
  return word === 'falls' || word === 'rises' ? `saved cost of delay ${word} to ${b.saved}` : `saved cost of delay ${word === 'stays' ? 'stays at' : 'is'} ${b.saved}`;
}

/** The point of the fog strip for the reserve the state has. */
function foggy(after: Snapshot) {
  const fog = after.view.fog;
  const point = fog === null || fog.currentIndex === null ? undefined : fog.points[fog.currentIndex];
  return point !== undefined && point.status === 'ok' ? point : null;
}

function fogLine(after: Snapshot, lead: string): string {
  const point = foggy(after);
  if (point === null) return noCut(after);
  return `${point.marginPct} % reserve: ${lead} holds on ${thousands(point.fog.holds)} of ${thousands(point.fog.nights)} nights.`;
}

const baseline: Scene = {
  id: 'baseline',
  actions: [{ type: 'board/sample' }],
  caption: ({ after }) => {
    const s = solved(after);
    if (s === null) return noCut(after);
    return `${CANDLE_STEPS[0]?.label ?? ''}, freeze ${after.view.candle.label}: ${count(s.capacity, 'point')}, and ${count(s.outside, 'ticket')} ${s.outside === 1 ? 'stays' : 'stay'} outside.`;
  },
  durationMs: 5500,
  show: 'sign',
};

const candleBurns: Scene = {
  id: 'candle-burns',
  actions: [{ type: 'candle/set', step: WEDNESDAY_18 }],
  caption: ({ first, after }) => {
    const s = solved(after);
    if (s === null) return noCut(after);
    return `The candle burns down to ${after.view.candle.label}: ${count(s.capacity, 'point')}, and ${savedFrom(first, after)}.`;
  },
  durationMs: 6500,
  show: 'candle',
};

const someoneAway: Scene = {
  id: 'someone-away',
  actions: [{ type: 'survivor/toggle', name: AWAY }],
  caption: ({ after }) => {
    const s = solved(after);
    const change = after.state.change;
    const subject = change.kind === 'done' && change.subject.kind === 'survivor' ? change.subject : null;
    if (s === null) return noCut(after);
    const who = subject?.name ?? 'Someone';
    return `${who} ${subject?.away === false ? 'is back' : 'is away'}: ${count(s.capacity, 'point')} left, and ${savedTo(after)}.`;
  },
  durationMs: 5000,
  show: 'sign',
};

const zombie: Scene = {
  id: 'zombie',
  actions: [],
  caption: ({ after }) => {
    const entry = after.view.yard.find((t) => t.key === ZOMBIE);
    if (entry === undefined || entry.nextUrgency === null) return `${ZOMBIE} is not left outside.`;
    const now = entry.cost.effectiveUrgency;
    if (entry.nextUrgency === now) return `${ZOMBIE}, left out ${count(entry.cost.past, 'release')}, is already at the top: urgency ${now}.`;
    return `${ZOMBIE}, left out ${count(entry.cost.past, 'release')}, climbs from urgency ${now} to ${entry.nextUrgency}.`;
  },
  durationMs: 4000,
  show: 'yard',
  spot: [`tomb:${ZOMBIE}`],
};

const putDown: Scene = {
  id: 'put-down',
  actions: [{ type: 'tombstone/put-down', key: ZOMBIE }],
  caption: ({ after }) => {
    const totals = after.view.totals;
    if (totals === null) return noCut(after);
    const blocked = after.view.yard
      .filter((t) => t.reason.kind === 'blocked-by-put-down' && t.reason.putDownKey === ZOMBIE)
      .map((t) => t.key);
    const left = `the yard has ${count(totals.buriedCount, 'ticket')} left`;
    return blocked.length > 0 ? `Put down: ${listOf(blocked)} can never ship, and ${left}.` : `Put down: ${ZOMBIE} is closed as Won't Do, and ${left}.`;
  },
  durationMs: 5000,
  show: 'yard',
};

const insists: Scene = {
  id: 'someone-insists',
  actions: [{ type: 'tombstone/exhume', key: INSISTED }],
  caption: ({ after }) => {
    const change = after.state.change;
    const key = 'subject' in change && 'key' in change.subject ? change.subject.key : INSISTED;
    if (change.kind === 'rejected') {
      return `Someone insists on ${key}: it stays in the ground; the must-haves would need ${count(change.impossible.needed, 'point')}.`;
    }
    if (change.kind !== 'done') return `Someone insists on ${key}: the engine did not accept it.`;
    return `Someone insists on ${key}: it comes in, and ${savedTo(after)}.`;
  },
  durationMs: 6000,
  show: 'safehouse',
  spot: [`card:${INSISTED}`],
};

/** The note for the stakeholders, on the screen: the one state of the tour in which every section of it has something to say (a zombie, a put-down, someone away, an exhume and what it pushed out). */
const certificate: Scene = {
  id: 'certificate',
  actions: [],
  caption: () => 'One note for the stakeholders: what is out, and why.',
  durationMs: 4000,
  show: 'certificate',
};

const fogZero: Scene = {
  id: 'fog-zero',
  actions: [{ type: 'board/sample' }, { type: 'reserve/set', pct: 0 }],
  caption: ({ after }) => fogLine(after, 'the cut'),
  durationMs: 4500,
  show: 'fog',
};

function fogStep(pct: number): Scene {
  return {
    id: `fog-${pct}`,
    actions: [{ type: 'reserve/set', pct }],
    caption: ({ after }) => fogLine(after, 'it'),
    durationMs: 3500,
    show: 'fog',
  };
}

const message: Scene = {
  id: 'message',
  actions: [],
  caption: (_facts: SceneFacts) => 'You have to cut more than the arithmetic says.',
  durationMs: 3500,
  show: 'fog',
};

const close: Scene = {
  id: 'close',
  actions: [],
  caption: () => 'The rule decides, not the loudest voice: now play your own night.',
  durationMs: 4500,
  show: 'top',
};

export const sampleScript: Script = [baseline, candleBurns, someoneAway, zombie, putDown, insists, certificate, fogZero, fogStep(10), fogStep(15), fogStep(20), message, close];
