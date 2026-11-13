/**
 * A tiny store: one value, one reducer, listeners. `dispatch` runs the reducer; when the reducer returns the very same value (an action
 * it ignored) nobody is notified. A dispatch made by a listener waits until the current round of listeners is done, so every listener
 * sees the states in order.
 */
export interface Store<S, A> {
  getState(): S;
  dispatch(action: A): void;
  /** Returns the function that removes the listener. */
  subscribe(listener: (state: S) => void): () => void;
}

export function createStore<S, A>(reducer: (state: S, action: A) => S, initial: S): Store<S, A> {
  let state = initial;
  const listeners = new Set<(state: S) => void>();
  const queue: A[] = [];
  let running = false;

  function drain(): void {
    running = true;
    try {
      while (queue.length > 0) {
        const action = queue.shift() as A;
        const next = reducer(state, action);
        if (next === state) continue;
        state = next;
        for (const listener of [...listeners]) listener(state);
      }
    } catch (error) {
      queue.length = 0; // a failed reducer leaves nothing half-done behind it
      throw error;
    } finally {
      running = false;
    }
  }

  return {
    getState: () => state,
    dispatch(action) {
      queue.push(action);
      if (!running) drain();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
