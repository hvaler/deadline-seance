import { SCALE } from './types';
import type { Ticket } from './types';

/** Highest step of the scale. Urgency never goes above it. */
const TOP = SCALE.length - 1;

/**
 * Urgency raised `past` steps on the scale 1, 2, 3, 5, 8, 13, 20, capped at 20. A ticket that has been left out
 * for several releases gets hungrier. `urgency` must be on the scale (validated boards guarantee it).
 */
export function effectiveUrgency(urgency: number, past: number): number {
  const index = (SCALE as readonly number[]).indexOf(urgency);
  if (index < 0) throw new RangeError(`urgency ${urgency} is not on the scale`);
  return SCALE[Math.min(index + Math.max(0, past), TOP)] as number;
}

export interface CodParts {
  /** True for a ticket whose cost of delay was imported as a single number (no formula, no hunger). */
  readonly imported: boolean;
  readonly value: number;
  readonly urgency: number;
  readonly effectiveUrgency: number;
  readonly risk: number;
  readonly past: number;
  readonly cod: number;
}

/** The parts of a ticket's cost of delay, so the UI can show "urgency 1 → 5, 3 releases out". */
export function codParts(ticket: Ticket): CodParts {
  const { cost, past } = ticket;
  if (cost.kind === 'imported') {
    return { imported: true, value: 0, urgency: 0, effectiveUrgency: 0, risk: 0, past, cod: cost.cod };
  }
  const hungry = effectiveUrgency(cost.urgency, past);
  return {
    imported: false,
    value: cost.value,
    urgency: cost.urgency,
    effectiveUrgency: hungry,
    risk: cost.risk,
    past,
    cod: cost.value + hungry + cost.risk,
  };
}

/** `value + effectiveUrgency + risk`, or the imported number as is. */
export function costOfDelay(ticket: Ticket): number {
  return codParts(ticket).cod;
}

/** What burying a ticket costs: its cost of delay for every week it waits for the next release. */
export function burialCost(ticket: Ticket, nextReleaseWeeks: number): number {
  return costOfDelay(ticket) * nextReleaseWeeks;
}
