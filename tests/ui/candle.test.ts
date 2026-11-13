// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { derive } from '../../src/ui/derive';
import { initialState, reducer } from '../../src/ui/state';
import { announcementText } from '../../src/ui/text';
import { drag, mountWith, region, release, texts } from './harness';

afterEach(() => {
  document.body.replaceChildren();
});

const input = (root: ParentNode) => root.querySelector<HTMLInputElement>('#candle-input')!;
const notches = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('.notches > li')];

describe('the candle: what it shows', () => {
  test('is a labelled range of eleven positions, one half day each, starting on Friday 18:00', () => {
    const { root } = mountWith();
    const range = input(root);
    expect(range.type).toBe('range');
    expect([range.min, range.max, range.step, range.value]).toEqual(['0', '10', '1', '10']);
    expect(root.querySelector('label[for="candle-input"]')?.textContent).toBe('Freeze time');
  });

  test('the readout has the time, the capacity and the capacity after the reserve', () => {
    const { root, app } = mountWith();
    expect(region(root, 'candle').querySelector('.candle-readout')?.textContent).toBe('Fri 18:00 · 59 points · 59 after the 0 % reserve');
    app.store.dispatch({ type: 'reserve/set', pct: 15 });
    app.store.dispatch({ type: 'candle/set', step: 6 });
    expect(region(root, 'candle').querySelector('.candle-readout')?.textContent).toBe('Wed 18:00 · 35 points · 29 after the 15 % reserve');
  });

  test('aria-valuetext says the same in one phrase', () => {
    const { root, app } = mountWith();
    expect(input(root).getAttribute('aria-valuetext')).toBe('Fri 18:00, 59 points, 59 after the reserve');
    app.store.dispatch({ type: 'candle/set', step: 1 });
    expect(input(root).getAttribute('aria-valuetext')).toBe('Mon 13:00, 6 points, 6 after the reserve');
    app.store.dispatch({ type: 'survivor/toggle', name: 'Ana' });
    expect(input(root).getAttribute('aria-valuetext')).toBe('Mon 13:00, 4 points, 4 after the reserve');
    app.store.dispatch({ type: 'candle/set', step: 0 });
    expect(input(root).getAttribute('aria-valuetext')).toBe('Mon 09:00, 0 points, 0 after the reserve');
  });

  test('one point is singular', () => {
    const { root, app } = mountWith();
    for (const name of ['Ana', 'Bruno', 'Carla']) app.store.dispatch({ type: 'survivor/toggle', name });
    app.store.dispatch({ type: 'candle/set', step: 1 });
    expect(input(root).getAttribute('aria-valuetext')).toBe('Mon 13:00, 1 point, 1 after the reserve');
  });

  test('the notches show the capacity at every position, from the engine, and mark where the candle is', () => {
    const { root, app } = mountWith();
    expect(texts(notches(root).map((n) => n.querySelector('.notch-capacity')!))).toEqual(['0', '6', '12', '18', '24', '30', '35', '41', '47', '53', '59']);
    expect(notches(root).map((n) => n.dataset.label)).toEqual([
      'Mon 09:00', 'Mon 13:00', 'Mon 18:00', 'Tue 13:00', 'Tue 18:00', 'Wed 13:00', 'Wed 18:00', 'Thu 13:00', 'Thu 18:00', 'Fri 13:00', 'Fri 18:00',
    ]);
    expect(notches(root).filter((n) => n.classList.contains('is-current')).map((n) => n.dataset.step)).toEqual(['10']);

    app.store.dispatch({ type: 'candle/set', step: 4 });
    expect(notches(root).filter((n) => n.classList.contains('is-current')).map((n) => n.dataset.step)).toEqual(['4']);
    expect(notches(root).filter((n) => n.classList.contains('is-past')).length).toBe(4);

    app.store.dispatch({ type: 'survivor/toggle', name: 'Ana' });
    expect(texts(notches(root).map((n) => n.querySelector('.notch-capacity')!)).at(-1)).toBe('39');
  });

  test('the notches and the drawing are decoration: hidden from assistive technology', () => {
    const { root } = mountWith();
    expect(root.querySelector('.notches')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('.candle-art')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('.candle-art')?.querySelector('button, input, a')).toBeNull();
  });

  test('the wax height follows the freeze: all of it on Friday 18:00, none-but-the-stub on Monday 09:00', () => {
    const { root, app } = mountWith();
    const art = root.querySelector<HTMLElement>('.candle-art')!;
    expect(art.style.getPropertyValue('--wax')).toBe('1');
    app.store.dispatch({ type: 'candle/set', step: 5 });
    expect(art.style.getPropertyValue('--wax')).toBe('0.5');
    app.store.dispatch({ type: 'candle/set', step: 0 });
    expect(art.style.getPropertyValue('--wax')).toBe('0');
  });

  test('the input follows the state when it changes from elsewhere', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 3 });
    expect(input(root).value).toBe('3');
    app.store.dispatch({ type: 'board/reset' });
    expect(input(root).value).toBe('10');
  });
});

