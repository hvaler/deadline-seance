import { describe, expect, test } from 'vitest';
import { SETTLE_MS, createGesture } from '../../src/ui/gestures';
import type { Gesture } from '../../src/ui/gestures';
import { initialState, reducer } from '../../src/ui/state';
import type { Action, AppState, Change } from '../../src/ui/state';
import { createStore } from '../../src/ui/store';
import { FakeFrame, FakeTimers } from './harness';

function setup() {
  const store = createStore<AppState, Action>(reducer, initialState());
  const frame = new FakeFrame();
  const timers = new FakeTimers();
  const settled: { change: Change; end: AppState }[] = [];
  const notifications: number[] = [];
  store.subscribe((s) => notifications.push(s.candle));
  const gesture: Gesture = createGesture({
    store,
    frame,
    timers,
    toAction: (step) => ({ type: 'candle/set', step }),
    subjectOf: (start, end) => (start.candle === end.candle ? null : { kind: 'candle', from: start.candle, to: end.candle }),
    onSettle: (change, end) => settled.push({ change, end }),
  });
  return { store, frame, timers, settled, notifications, gesture };
}

describe('a gesture', () => {
  test('applies the latest value once per frame, however many inputs came', () => {
    const { gesture, frame, notifications } = setup();
    for (const step of [9, 8, 7, 6, 5]) gesture.input(step);
    expect(notifications).toEqual([]); // nothing yet: the frame has not come
    expect(frame.pending).toBe(1);
    frame.flush();
    expect(notifications).toEqual([5]);
  });

  test('another frame is requested for the next burst', () => {
    const { gesture, frame, notifications } = setup();
    gesture.input(9);
    frame.flush();
    gesture.input(8);
    gesture.input(7);
    frame.flush();
    expect(notifications).toEqual([9, 7]);
  });

  test('settles 300 ms after the last input, with the change from the start to the end', () => {
    const { gesture, frame, timers, settled, store } = setup();
    expect(SETTLE_MS).toBe(300);
    gesture.input(9);
    frame.flush();
    timers.advance(200);
    gesture.input(6);
    frame.flush();
    timers.advance(299);
    expect(settled).toHaveLength(0);
    timers.advance(1);
    expect(settled).toHaveLength(1);
    const { change, end } = settled[0]!;
    expect(end).toBe(store.getState());
    expect(change).toMatchObject({ kind: 'done', subject: { kind: 'candle', from: 10, to: 6 }, comparison: { kind: 'diff' } });
    expect(gesture.active).toBe(false);
  });

  test('commit settles at once, applying what is still pending', () => {
    const { gesture, timers, settled, store, frame } = setup();
    gesture.input(4);
    expect(gesture.active).toBe(true);
    gesture.commit();
    expect(store.getState().candle).toBe(4);
    expect(settled).toHaveLength(1);
    expect(timers.pending).toBe(0);
    expect(frame.pending).toBe(0);
  });

  test('a gesture that ends where it started settles with nothing to say', () => {
    const { gesture, frame, settled } = setup();
    gesture.input(8);
    frame.flush();
    gesture.input(10);
    frame.flush();
    gesture.commit();
    expect(settled).toEqual([]);
  });

  test('a new gesture after a settled one compares from its own start', () => {
    const { gesture, frame, settled } = setup();
    gesture.input(8);
    gesture.commit();
    gesture.input(3);
    gesture.commit();
    frame.flush();
    expect(settled.map((s) => s.change)).toMatchObject([
      { subject: { from: 10, to: 8 } },
      { subject: { from: 8, to: 3 } },
    ]);
  });

  test('is active only between the first input and the settle', () => {
    const { gesture, timers } = setup();
    expect(gesture.active).toBe(false);
    gesture.input(7);
    expect(gesture.active).toBe(true);
    timers.advance(300);
    expect(gesture.active).toBe(false);
  });

  test('commit with nothing pending and nothing started does nothing', () => {
    const { gesture, settled } = setup();
    gesture.commit();
    expect(settled).toEqual([]);
  });

  test('destroy drops the timer and the frame', () => {
    const { gesture, frame, timers, settled, store } = setup();
    gesture.input(2);
    gesture.destroy();
    expect(frame.pending).toBe(0);
    expect(timers.pending).toBe(0);
    timers.advance(1000);
    frame.flush();
    expect(settled).toEqual([]);
    expect(store.getState().candle).toBe(10);
  });

  test('values the reducer ignores still settle quietly', () => {
    const { gesture, frame, settled, notifications } = setup();
    gesture.input(99);
    frame.flush();
    gesture.commit();
    expect(notifications).toEqual([]);
    expect(settled).toEqual([]);
  });
});
