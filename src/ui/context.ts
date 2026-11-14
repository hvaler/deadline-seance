import type { Announcer } from './announcer';
import type { View } from './derive';
import type { Services } from './services';
import type { Action, AppState, Change } from './state';
import type { Store } from './store';

export interface ActOptions {
  /** False: the change is not announced to a screen reader (something else, such as the tour's subtitle, says it). The sound still plays. Default true. */
  readonly announce?: boolean;
}

/** What every renderer is given: the store, the services, and the two ways to say what happened. */
export interface Ctx {
  readonly store: Store<AppState, Action>;
  readonly services: Services;
  readonly announcer: Announcer;
  readonly root: HTMLElement;
  /** Dispatches a discrete action (a button), then announces it and plays its sound. An action the reducer ignores says nothing. */
  act(action: Action, options?: ActOptions): void;
  /** Announces and plays the sound of a change that is not the store's own last change, such as the start-to-end change of a drag. */
  settle(change: Change, state: AppState): void;
  /** A gesture (a drag of the candle or the reserve) starts (true) or has settled (false): on a big board the fog waits for the settle. */
  gestureActive(active: boolean): void;
  /** A gesture settled: writes its one chronicle entry (the state it began in against the state now). Nothing is written for a change that is not a decision. */
  record(start: AppState, change: Change): void;
  /** A gesture of the page registers here, so an undo can settle a pending one first. */
  addGesture(gesture: { commit(): void }): void;
  /** Undoes the entry at index `to` of the chronicle and every later one: settles pending gestures, restores, announces once, plays the undo sound if Sound is on. With nothing to undo it says "Nothing to undo." and changes nothing. */
  undo(to: number | 'last'): void;
}

/** One region of the page: it draws what the view says and nothing else. */
export interface Part {
  update(view: View, state: AppState): void;
  destroy?(): void;
}
