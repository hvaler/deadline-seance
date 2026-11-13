/**
 * The eleven positions of the candle. Step 0 is `now`; steps 1 to 10 are the end of each morning (13:00) and each afternoon (18:00),
 * Monday to Friday, in Europe/Madrid. That week the zone is CET (UTC+1), so 13:00 is 12:00Z and 18:00 is 17:00Z.
 *
 * A freeze at the end of a slot counts that slot, because its midpoint (11:00 or 16:00) is earlier. The instants are data, not
 * calculations: the engine has no function that turns a local date into an instant, and the UI does no time-zone arithmetic.
 * `tests/ui/candle-steps.test.ts` checks every label against the Madrid local time of its instant.
 */
export interface CandleStep {
  /** Local time in Europe/Madrid, for example "Fri 18:00". */
  readonly label: string;
  /** Epoch milliseconds passed to the engine as `freezeAt`. */
  readonly freezeAt: number;
}

export const CANDLE_STEPS: readonly CandleStep[] = [
  { label: 'Mon 09:00', freezeAt: Date.UTC(2026, 10, 16, 8, 0) },
  { label: 'Mon 13:00', freezeAt: Date.UTC(2026, 10, 16, 12, 0) },
  { label: 'Mon 18:00', freezeAt: Date.UTC(2026, 10, 16, 17, 0) },
  { label: 'Tue 13:00', freezeAt: Date.UTC(2026, 10, 17, 12, 0) },
  { label: 'Tue 18:00', freezeAt: Date.UTC(2026, 10, 17, 17, 0) },
  { label: 'Wed 13:00', freezeAt: Date.UTC(2026, 10, 18, 12, 0) },
  { label: 'Wed 18:00', freezeAt: Date.UTC(2026, 10, 18, 17, 0) },
  { label: 'Thu 13:00', freezeAt: Date.UTC(2026, 10, 19, 12, 0) },
  { label: 'Thu 18:00', freezeAt: Date.UTC(2026, 10, 19, 17, 0) },
  { label: 'Fri 13:00', freezeAt: Date.UTC(2026, 10, 20, 12, 0) },
  { label: 'Fri 18:00', freezeAt: Date.UTC(2026, 10, 20, 17, 0) },
];

/** The last step: Friday 18:00, where the app starts. */
export const LAST_CANDLE_STEP = CANDLE_STEPS.length - 1;
