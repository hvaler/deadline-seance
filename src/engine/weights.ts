/**
 * Integer weights that fold the first three tie-break levels into one number per ticket:
 * more saved cod, then more kept tickets (fewer buried), then more kept effort (less buried effort).
 *
 *   K0 = totalEffort + 1,  K1 = (n + 1) * K0,  weight = cod * K1 + K0 + effort
 *
 * For a set of c tickets with effort e <= totalEffort, sum(weight) = cod * K1 + c * K0 + e and c * K0 + e < K1,
 * so comparing sums equals comparing (cod, c, e) lexicographically.
 */
export interface WeightScale {
  readonly k0: number;
  readonly k1: number;
}

export function weightScale(ticketCount: number, totalEffort: number): WeightScale {
  const k0 = totalEffort + 1;
  return { k0, k1: (ticketCount + 1) * k0 };
}

export function ticketWeight(scale: WeightScale, cod: number, effort: number): number {
  return cod * scale.k1 + scale.k0 + effort;
}

/**
 * True when every product the solver forms (total weight times the largest effort bound, used in the fractional bound)
 * stays within the safe integer range. `totalCod` may be an upper bound.
 */
export function weightsFitSafeIntegers(ticketCount: number, totalEffort: number, totalCod: number): boolean {
  const { k0, k1 } = weightScale(ticketCount, totalEffort);
  const totalWeight = totalCod * k1 + ticketCount * k0 + totalEffort;
  const product = totalWeight * (totalEffort + 1);
  return Number.isSafeInteger(totalWeight) && Number.isSafeInteger(product);
}
