import { costOfDelay, nightFacts, solveFreeze } from '../src/engine/index';
import type { OutsideReason, Ticket } from '../src/engine/index';
import { bad, fromEngine, good } from './errors';
import type { HandlerResult, Outcome } from './errors';
import { buildState, loadBoard, presentBoard } from './request';
import type { RequestState } from './request';
import { renderSolve } from './render';
import { run } from './run';
import { SolveFreezeInput } from './schemas';
import type { SolveFreezeOutputValue } from './schemas';

/** The engine's reason, with its lists copied (the schema's lists are not read-only). */
function reasonOf(r: OutsideReason): SolveFreezeOutputValue['outside'][number]['reason'] {
  switch (r.kind) {
    case 'no-room':
    case 'blocked-by-put-down':
      return r;
    case 'depends-on-buried':
      return { kind: r.kind, buriedDependencies: [...r.buriedDependencies] };
    case 'pushed-out-by-exhume':
      return { kind: r.kind, exhumed: [...r.exhumed], together: r.together, needed: r.needed, left: r.left };
  }
}

/** The answer for a request state: the engine's facts and solution, reshaped (renamed fields, no new numbers). */
export function solveState(state: RequestState): Outcome<SolveFreezeOutputValue> {
  const facts = nightFacts(state);
  if (!facts.ok) return bad(fromEngine(facts.error));
  const present = presentBoard(state);
  if (!present.ok) return present;
  const solved = solveFreeze(present.value, state.freeze);
  if (!solved.ok) return bad(fromEngine(solved.error));
  const solution = solved.value;
  const f = facts.value;
  const head = { zone: f.zone, asOf: f.asOf, freeze: f.freeze, capacity: f.capacity, effectiveCapacity: f.effectiveCapacity, marginPct: f.reservePct, away: [...f.away] };
  if (f.status === 'impossible') {
    return good({
      ...head,
      status: 'impossible',
      kept: [],
      totals: null,
      outside: [],
      outsideTotals: null,
      zombies: [],
      fog: null,
      needed: f.needed,
      blockedMustHaves: f.blockedMustHaves.map((b) => ({ key: b.key, putDownKey: b.putDownKey })),
    });
  }
  if (solution.status !== 'ok') return bad(fromEngine({ code: 'solution-impossible' }));
  const byKey = new Map<string, Ticket>(present.value.tickets.map((t) => [t.key, t] as const));
  const kept = solution.kept.flatMap((key) => {
    const t = byKey.get(key);
    return t === undefined ? [] : [{ key, title: t.title, effort: t.effort, cod: costOfDelay(t) }];
  });
  return good({
    ...head,
    status: 'ok',
    kept,
    totals: { tickets: f.kept.count, points: f.kept.effort, cod: f.kept.cod },
    outside: f.outside.map((o) => ({
      key: o.key,
      title: o.title,
      effort: o.effort,
      cod: o.cod,
      waitingCost: o.waitingCost,
      isZombie: o.isZombie,
      reason: reasonOf(o.reason),
    })),
    outsideTotals: { tickets: f.outsideTotals.count, points: f.outsideTotals.effort, cod: f.outsideTotals.cod, waitingCost: f.outsideTotals.waitingCost },
    zombies: [...solution.zombies],
    fog: { nights: f.fog.nights, holds: f.fog.holds, pct: f.fog.pct },
    needed: null,
    blockedMustHaves: [],
  });
}

/** `solve_freeze`: the cut list for a freeze, with the reason for every ticket that is outside. */
export function solveFreezeTool(raw: unknown): HandlerResult<SolveFreezeOutputValue> {
  return run(SolveFreezeInput, raw, (input) => {
    const loaded = loadBoard(input.board);
    if (!loaded.ok) return loaded;
    const state = buildState(loaded.value, input);
    if (!state.ok) return state;
    const out = solveState(state.value);
    return out.ok ? good({ structured: out.value, text: renderSolve(out.value) }) : out;
  });
}