describe('the candle: moving it', () => {
  test('many inputs in one frame cost one change', () => {
    const { root, app, frame } = mountWith();
    let updates = 0;
    app.store.subscribe(() => updates++);
    for (const step of [9, 8, 7, 6, 5, 4]) drag(input(root), step);
    expect(updates).toBe(0);
    expect(frame.pending).toBe(1);
    frame.flush();
    expect(updates).toBe(1);
    expect(app.store.getState().candle).toBe(4);
  });

  test('the cut, the note and the readout follow each step of a drag', () => {
    const { root, app, frame } = mountWith();
    drag(input(root), 9);
    frame.flush();
    expect(region(root, 'change').querySelector('.change-headline')?.textContent).toBe('Candle moved to Fri 13:00.');
    drag(input(root), 6);
    frame.flush();
    expect(region(root, 'change').querySelector('.change-headline')?.textContent).toBe('Candle moved to Wed 18:00.');
    expect(app.store.getState().candle).toBe(6);
    expect(region(root, 'candle').querySelector('.candle-time')?.textContent).toBe('Wed 18:00');
  });

  test('the input is not pulled back while the drag is still going', () => {
    const { root, app } = mountWith();
    drag(input(root), 6); // the frame has not come yet
    app.store.dispatch({ type: 'sound/set', on: true }); // some other change re-renders the page
    expect(input(root).value).toBe('6');
  });

  test('the announcement waits 300 ms after the last input and describes the drag from where it began to where it ended', () => {
    const { root, app, frame, timers } = mountWith();
    drag(input(root), 9);
    frame.flush();
    timers.advance(100);
    drag(input(root), 8);
    frame.flush();
    timers.advance(100);
    drag(input(root), 6);
    frame.flush();
    timers.advance(299);
    frame.flush();
    expect(region(root, 'announcer').textContent).toBe('');
    timers.advance(1);
    frame.flush();

    const expected = reducer(initialState(), { type: 'candle/set', step: 6 });
    const text = region(root, 'announcer').textContent;
    expect(text).toBe(announcementText(expected.change, derive(app.store.getState())));
    expect(text.startsWith('Candle moved to Wed 18:00.')).toBe(true);
    // The text names the start-to-end diff: Friday 18:00 against Wednesday 18:00, not the last step alone.
    expect(text).toContain('Sinks: HB-105 (11), HB-113 (14), HB-115 (13), HB-118 (16); together 54. Loss: 54. Saved cod 167 → 113.');
    expect(text).not.toContain('Candle moved to Thu');
  });

  test('exactly one announcement per gesture', () => {
    const { root, frame, timers } = mountWith();
    const heard: string[] = [];
    const watch = new MutationObserver(() => heard.push(region(root, 'announcer').textContent));
    watch.observe(region(root, 'announcer'), { childList: true, characterData: true, subtree: true });
    for (const step of [9, 8, 7, 6]) {
      drag(input(root), step);
      frame.flush();
      timers.advance(100);
    }
    frame.flush();
    expect(region(root, 'announcer').textContent).toBe('');
    timers.advance(300);
    frame.flush();
    expect(region(root, 'announcer').textContent).toContain('Candle moved to Wed 18:00.');
    watch.disconnect();
  });

  test('releasing the control settles at once, and a key press (input then change) announces immediately', () => {
    const { root, frame, timers } = mountWith();
    drag(input(root), 9);
    release(input(root));
    frame.flush();
    expect(region(root, 'announcer').textContent).toContain('Candle moved to Fri 13:00.');
    expect(timers.pending).toBe(0);
  });

  test('a gesture that ends where it started says nothing', () => {
    const { root, frame } = mountWith();
    drag(input(root), 8);
    frame.flush();
    drag(input(root), 10);
    frame.flush();
    release(input(root));
    frame.flush();
    expect(region(root, 'announcer').textContent).toBe('');
  });

  test('a gesture into an impossible freeze is an alert, with the numbers', () => {
    const { root, frame } = mountWith();
    drag(input(root), 2);
    release(input(root));
    frame.flush();
    expect(region(root, 'alerter').textContent).toContain('The must-haves need 15 points; there are 12');
    expect(region(root, 'announcer').textContent).toBe('');
  });

  test('the sound of a drag plays once, when it settles: a cascade when a chain falls, a bury otherwise', () => {
    const { root, app, frame, sound } = mountWith();
    sound.enabled = true;
    app.store.dispatch({ type: 'sound/set', on: true });
    drag(input(root), 9);
    frame.flush();
    drag(input(root), 8);
    frame.flush();
    expect(sound.played).toEqual([]); // nothing yet: the gesture has not settled
    release(input(root));
    expect(sound.played).toHaveLength(1);
    expect(['bury', 'cascade']).toContain(sound.played[0]);

    sound.played.length = 0;
    drag(input(root), 5); // Thu 18:00 to Wed 13:00 sinks HB-104, HB-106 and HB-107: HB-106 and HB-107 fall behind HB-104
    frame.flush();
    release(input(root));
    expect(sound.played).toEqual(['cascade']);
  });

  test('moving back to the right only raises tickets, so it is silent', () => {
    const { root, app, frame, sound } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 3 });
    sound.enabled = true;
    app.store.dispatch({ type: 'sound/set', on: true });
    drag(input(root), 10);
    frame.flush();
    release(input(root));
    expect(sound.played).toEqual([]);
  });

  test('the candle is a native range input, so the arrow keys, Home and End work without code', () => {
    const { root } = mountWith();
    expect(input(root).tagName).toBe('INPUT');
    expect(input(root).getAttribute('type')).toBe('range');
    expect(input(root).getAttribute('tabindex')).toBeNull();
    expect(input(root).disabled).toBe(false);
  });

  test('destroy stops the pending timer and frame', () => {
    const { root, app, frame, timers } = mountWith();
    drag(input(root), 3);
    app.destroy();
    expect(frame.pending).toBe(0);
    expect(timers.pending).toBe(0);
  });
});
