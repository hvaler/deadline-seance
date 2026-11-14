// @vitest-environment jsdom
import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { initialState, reducer } from '../../src/ui/state';
import type { Action, AppState } from '../../src/ui/state';
import { createStore } from '../../src/ui/store';
import { createPlayer } from '../../src/ui/tour/player';
import type { Player, TourHost } from '../../src/ui/tour/player';
import { restoreInto } from '../../src/ui/tour/restore';
import { sampleScript } from '../../src/ui/tour/sample-script';
import { simulateTour, totalMs } from '../../src/ui/tour/simulate';
import type { Phase, Script, Show } from '../../src/ui/tour/types';
import { arbMeaningfulAction, statesAfter } from './arbitraries';
import type { Timers } from '../../src/ui/services';
import { FakeTimers } from './harness';

// The player with the real reducer and store, fake timers and a host that writes down everything it is asked to do.

type Event =
  | { kind: 'act'; action: Action }
  | { kind: 'scene'; index: number; total: number; caption: string }
  | { kind: 'spot'; ids: readonly string[] }
  | { kind: 'show'; show: Show }
  | { kind: 'restore' }
  | { kind: 'phase'; phase: Phase }
  | { kind: 'progress'; elapsed: number; total: number };

interface Rig {
  readonly store: ReturnType<typeof createStore<AppState, Action>>;
  readonly timers: FakeTimers;
  readonly events: Event[];
  readonly player: Player;
}

function rig(script: Script = sampleScript, start: AppState = initialState()): Rig {
  const store = createStore(reducer, start);
  const timers = new FakeTimers();
  const events: Event[] = [];
  const host: TourHost = {
    getState: () => store.getState(),
    act(action) {
      events.push({ kind: 'act', action });
      store.dispatch(action);
    },
    restore(state) {
      events.push({ kind: 'restore' });
      restoreInto(store, state);
    },
    show: (show) => void events.push({ kind: 'show', show }),
    spot: (ids) => void events.push({ kind: 'spot', ids }),
    scene: (info) => void events.push({ kind: 'scene', ...info }),
    progress: (elapsed, total) => void events.push({ kind: 'progress', elapsed, total }),
    phase: (phase) => void events.push({ kind: 'phase', phase }),
  };
  return { store, timers, events, player: createPlayer({ script, host, timers }) };
}

const scenesOf = (events: readonly Event[]) => events.filter((e): e is Extract<Event, { kind: 'scene' }> => e.kind === 'scene');

