import type { Timers } from '../services';

/**
 * The running timecode of the "REC" corner: hours, minutes, seconds and frames (25 a second) since the page was opened. It is decoration
 * and it is the only part of the UI that looks at a clock; it never touches the rule, and it uses the monotonic `performance` timer, not
 * the date. It updates four times a second. Under reduced motion it shows zeros and does not run.
 */

export const TIMECODE_ZERO = '00:00:00:00';
export const TIMECODE_INTERVAL_MS = 250;

const pad = (n: number): string => String(n).padStart(2, '0');

/** `HH:MM:SS:FF` for a number of milliseconds, at 25 frames per second. */
export function formatTimecode(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const frames = Math.floor((safe % 1000) / 40);
  const seconds = Math.floor(safe / 1000) % 60;
  const minutes = Math.floor(safe / 60_000) % 60;
  const hours = Math.floor(safe / 3_600_000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

export interface Timecode {
  start(): void;
  stop(): void;
  setReduced(reduced: boolean): void;
}

export interface TimecodeDeps {
  /** A monotonic clock in milliseconds. */
  readonly now: () => number;
  readonly timers: Timers;
}

export function createTimecode(node: HTMLElement, deps: TimecodeDeps): Timecode {
  let origin = deps.now();
  let timer: number | null = null;
  let running = false;
  let reduced = false;

  function show(): void {
    node.textContent = reduced ? TIMECODE_ZERO : formatTimecode(deps.now() - origin);
  }

  function schedule(): void {
    if (timer !== null) deps.timers.clear(timer);
    timer = null;
    if (!running || reduced) return;
    const tick = (): void => {
      show();
      timer = deps.timers.set(tick, TIMECODE_INTERVAL_MS);
    };
    timer = deps.timers.set(tick, TIMECODE_INTERVAL_MS);
  }

  return {
    start() {
      running = true;
      origin = deps.now();
      show();
      schedule();
    },
    stop() {
      running = false;
      schedule();
    },
    setReduced(on) {
      reduced = on;
      show();
      schedule();
    },
  };
}
