import { derive } from '../derive';
import { reducer } from '../state';
import type { Action, AppState } from '../state';
import type { SceneFacts, Scene, Script, Snapshot } from './types';

/**
 * Runs a script through the reducer, with no page: what every scene does to the state, what its subtitle says, and when. The player and this
 * function must agree (a test checks it); the generated video script and the tests of the numbers are made from it.
 */
export interface SimulatedScene {
  readonly index: number;
  readonly scene: Scene;
  readonly startMs: number;
  readonly endMs: number;
  readonly facts: SceneFacts;
  readonly caption: string;
  /** False when the engine refused or rejected an action of the scene. */
  readonly accepted: boolean;
}

export function snapshotOf(state: AppState): Snapshot {
  return { state, view: derive(state) };
}

/** True when the reducer applied the action (an exhume the engine rejected, or one it refused, is not). */
function applied(before: AppState, after: AppState, action: Action): boolean {
  if (action.type === 'board/reset' || action.type === 'sound/set' || action.type === 'state/restore') return true;
  if (after === before) return false; // the reducer ignored it (a value it did not understand, or one that changes nothing)
  return after.change.kind === 'done';
}

export function simulateTour(script: Script, initial: AppState): readonly SimulatedScene[] {
  const result: SimulatedScene[] = [];
  let state = initial;
  let first: Snapshot | null = null;
  let clock = 0;
  script.forEach((scene, index) => {
    const before = snapshotOf(state);
    let accepted = true;
    for (const action of scene.actions) {
      const next = reducer(state, { type: 'tour/step', action }); // the same wrapper the player uses: the tour writes no chronicle
      // A reserve that is already the reserve changes nothing; that is not a refusal.
      const unchanged = next === state && action.type === 'reserve/set';
      if (!unchanged && !applied(state, next, action)) accepted = false;
      state = next;
    }
    const after = snapshotOf(state);
    if (first === null) first = after;
    const facts: SceneFacts = { first, before, after };
    result.push({ index, scene, startMs: clock, endMs: clock + scene.durationMs, facts, caption: scene.caption(facts), accepted });
    clock += scene.durationMs;
  });
  return result;
}

export { totalMs } from './duration';
