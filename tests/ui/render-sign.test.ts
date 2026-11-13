// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { derive } from '../../src/ui/derive';
import { initialState, reducer } from '../../src/ui/state';
import { announcementText, changeNote, verdictSentences } from '../../src/ui/text';
import { byFocus, drag, mountWith, region, release, texts } from './harness';

afterEach(() => {
  document.body.replaceChildren();
});

const verdictOf = (root: ParentNode): string[] => texts(region(root, 'verdict').querySelectorAll('p'));
const noteOf = (root: ParentNode) => {
  const note = region(root, 'change');
  return {
    headline: note.querySelector('.change-headline')?.textContent ?? '',
    lines: texts(note.querySelectorAll('li')),
    alert: note.dataset.alert,
    kind: note.dataset.kind,
  };
};

describe('the sign: verdict', () => {
  test('says what is inside and what is left outside, from the engine totals', () => {
    const { root } = mountWith();
    expect(verdictOf(root)).toEqual(['Inside the safehouse: 12 tickets, 59 of 59 points, saved cod 167. Left outside: 7 tickets, cod 101.']);
    expect(verdictOf(root)).toEqual(verdictSentences(derive(initialState())));
  });

  test('follows the state: a reserve adds the capacity sentence', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'reserve/set', pct: 15 });
    expect(verdictOf(root)).toEqual([
      'Inside the safehouse: 10 tickets, 49 of 50 points, saved cod 147. Left outside: 9 tickets, cod 121.',
      'Capacity 59, 15 % reserve.',
    ]);
  });

  test('an impossible freeze says what the must-haves need, with the numbers, and what to do', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 2 });
    expect(verdictOf(root)).toEqual([
      'The must-haves need 15 points; there are 12 (12 after the 0 % reserve).',
      'Move the candle later, or drop a must-have.',
    ]);
    expect(root.querySelector('.sign-board')?.classList.contains('is-impossible')).toBe(true);
    app.store.dispatch({ type: 'candle/set', step: 10 });
    expect(root.querySelector('.sign-board')?.classList.contains('is-impossible')).toBe(false);
  });

  test('the sign itself is not a live region: what is heard comes from the announcer', () => {
    const { root } = mountWith();
    const sign = region(root, 'sign');
    expect(sign.querySelector('[aria-live], [role="alert"], [role="status"]')).toBeNull();
  });
});

describe('the sign: change note', () => {
  test('before anything moves', () => {
    const { root } = mountWith();
    expect(noteOf(root)).toEqual({ headline: 'Nothing has moved yet.', lines: [], alert: 'false', kind: 'none' });
  });

  test('shows the last change with its numbers, one sentence per line, tagged by kind', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 9 });
    expect(noteOf(root)).toEqual({
      headline: 'Candle moved to Fri 13:00.',
      lines: ['Sinks: HB-115 (13).', 'Loss: 13.', 'Saved cod 167 → 154.'],
      alert: 'false',
      kind: 'done',
    });
    expect([...region(root, 'change').querySelectorAll('li')].map((li) => (li as HTMLElement).dataset.kind)).toEqual(['sinks', 'loss', 'info']);
  });

  test('is always the engine diff of the last action', () => {
    const { root, app } = mountWith();
    for (const action of [
      { type: 'survivor/toggle', name: 'Ana' },
      { type: 'reserve/set', pct: 10 },
      { type: 'tombstone/exhume', key: 'HB-108' },
    ] as const) {
      app.store.dispatch(action);
      const shown = noteOf(root);
      const expected = changeNote(app.store.getState().change);
      expect(shown.headline).toBe(expected.headline);
      expect(shown.lines).toEqual([...expected.lines]);
    }
  });

  test('a rejected exhume is drawn as an alert with the numbers, and the board stays as it was', () => {
    const { root, app } = mountWith();
    const before = app.store.getState().board;
    byFocus(root, 'exhume:HB-119').click();
    expect(noteOf(root)).toEqual({
      headline: 'HB-119 stays in the ground.',
      lines: ['The must-haves with HB-119 need 63 points; there are 59 (59 after the 0 % reserve).', 'Move the candle later, or drop a must-have.'],
      alert: 'true',
      kind: 'rejected',
    });
    expect(app.store.getState().board).toBe(before);
  });

  test('a refused action is an alert too', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'tombstone/put-down', key: 'HB-108' });
    expect(noteOf(root)).toMatchObject({ headline: 'Nothing was done.', lines: ['HB-108 is not a zombie, so it cannot be put down.'], alert: 'true' });
    app.store.dispatch({ type: 'candle/set', step: 9 });
    expect(noteOf(root).alert).toBe('false');
  });

  test('says there is no comparison when the freeze is impossible', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 1 });
    expect(noteOf(root).lines).toEqual(['No comparison: the freeze is impossible (needs 15 points; 6 available).']);
  });
});