describe('playing', () => {
  test('runs the scenes in order, with the captions and the state the simulation says, and ends after the total time', () => {
    const r = rig();
    const sim = simulateTour(sampleScript, initialState());
    const afterEach: AppState[] = [];
    // read the state at the moment each scene is announced
    const original = r.events.push.bind(r.events);
    r.events.push = (...items: Event[]) => {
      for (const e of items) if (e.kind === 'scene') afterEach.push(r.store.getState());
      return original(...items);
    };
    r.player.start();
    expect(r.player.phase).toBe('playing');
    r.timers.advance(totalMs(sampleScript) - 100);
    expect(r.player.phase).toBe('playing');
    r.timers.advance(100);
    expect(r.player.phase).toBe('ended');
    expect(scenesOf(r.events).map((s) => s.caption)).toEqual(sim.map((s) => s.caption));
    expect(scenesOf(r.events).map((s) => [s.index, s.total])).toEqual(sim.map((s) => [s.index, 12]));
    expect(afterEach).toHaveLength(sim.length);
    afterEach.forEach((state, i) => expect(state, sim[i]?.scene.id).toEqual(sim[i]?.facts.after.state));
  });

  test('a scene lasts its duration, to the tick: not a tick shorter, not a tick longer', () => {
    const r = rig();
    r.player.start();
    expect(scenesOf(r.events)).toHaveLength(1);
    r.timers.advance(5400);
    expect(scenesOf(r.events)).toHaveLength(1);
    r.timers.advance(100);
    expect(scenesOf(r.events)).toHaveLength(2);
    r.timers.advance(6400);
    expect(scenesOf(r.events)).toHaveLength(2);
    r.timers.advance(100);
    expect(scenesOf(r.events)).toHaveLength(3);
  });

  test('every scene shows its part of the page, and rings its tickets after its actions, never before', () => {
    const r = rig();
    r.player.start();
    r.timers.advance(totalMs(sampleScript));
    const shows = r.events.filter((e) => e.kind === 'show').map((e) => (e as { show: Show }).show);
    expect(shows).toEqual(sampleScript.map((s) => s.show));
    // for the scene that puts HB-112 down and the one that exhumes HB-108: act, then scene, then spot
    const order = r.events.filter((e) => e.kind === 'act' || e.kind === 'spot').map((e) => (e.kind === 'act' ? e.action.type : `spot:${e.ids.join('+')}`));
    expect(order.indexOf('tombstone/exhume')).toBeLessThan(order.indexOf('spot:card:HB-108'));
    expect(order.indexOf('spot:tomb:HB-112')).toBeGreaterThan(order.indexOf('survivor/toggle'));
    expect(r.events.some((e) => e.kind === 'spot' && e.ids.length === 0)).toBe(true);
  });

  test('the progress runs from 0 to the total', () => {
    const r = rig();
    r.player.start();
    r.timers.advance(totalMs(sampleScript));
    const progress = r.events.filter((e): e is Extract<Event, { kind: 'progress' }> => e.kind === 'progress');
    expect(progress[0]).toMatchObject({ elapsed: 0, total: 57000 });
    expect(progress.at(-1)).toMatchObject({ elapsed: 57000, total: 57000 });
    for (let i = 1; i < progress.length; i++) expect(progress[i]!.elapsed).toBeGreaterThanOrEqual(progress[i - 1]!.elapsed);
  });

  test('two runs do the same thing (deterministic)', () => {
    const a = rig();
    const b = rig();
    for (const r of [a, b]) {
      r.player.start();
      r.timers.advance(20_000);
      r.player.pause();
      r.timers.advance(5000);
      r.player.resume();
      r.timers.advance(40_000);
    }
    expect(a.events).toEqual(b.events);
  });

  test('start does nothing while it is already running, and nothing for an empty script', () => {
    const r = rig();
    r.player.start();
    r.timers.advance(3000);
    r.player.start();
    expect(scenesOf(r.events)).toHaveLength(1);
    expect(r.timers.pending).toBe(2); // the end of the scene, and the tick of the progress line
    const empty = rig([]);
    empty.player.start();
    expect(empty.player.phase).toBe('idle');
    expect(empty.events).toEqual([]);
  });
});

describe('pause, resume and skip', () => {
  test('pause stops the clock where it is and resume continues with what was left', () => {
    const r = rig();
    r.player.start();
    r.timers.advance(3000);
    r.player.pause();
    expect(r.player.phase).toBe('paused');
    expect(r.timers.pending).toBe(0);
    r.timers.advance(100_000);
    expect(scenesOf(r.events)).toHaveLength(1);
    r.player.resume();
    expect(r.player.phase).toBe('playing');
    r.timers.advance(2400);
    expect(scenesOf(r.events)).toHaveLength(1);
    r.timers.advance(100);
    expect(scenesOf(r.events)).toHaveLength(2);
  });

  test('pause and resume are ignored in the wrong phase', () => {
    const r = rig();
    r.player.pause();
    r.player.resume();
    expect(r.events).toEqual([]);
    r.player.start();
    r.player.resume();
    expect(r.player.phase).toBe('playing');
  });

  test('skip applies the next scene at once and gives it its whole time', () => {
    const r = rig();
    r.player.start();
    r.timers.advance(1000);
    r.player.skip();
    expect(scenesOf(r.events)).toHaveLength(2);
    r.timers.advance(6400);
    expect(scenesOf(r.events)).toHaveLength(2);
    r.timers.advance(100);
    expect(scenesOf(r.events)).toHaveLength(3);
  });

  test('skip while paused applies the next scene and stays paused', () => {
    const r = rig();
    r.player.start();
    r.timers.advance(1000);
    r.player.pause();
    r.player.skip();
    expect(r.player.phase).toBe('paused');
    expect(scenesOf(r.events)).toHaveLength(2);
    expect(r.timers.pending).toBe(0);
    r.player.resume();
    r.timers.advance(6500);
    expect(scenesOf(r.events)).toHaveLength(3);
  });

  test('skipping the last scene ends the tour and restores the user\'s state', () => {
    const start = statesAfter([{ type: 'candle/set', step: 3 }, { type: 'reserve/set', pct: 25 }]).at(-1)!;
    const r = rig(sampleScript, start);
    r.player.start();
    for (let i = 0; i < sampleScript.length; i++) r.player.skip();
    expect(r.player.phase).toBe('ended');
    expect(r.store.getState()).toBe(start);
  });

  test('skip does nothing before start or after the end', () => {
    const r = rig();
    r.player.skip();
    expect(r.events).toEqual([]);
  });
});

