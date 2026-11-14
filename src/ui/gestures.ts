import type { Action, AppState, Change, Subject } from './state';
import type { Store } from './store';
import { compareStates } from './solve';
import type { Frame, Timers } from './services';

/**
 * A drag (or a held arrow key) on a range input. While it lasts:
 * - the latest value is applied at most once per animation frame, so a fast drag costs one solve per frame;
 * - the spoken announcement and the sound wait until the value settles (300 ms without input, or the end of the gesture), and describe
 *   the whole gesture: the state when it started against the state when it ended.
 */

export const SETTLE_MS = 300;

export interface GestureOptions {
  readonly store: Store<AppState, Action>;
  readonly frame: Frame;
  readonly timers: Timers;
  readonly toAction: (value: number) => Action;
  /** What the gesture did, or null when it ended where it started. */
  readonly subjectOf: (start: AppState, end: AppState) => Subject | null;
  /** Called once per settled gesture with the change from its start to its end, and the state it ended in. */
  readonly onSettle: (change: Change, end: AppState, start: AppState) => void;
  readonly settleMs?: number;
  /** Called with true on the first input of a gesture and with false once it has settled (after onSettle). */
  readonly onActive?: (active: boolean) => void;
}

export interface Gesture {
  /** True from the first input of a gesture until it settles: renderers must not move the control while it is true. */
  readonly active: boolean;
  /** An `input` event of the range. */
  input(value: number): void;
  /** The end of the gesture (a `change` event): apply what is pending and settle now. */
  commit(): void;
  /** Cancels timers and frames. */
  destroy(): void;
}

export function createGesture(options: GestureOptions): Gesture {
  const { store, frame, timers, toAction, subjectOf, onSettle } = options;
  const settleMs = options.settleMs ?? SETTLE_MS;
  const { onActive } = options;

  let start: AppState | null = null;
  let pending: number | null = null;
  let frameId: number | null = null;
  let timerId: number | null = null;

  function apply(): void {
    frameId = null;
    if (pending === null) return;
    const value = pending;
    pending = null;
    store.dispatch(toAction(value));
  }

  function settle(): void {
    const wasActive = start !== null;
    try {
      settleNow();
    } finally {
      if (wasActive) onActive?.(false);
    }
  }

  function settleNow(): void {
    timerId = null;
    if (frameId !== null) {
      frame.cancel(frameId);
      frameId = null;
    }
    apply();
    const began = start;
    start = null;
    if (began === null) return;
    const end = store.getState();
    const subject = subjectOf(began, end);
    if (subject === null) return;
    onSettle({ kind: 'done', subject, comparison: compareStates(began, end) }, end, began);
  }

  return {
    get active() {
      return start !== null;
    },
    input(value) {
      if (start === null) {
        start = store.getState();
        onActive?.(true);
      }
      pending = value;
      if (frameId === null) frameId = frame.request(apply);
      if (timerId !== null) timers.clear(timerId);
      timerId = timers.set(settle, settleMs);
    },
    commit() {
      if (timerId !== null) timers.clear(timerId);
      settle();
    },
    destroy() {
      const wasActive = start !== null;
      if (timerId !== null) timers.clear(timerId);
      if (frameId !== null) frame.cancel(frameId);
      timerId = null;
      frameId = null;
      pending = null;
      start = null;
      if (wasActive) onActive?.(false);
    },
  };
}

/**
 * Connects a range input to a gesture. A pointer drag ends with the `change` event, which settles at once. A key press also fires `change`
 * (once per press, also while a key is held), and that is not the end of a gesture: a burst of presses is one gesture, and it settles when
 * 300 ms pass without input, so a held arrow key writes one chronicle entry and speaks once, as the header of this file says.
 */
export function wireRange(input: HTMLInputElement, gesture: Gesture): void {
  let keyboard = false;
  input.addEventListener('keydown', () => {
    keyboard = true;
  });
  input.addEventListener('pointerdown', () => {
    keyboard = false;
  });
  input.addEventListener('input', () => gesture.input(Number(input.value)));
  input.addEventListener('change', () => {
    if (!keyboard) gesture.commit();
  });
}
