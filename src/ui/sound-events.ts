import type { View } from './derive';
import type { Change } from './model';

/** The four sounds of the night. */
export type SoundEvent = 'resurrect' | 'put-down' | 'bury' | 'cascade';

/**
 * Which sound a settled change makes, if any. One sound per change:
 * - exhume or resurrect that was applied: resurrect;
 * - put down: put down;
 * - a candle, reserve or survivor change that sinks tickets: cascade when one of the sunk tickets is now buried because a dependency
 *   is buried, otherwise bury;
 * - everything else (only raises, a rejected exhume, a refusal, a reset, nothing yet) is silent.
 *
 * `view` is the view after the change.
 */
export function soundEventFor(change: Change, view: View): SoundEvent | null {
  if (change.kind !== 'done') return null;
  const { subject, comparison } = change;
  switch (subject.kind) {
    case 'exhume':
    case 'resurrect':
      return 'resurrect';
    case 'put-down':
      return 'put-down';
    case 'reset':
    case 'load':
    case 'sample':
      return null;
    case 'candle':
    case 'reserve':
    case 'survivor': {
      if (comparison.kind !== 'diff' || comparison.diff.sunk.length === 0) return null;
      const sunk = new Set(comparison.diff.sunk.map((e) => e.key));
      const cascade = view.yard.some((t) => sunk.has(t.key) && t.reason.kind === 'depends-on-buried');
      return cascade ? 'cascade' : 'bury';
    }
  }
}
