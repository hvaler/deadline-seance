import { diffSolutions, exhume, putDown, simulateFog, solveFreeze } from '../src/engine/index';
import type { Diff, Solution, Ticket, ValidBoard } from '../src/engine/index';
import { bad, failure, fromEngine, good } from './errors';
import type { HandlerResult, Outcome } from './errors';
import { buildState, loadBoard, presentBoard } from './request';
import type { RequestParams, RequestState } from './request';
import { renderWhatIf } from './render';
import { run } from './run';
import { WhatIfInput } from './schemas';
import type { ChangeInput, SideValue, TicketRowValue, WhatIfOutputValue } from './schemas';

/** One side of the comparison: the engine's solution of a board, and the fog of what it keeps. */
function sideOf(board: ValidBoard, solution: Solution): Outcome<SideValue> {
  if (solution.status === 'impossible') {
    return good({
      status: 'impossible',
      capacity: solution.capacity,
      effectiveCapacity: solution.effectiveCapacity,
      marginPct: solution.marginPct,
      tickets: null,
      points: null,
      cod: null,
      fog: null,
      needed: solution.needed,
    });
  }
  const fog = simulateFog(board, solution.kept, solution.capacity);
  if (!fog.ok) return bad(fromEngine(fog.error));
  return good({
    status: 'ok',
    capacity: solution.capacity,
    effectiveCapacity: solution.effectiveCapacity,
    marginPct: solution.marginPct,
    tickets: solution.kept.length,
    points: solution.keptEffort,
    cod: solution.savedCod,
    fog: { nights: fog.value.nights, holds: fog.value.holds, pct: fog.value.pct },
    needed: null,
  });
}

function rowsOf(entries: Diff['raised'], ...boards: readonly ValidBoard[]): TicketRowValue[] {
  const byKey = new Map<string, Ticket>();
  for (const b of boards) for (const t of b.tickets) byKey.set(t.key, t);
  return entries.flatMap((e) => {
    const t = byKey.get(e.key);
    return t === undefined ? [] : [{ key: e.key, title: t.title, effort: t.effort, cod: e.cod }];
  });
}

function describeChange(change: ChangeInput): string {
  switch (change.kind) {
    case 'exhume':
      return `exhume ${change.key}`;
    case 'put_down':
      return `put down ${change.key}`;
    case 'away':
      return change.date === undefined ? `${change.person} away for the night` : `${change.person} away on ${change.date} (${change.part ?? 'full'})`;
    case 'back':
      return `${change.person} back`;
    case 'move_freeze':
      return `move the freeze to ${String(change.freezeAt)}`;
    case 'margin':
      return `set the reserve to ${change.marginPct} percent`;
  }
}

/** The request after a change that only touches the inputs (people, freeze, margin): the same request with that input replaced. */
function changedState(loadedBoard: Parameters<typeof buildState>[0], params: RequestParams, change: ChangeInput): Outcome<RequestState> {
  switch (change.kind) {
    case 'away':
      return buildState(loadedBoard, { ...params, away: [...(params.away ?? []), { person: change.person, date: change.date, part: change.part }] });
    case 'back': {
      const kept = (params.away ?? []).filter((a) => a.person !== change.person);
      if (kept.length === (params.away ?? []).length) {
        return bad(failure('bad-request', `${change.person} is not away in this request, so there is nobody to bring back.`, { subject: change.person }));
      }
      return buildState(loadedBoard, { ...params, away: kept });
    }
    case 'move_freeze':
      return buildState(loadedBoard, { ...params, freezeAt: change.freezeAt });
    case 'margin':
      return buildState(loadedBoard, { ...params, marginPct: change.marginPct });
    case 'exhume':
    case 'put_down':
      return bad(failure('internal-error', 'This change is not an input change.'));
  }
}

/** `what_if`: one change, and what comes in, what goes out and what the cost of delay does. */
export function whatIfTool(raw: unknown): HandlerResult<WhatIfOutputValue> {
  return run(WhatIfInput, raw, (input) => {
    const loaded = loadBoard(input.board);
    if (!loaded.ok) return loaded;
    const params: RequestParams = { now: input.now, freezeAt: input.freezeAt, marginPct: input.marginPct, away: input.away };
    const state = buildState(loaded.value, params);
    if (!state.ok) return state;
    const present = presentBoard(state.value);
    if (!present.ok) return present;
    const beforeSolved = solveFreeze(present.value, state.value.freeze);
    if (!beforeSolved.ok) return bad(fromEngine(beforeSolved.error));
    const change = input.change;
    const label = describeChange(change);

    let afterBoard: ValidBoard;
    let afterSolution: Solution;
    let diff: Diff | null = null;
    let rejected = false;
    if (change.kind === 'exhume' || change.kind === 'put_down') {
      if (beforeSolved.value.status !== 'ok') return bad(fromEngine({ code: 'solution-impossible' }));
      if (change.kind === 'exhume') {
        const out = exhume(present.value, state.value.freeze, change.key);
        if (!out.ok) return bad(fromEngine(out.error));
        if (out.value.kind === 'rejected') {
          afterBoard = present.value;
          afterSolution = out.value.impossible;
          rejected = true;
        } else {
          afterBoard = out.value.board;
          afterSolution = out.value.after;
          diff = out.value.diff;
        }
      } else {
        const out = putDown(present.value, state.value.freeze, change.key);
        if (!out.ok) return bad(fromEngine(out.error));
        afterBoard = out.value.board;
        afterSolution = out.value.after;
        diff = out.value.diff;
      }
    } else {
      const next = changedState(loaded.value, params, change);
      if (!next.ok) return next;
      const nextPresent = presentBoard(next.value);
      if (!nextPresent.ok) return nextPresent;
      const solved = solveFreeze(nextPresent.value, next.value.freeze);
      if (!solved.ok) return bad(fromEngine(solved.error));
      afterBoard = nextPresent.value;
      afterSolution = solved.value;
      if (beforeSolved.value.status === 'ok' && afterSolution.status === 'impossible') rejected = true;
      if (beforeSolved.value.status === 'ok' && afterSolution.status === 'ok') {
        const d = diffSolutions(beforeSolved.value, afterSolution);
        if (!d.ok) return bad(fromEngine(d.error));
        diff = d.value;
      }
    }
    const before = sideOf(present.value, beforeSolved.value);
    if (!before.ok) return before;
    const after = sideOf(afterBoard, afterSolution);
    if (!after.ok) return after;
    const structured: WhatIfOutputValue = {
      change: label,
      before: before.value,
      after: after.value,
      rejected,
      comes_in: diff === null ? [] : rowsOf(diff.raised, present.value, afterBoard),
      goes_out: diff === null ? [] : rowsOf(diff.sunk, present.value, afterBoard),
      cod_delta: diff === null ? null : diff.codDelta,
    };
    return good({ structured, text: renderWhatIf(structured) });
  });
}
