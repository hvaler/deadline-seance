import type { Action, AppState } from '../state';
import type { Store } from '../store';

/**
 * Puts the user's own state back after the tour: through the one action the tour alone sends. The state is the very object that was taken at
 * the start, so nothing is rebuilt and nothing can be forgotten. The one exception is `sound`: it is a preference, not part of the night, so a
 * user who turned it on (or off) during the tour keeps what they chose.
 */
export function restoreInto(store: Store<AppState, Action>, snapshot: AppState): void {
  const live = store.getState();
  const target = live.sound === snapshot.sound ? snapshot : { ...snapshot, sound: live.sound };
  store.dispatch({ type: 'state/restore', state: target });
}