describe('the user\'s own state comes back', () => {
  test('stop in the middle puts back the very same state object, clears the ring and goes idle', () => {
    const start = statesAfter([{ type: 'tombstone/put-down', key: 'HB-110' }, { type: 'survivor/toggle', name: 'Dev' }, { type: 'candle/set', step: 7 }]).at(-1)!;
    const r = rig(sampleScript, start);
    r.player.start();
    r.timers.advance(30_000);
    expect(r.store.getState()).not.toBe(start);
    r.player.stop();
    expect(r.player.phase).toBe('idle');
    expect(r.store.getState()).toBe(start);
    expect(r.timers.pending).toBe(0);
    expect(r.events.at(-2)).toEqual({ kind: 'restore' });
    expect(r.events.filter((e) => e.kind === 'spot').at(-1)).toEqual({ kind: 'spot', ids: [] });
  });

  test('the end puts it back too, and stop on the end screen only closes it (nothing is restored twice)', () => {
    const start = initialState();
    const r = rig(sampleScript, start);
    r.player.start();
    r.timers.advance(totalMs(sampleScript));
    expect(r.player.phase).toBe('ended');
    expect(r.store.getState()).toBe(start);
    const restores = r.events.filter((e) => e.kind === 'restore').length;
    r.player.stop();
    expect(r.player.phase).toBe('idle');
    expect(r.events.filter((e) => e.kind === 'restore')).toHaveLength(restores);
  });

  test('over generated sessions, running to the end or stopping at any tick gives back the very same state object', () => {
    fc.assert(
      fc.property(fc.array(arbMeaningfulAction, { maxLength: 10 }), fc.integer({ min: 0, max: 620 }), (actions, ticks) => {
        const start = statesAfter(actions).at(-1)!;
        const r = rig(sampleScript, start);
        r.player.start();
        r.timers.advance(ticks * 100);
        r.player.stop();
        expect(r.store.getState()).toBe(start);
        expect(r.timers.pending).toBe(0);
      }),
      { numRuns: 60 },
    );
  });

  test('a tour that runs to the end from any generated session also gives it back', () => {
    fc.assert(
      fc.property(fc.array(arbMeaningfulAction, { maxLength: 10 }), (actions) => {
        const start = statesAfter(actions).at(-1)!;
        const r = rig(sampleScript, start);
        r.player.start();
        r.timers.advance(totalMs(sampleScript));
        expect(r.player.phase).toBe('ended');
        expect(r.store.getState()).toBe(start);
      }),
      { numRuns: 30 },
    );
  });

  test('the first scene starts from the plain night whatever the user had', () => {
    const start = statesAfter([{ type: 'candle/set', step: 2 }, { type: 'reserve/set', pct: 30 }, { type: 'tombstone/put-down', key: 'HB-112' }]).at(-1)!;
    const r = rig(sampleScript, start);
    const seen: AppState[] = [];
    const original = r.events.push.bind(r.events);
    r.events.push = (...items: Event[]) => {
      for (const e of items) if (e.kind === 'scene') seen.push(r.store.getState());
      return original(...items);
    };
    r.player.start();
    expect(seen[0]).toMatchObject({ candle: 10, marginPct: 0, away: [] });
    expect(seen[0]?.board.wontDo).toEqual([]);
  });

  test('a sound setting changed during the tour is kept; the rest is the user\'s', () => {
    const start = initialState();
    const r = rig(sampleScript, start);
    r.player.start();
    r.timers.advance(10_000);
    r.store.dispatch({ type: 'sound/set', on: true });
    r.player.stop();
    expect(r.store.getState()).toEqual({ ...start, sound: true });
    expect(r.store.getState().board).toBe(start.board);
  });

  test('restoreInto gives the snapshot itself when sound did not change', () => {
    const start = initialState();
    const store = createStore(reducer, start);
    store.dispatch({ type: 'candle/set', step: 2 });
    restoreInto(store, start);
    expect(store.getState()).toBe(start);
  });
});

