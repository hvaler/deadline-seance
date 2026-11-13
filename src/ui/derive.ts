import { capacityBetween, codParts, compareKeys, effectiveCapacity } from '../engine/index';
import type { CodParts, FreezeInput, Key, Reason, Solution, Ticket } from '../engine/index';
import { CANDLE_STEPS } from './candle-steps';
import { freezeFor, presentPeople } from './model';
import type { AppState } from './model';
import { SAMPLE_NOW } from './sample-board';
import { solveState } from './solve';

/**
 * The view: everything the screen draws, derived from the state by asking the engine. Facts and board data only (keys, titles, who
 * depends on whom); no sentence (see `text.ts`) and no arithmetic on engine numbers.
 */

export interface CardView {
  readonly key: Key;
  readonly title: string;
  readonly effort: number;
  readonly mustHave: boolean;
  /** The tickets this one depends on, sorted, as written on the board. */
  readonly needs: readonly Key[];
  /** The cost of delay in parts (value, urgency and its hunger, risk, releases out), from the engine. */
  readonly cost: CodParts;
}

export interface TombstoneView extends CardView {
  readonly reason: Reason;
  /** `cod` times the weeks of waiting, from the engine. */
  readonly burialCost: number;
  readonly isZombie: boolean;
  /** Buried tickets this one depends on: the chains drawn in the yard. */
  readonly chainedTo: readonly Key[];
  /** True when it fell because a dependency is buried (reason `depends-on-buried`). */
  readonly fell: boolean;
}

export interface TeamView {
  readonly name: string;
  readonly pointsPerHalfDay: number;
  readonly away: boolean;
}

export interface Totals {
  readonly keptCount: number;
  readonly keptEffort: number;
  readonly savedCod: number;
  readonly buriedCount: number;
  readonly buriedEffort: number;
  readonly buriedCod: number;
}

export interface MustHaveView {
  readonly key: Key;
  readonly title: string;
  readonly effort: number;
}

export interface View {
  readonly freeze: FreezeInput;
  readonly candle: {
    readonly step: number;
    readonly label: string;
    /** `capacityBetween`; equals the solution's `capacity`. */
    readonly capacity: number;
    /** `effectiveCapacity`; equals the solution's `effectiveCapacity`. */
    readonly effectiveCapacity: number;
    /** The capacity at every position of the candle, for the notches. */
    readonly notches: readonly { readonly step: number; readonly label: string; readonly capacity: number }[];
  };
  readonly solution: Solution;
  readonly team: readonly TeamView[];
  /** Empty while the freeze is impossible. */
  readonly safehouse: readonly CardView[];
  /** Empty while the freeze is impossible. */
  readonly yard: readonly TombstoneView[];
  /** Null while the freeze is impossible. */
  readonly totals: Totals | null;
  /** `from` depends on `to`, and both are buried. */
  readonly chains: readonly { readonly from: Key; readonly to: Key }[];
  /** Every must-have of the board, for the explanation shown while the freeze is impossible. */
  readonly mustHaves: readonly MustHaveView[];
  /** Keys closed as Won't Do. */
  readonly putDown: readonly Key[];
}

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string } }): T {
  if (!result.ok) throw new Error(`the engine refused: ${result.error.code}`);
  return result.value;
}

function uniqueSorted(keys: readonly Key[]): Key[] {
  return [...new Set(keys)].sort(compareKeys);
}

function cardOf(ticket: Ticket): CardView {
  return {
    key: ticket.key,
    title: ticket.title,
    effort: ticket.effort,
    mustHave: ticket.mustHave,
    needs: uniqueSorted(ticket.dependsOn),
    cost: codParts(ticket),
  };
}

export function derive(state: AppState): View {
  const freeze = freezeFor(state);
  const people = presentPeople(state);
  const zone = state.board.timeZone;

  const capacity = unwrap(capacityBetween(people, zone, SAMPLE_NOW, freeze.freezeAt));
  const effective = unwrap(effectiveCapacity(capacity, state.marginPct));
  const notches = CANDLE_STEPS.map((step, index) => ({
    step: index,
    label: step.label,
    capacity: unwrap(capacityBetween(people, zone, SAMPLE_NOW, step.freezeAt)),
  }));

  const solution = solveState(state);
  const byKey = new Map(state.board.tickets.map((t) => [t.key, t] as const));
  const safehouse: CardView[] = [];
  const yard: TombstoneView[] = [];
  const chains: { from: Key; to: Key }[] = [];
  let totals: Totals | null = null;

  if (solution.status === 'ok') {
    for (const key of solution.kept) {
      const ticket = byKey.get(key);
      if (ticket) safehouse.push(cardOf(ticket));
    }
    const buried = new Set(solution.buried.map((b) => b.key));
    for (const entry of solution.buried) {
      const ticket = byKey.get(entry.key);
      if (!ticket) continue;
      const chainedTo = uniqueSorted(ticket.dependsOn).filter((d) => buried.has(d));
      for (const to of chainedTo) chains.push({ from: entry.key, to });
      yard.push({
        ...cardOf(ticket),
        reason: entry.reason,
        burialCost: entry.burialCost,
        isZombie: entry.isZombie,
        chainedTo,
        fell: entry.reason.kind === 'depends-on-buried',
      });
    }
    totals = {
      keptCount: solution.kept.length,
      keptEffort: solution.keptEffort,
      savedCod: solution.savedCod,
      buriedCount: solution.buried.length,
      buriedEffort: solution.buriedEffort,
      buriedCod: solution.buriedCod,
    };
  }

  return {
    freeze,
    candle: { step: state.candle, label: CANDLE_STEPS[state.candle]?.label ?? '', capacity, effectiveCapacity: effective, notches },
    solution,
    team: state.board.people.map((p) => ({ name: p.name, pointsPerHalfDay: p.pointsPerHalfDay, away: state.away.includes(p.name) })),
    safehouse,
    yard,
    totals,
    chains,
    mustHaves: state.board.tickets
      .filter((t) => t.mustHave)
      .map((t) => ({ key: t.key, title: t.title, effort: t.effort }))
      .sort((a, b) => compareKeys(a.key, b.key)),
    putDown: [...state.board.wontDo].sort(compareKeys),
  };
}