describe('the sign: what is announced', () => {
  test('a button action is announced politely, once, with the change and then the verdict', () => {
    const { root, app, frame } = mountWith();
    byFocus(root, 'exhume:HB-108').click();
    frame.flush();
    const state = app.store.getState();
    expect(region(root, 'announcer').textContent).toBe(announcementText(state.change, derive(state)));
    expect(region(root, 'announcer').textContent).toContain('HB-108 exhumed.');
    expect(region(root, 'alerter').textContent).toBe('');
  });

  test('a rejected exhume goes to the alert region, and the polite one is empty', () => {
    const { root, frame } = mountWith();
    byFocus(root, 'exhume:HB-119').click();
    frame.flush();
    expect(region(root, 'alerter').textContent).toContain('HB-119 stays in the ground.');
    expect(region(root, 'alerter').textContent).toContain('need 63 points');
    expect(region(root, 'announcer').textContent).toBe('');
  });

  test('an action that makes the freeze impossible is also an alert', () => {
    const { root, frame, app } = mountWith();
    for (const name of ['Ana', 'Bruno', 'Carla', 'Dev']) {
      byFocus(root, `survivor:${name}`).click();
    }
    frame.flush();
    expect(app.store.getState().away).toHaveLength(4);
    expect(region(root, 'alerter').textContent).toContain('The must-haves need 15 points; there are 0');
  });

  test('an ignored action says nothing', () => {
    const { app, frame, root } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 10 });
    frame.flush();
    expect(region(root, 'announcer').textContent).toBe('');
  });
});

describe('the sign: the reserve', () => {
  const inputOf = (root: ParentNode) => root.querySelector<HTMLInputElement>('#reserve-input')!;

  test('is a labelled range from 0 to 30 in steps of 5, with its percentage in an output', () => {
    const { root } = mountWith();
    const input = inputOf(root);
    expect(input.type).toBe('range');
    expect([input.min, input.max, input.step, input.value]).toEqual(['0', '30', '5', '0']);
    expect(root.querySelector('label[for="reserve-input"]')?.textContent).toBe('Reserve');
    const output = root.querySelector('output');
    expect(output?.textContent).toBe('0 %');
    expect(output?.getAttribute('for')).toBe('reserve-input');
    expect(input.getAttribute('aria-valuetext')).toBe('0 percent, 59 points after the reserve');
  });

  test('moving it sets the margin, one change per frame, and the readouts follow', () => {
    const { root, app, frame } = mountWith();
    const input = inputOf(root);
    drag(input, 5);
    drag(input, 10);
    drag(input, 15);
    expect(app.store.getState().marginPct).toBe(0); // not yet: the frame has not come
    frame.flush();
    expect(app.store.getState().marginPct).toBe(15);
    expect(root.querySelector('output')?.textContent).toBe('15 %');
    expect(input.getAttribute('aria-valuetext')).toBe('15 percent, 50 points after the reserve');
    expect(verdictOf(root)[1]).toBe('Capacity 59, 15 % reserve.');
  });

  test('the spoken announcement waits for the value to settle and describes the whole drag', () => {
    const { root, app, frame, timers } = mountWith();
    const input = inputOf(root);
    drag(input, 5);
    frame.flush();
    drag(input, 30);
    frame.flush();
    timers.advance(299);
    expect(region(root, 'announcer').textContent).toBe('');
    timers.advance(1);
    frame.flush();
    const expectedState = reducer(initialState(), { type: 'reserve/set', pct: 30 });
    expect(region(root, 'announcer').textContent).toBe(announcementText(expectedState.change, derive(app.store.getState())));
    expect(region(root, 'announcer').textContent).toContain('Reserve set to 30 %.');
    expect(region(root, 'announcer').textContent).toContain('Sinks: HB-115 (13), HB-116 (7), HB-118 (16); together 36.');
  });

  test('releasing the control settles at once', () => {
    const { root, frame, timers } = mountWith();
    const input = inputOf(root);
    drag(input, 20);
    release(input);
    frame.flush();
    expect(region(root, 'announcer').textContent).toContain('Reserve set to 20 %.');
    expect(timers.pending).toBe(0);
  });

  test('a sound plays once at settle, only when sound is on', () => {
    const quiet = mountWith();
    drag(quiet.root.querySelector<HTMLInputElement>('#reserve-input')!, 15);
    release(quiet.root.querySelector<HTMLInputElement>('#reserve-input')!);
    expect(quiet.sound.played).toEqual([]);

    document.body.replaceChildren();
    const loud = mountWith();
    loud.sound.enabled = true;
    loud.app.store.dispatch({ type: 'sound/set', on: true });
    const input = inputOf(loud.root);
    drag(input, 5);
    drag(input, 15);
    loud.frame.flush();
    release(input);
    expect(loud.sound.played).toEqual(['bury']);
  });

  test('follows the state when it changes from elsewhere (a reset)', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'reserve/set', pct: 25 });
    expect(inputOf(root).value).toBe('25');
    byFocus(root, 'reset').click();
    expect(inputOf(root).value).toBe('0');
    expect(root.querySelector('output')?.textContent).toBe('0 %');
  });

  test('does not promise that more reserve keeps more: the hint only says what the reserve does', () => {
    const { root } = mountWith();
    const hint = root.querySelector('.reserve-hint')?.textContent ?? '';
    expect(hint).toBe('Keeps part of the capacity free, so the cut only fits what is left.');
    expect(root.textContent).not.toMatch(/survive|holds? in|safer|guarantee/i);
  });
});

describe('the sign: the empty slot for the fog of estimates', () => {
  test('says plainly that the survival odds are not built yet', () => {
    const { root } = mountWith();
    const slot = root.querySelector('[data-slot="fog"]');
    expect(slot?.textContent).toBe('Chance the shelter holds: not built yet.');
    expect(slot?.tagName).toBe('P');
  });
});
