import type { Announcer } from './announcer';
import type { View } from './derive';
import type { Services } from './services';
import type { Action, AppState, Change } from './state';
import type { Store } from './store';

/** What every renderer is given: the store, the services, and the two ways to say what happened. */
export interface Ctx {
  readonly store: Store<AppState, Action>;
  readonly services: Services;
  readonly announcer: Announcer;
  readonly root: HTMLElement;
  /** Dispatches a discrete action (a button), then announces it and plays its sound. An action the reducer ignores says nothing. */
  act(action: Action): void;
  /** Announces and plays the sound of a change that is not the store's own last change, such as the start-to-end change of a drag. */
  settle(change: Change, state: AppState): void;
}

/** One region of the page: it draws what the view says and nothing else. */
export interface Part {
  update(view: View, state: AppState): void;
  destroy?(): void;
}
