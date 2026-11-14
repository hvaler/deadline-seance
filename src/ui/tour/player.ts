import type { Timers } from '../services';
import type { Action, AppState } from '../state';
import { snapshotOf } from './simulate';
import type { Phase, Script, Show, Snapshot } from './types';
import { TICK_MS } from './types';

/**
 * The player: a small machine that runs a script. It knows no scene, no key, no number, and touches no page: everything it does to the
 * app goes through the host, so it runs the same in a test with fake timers as in the browser.
 *
 * Time is a count of ticks of the injected timers (`TICK_MS` each); no clock is read. Pausing is not scheduling the next tick.
 */
export interface TourHost {
  getState(): AppState;
  /** Dispatches as a user's action would be, except that nothing is spoken (the subtitle says it); the sound still plays. */
  act(action: Action): void;
  /** Puts the user's own state back (the host decides how: the tour never invents a state). */
  restore(state: AppState): void;
  show(show: Show): void;
  /** Rings these focus ids; replaces the previous ones; an empty list clears. */
  spot(ids: readonly string[]): void;
  scene(info: { readonly index: number; readonly total: number; readonly caption: string }): void;
  progress(elapsedMs: number, totalMs: number): void;
  phase(phase: Phase): void;
}

export interface Player {
  readonly phase: Phase;
  start(): void;
  pause(): void;
  resume(): void;
  skip(): void;
  /** Stops a running tour and restores the user's state; closes the end screen of a finished one. */
  stop(): void;
  /** The app goes away: clear the timer and the ring, restore nothing. */
  dispose(): void;
}

export function createPlayer(options: { readonly script: Script; readonly host: TourHost; readonly timers: Timers }): Player {
  const { script, host, timers } = options;
  const offsets: number[] = [];
  let total = 0;
  for (const scene of script) {
    offsets.push(total);
    total += scene.durationMs;
  }

  let phase: Phase = 'idle';
  let index = 0;
  /** Time spent in the scene, counted in ticks: it feeds the progress line and tells how much is left after a pause. */
  let sceneMs = 0;
  /** The timer that ends the scene: one per scene, so a browser's small lateness does not add up tick by tick. */
  let sceneTimer: number | null = null;
  let tickTimer: number | null = null;
  let snapshot: AppState | null = null;
  let first: Snapshot | null = null;

  function setPhase(next: Phase): void {
    phase = next;
    host.phase(next);
  }

  function clearTimers(): void {
    if (sceneTimer !== null) timers.clear(sceneTimer);
    if (tickTimer !== null) timers.clear(tickTimer);
    sceneTimer = null;
    tickTimer = null;
  }

  /** Starts the clocks of the current scene for `remainingMs`: one timer for its end, ticks for the progress. */
  function arm(remainingMs: number): void {
    sceneTimer = timers.set(endScene, Math.max(0, remainingMs));
    tickTimer = timers.set(tick, TICK_MS);
  }

  function applyScene(i: number): void {
    const scene = script[i];
    if (scene === undefined) return;
    index = i;
    sceneMs = 0;
    const before = snapshotOf(host.getState());
    for (const action of scene.actions) host.act(action);
    const after = snapshotOf(host.getState());
    if (first === null) first = after;
    const caption = scene.caption({ first, before, after });
    host.scene({ index: i, total: script.length, caption });
    host.spot(scene.spot ?? []); // after the actions, so the ticket to ring exists
    host.show(scene.show);
    host.progress(offsets[i] ?? 0, total);
  }

  function restore(): void {
    if (snapshot !== null) host.restore(snapshot);
  }

  function end(): void {
    clearTimers();
    host.spot([]);
    restore();
    host.progress(total, total);
    setPhase('ended');
  }

  function advance(): void {
    clearTimers();
    if (index + 1 < script.length) {
      applyScene(index + 1);
      if (phase === 'playing') arm(script[index]?.durationMs ?? 0);
    } else {
      end();
    }
  }

  function endScene(): void {
    sceneTimer = null;
    if (phase === 'playing') advance();
  }

  function tick(): void {
    tickTimer = null;
    if (phase !== 'playing') return;
    const duration = script[index]?.durationMs ?? 0;
    sceneMs = Math.min(sceneMs + TICK_MS, duration);
    host.progress((offsets[index] ?? 0) + sceneMs, total);
    if (sceneMs < duration) tickTimer = timers.set(tick, TICK_MS);
  }
  return {
    get phase() {
      return phase;
    },
    start() {
      if (phase === 'playing' || phase === 'paused' || script.length === 0) return;
      snapshot = host.getState();
      first = null;
      setPhase('playing');
      applyScene(0);
      arm(script[0]?.durationMs ?? 0);
    },
    pause() {
      if (phase !== 'playing') return;
      clearTimers();
      setPhase('paused');
    },
    resume() {
      if (phase !== 'paused') return;
      setPhase('playing');
      arm((script[index]?.durationMs ?? 0) - sceneMs);
    },
    skip() {
      if (phase !== 'playing' && phase !== 'paused') return;
      advance();
    },
    stop() {
      if (phase === 'playing' || phase === 'paused') {
        clearTimers();
        host.spot([]);
        restore();
        setPhase('idle');
      } else if (phase === 'ended') {
        setPhase('idle');
      }
    },
    dispose() {
      clearTimers();
      host.spot([]);
    },
  };
}