describe('play again, dispose, and scenes that are only data', () => {
  test('play again runs the whole script once more from the restored state', () => {
    const start = initialState();
    const r = rig(sampleScript, start);
    r.player.start();
    r.timers.advance(totalMs(sampleScript));
    r.player.start();
    expect(r.player.phase).toBe('playing');
    expect(scenesOf(r.events).at(-1)?.index).toBe(0);
    r.timers.advance(totalMs(sampleScript));
    expect(r.player.phase).toBe('ended');
    expect(r.store.getState()).toBe(start);
    expect(scenesOf(r.events)).toHaveLength(24);
  });

  test('dispose clears the timer and the ring and restores nothing', () => {
    const r = rig();
    r.player.start();
    r.timers.advance(5000);
    r.player.dispose();
    expect(r.timers.pending).toBe(0);
    expect(r.events.some((e) => e.kind === 'restore')).toBe(false);
    expect(r.events.at(-1)).toEqual({ kind: 'spot', ids: [] });
  });

  test('a script made of other scenes needs no change to the player', () => {
    const script: Script = [
      { id: 'a', actions: [{ type: 'candle/set', step: 5 }], caption: ({ after }) => `candle ${after.state.candle}`, durationMs: 1000, show: 'candle' },
      { id: 'b', actions: [], caption: () => 'nothing happens', durationMs: 500, show: 'top', spot: ['card:HB-101'] },
      { id: 'c', actions: [{ type: 'survivor/toggle', name: 'Dev' }, { type: 'reserve/set', pct: 5 }], caption: ({ first, after }) => `${first.state.candle} ${after.state.marginPct}`, durationMs: 700, show: 'sign' },
    ];
    const r = rig(script);
    r.player.start();
    r.timers.advance(2200);
    expect(r.player.phase).toBe('ended');
    expect(scenesOf(r.events).map((s) => s.caption)).toEqual(['candle 5', 'nothing happens', '5 5']);
    expect(r.store.getState().candle).toBe(10);
  });
});

describe('a browser\'s timers are always a little late', () => {
  /** Timers on a virtual clock that fire every timer `late` milliseconds after it was due, as a busy page does. */
  class LateTimers implements Timers {
    clock = 0;
    private next = 1;
    private readonly timers = new Map<number, { at: number; callback: () => void }>();
    constructor(private readonly late: number) {}
    set(callback: () => void, ms: number): number {
      const id = this.next++;
      this.timers.set(id, { at: this.clock + ms + this.late, callback });
      return id;
    }
    clear(id: number): void {
      this.timers.delete(id);
    }
    runWhile(keepGoing: () => boolean): void {
      while (keepGoing() && this.timers.size > 0) {
        const [id, timer] = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]!;
        this.timers.delete(id);
        this.clock = timer.at;
        timer.callback();
      }
    }
  }

  test('lateness is paid once per scene, not once per tick: with every timer 5 ms late the run is 60 ms longer, not 2.8 s', () => {
    const store = createStore(reducer, initialState());
    const timers = new LateTimers(5);
    const host: TourHost = {
      getState: () => store.getState(),
      act: (action) => store.dispatch(action),
      restore: (state) => restoreInto(store, state),
      show: () => {},
      spot: () => {},
      scene: () => {},
      progress: () => {},
      phase: () => {},
    };
    const player = createPlayer({ script: sampleScript, host, timers });
    player.start();
    timers.runWhile(() => player.phase === 'playing');
    expect(player.phase).toBe('ended');
    expect(timers.clock).toBeGreaterThanOrEqual(totalMs(sampleScript));
    expect(timers.clock).toBeLessThanOrEqual(totalMs(sampleScript) + 12 * 5 + 5);
  });
});