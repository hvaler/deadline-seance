// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { byFocus, mountWith } from './harness';

afterEach(() => {
  document.body.replaceChildren();
});

describe('the sound button and the player', () => {
  test('sound starts off: the player is off and nothing is played', () => {
    const { root, sound } = mountWith();
    expect(sound.enabled).toBe(false);
    byFocus(root, 'exhume:HB-108').click();
    byFocus(root, 'survivor:Ana').click();
    expect(sound.played).toEqual([]);
    expect(sound.toggles).toEqual([]);
  });

  test('pressing "Sound off" turns the player on inside the click, and the state follows', () => {
    const { root, app, sound } = mountWith();
    byFocus(root, 'sound').click();
    expect(sound.toggles).toEqual([true]);
    expect(sound.enabled).toBe(true);
    expect(app.store.getState().sound).toBe(true);
    expect(byFocus(root, 'sound').textContent).toBe('Sound on');
    expect(byFocus(root, 'sound').getAttribute('aria-pressed')).toBe('true');
  });

  test('pressing it again turns the player off', () => {
    const { root, app, sound } = mountWith();
    byFocus(root, 'sound').click();
    byFocus(root, 'sound').click();
    expect(sound.toggles).toEqual([true, false]);
    expect(app.store.getState().sound).toBe(false);
  });

  test('the audio context is only ever created by that click: setting the state from elsewhere does not turn the player on', () => {
    const { app, sound } = mountWith();
    app.store.dispatch({ type: 'sound/set', on: true });
    expect(app.store.getState().sound).toBe(true);
    expect(sound.enabled).toBe(false);
    expect(sound.toggles).toEqual([]);
  });

  test('turning the state off from elsewhere silences a player that was on', () => {
    const { root, app, sound } = mountWith();
    byFocus(root, 'sound').click();
    app.store.dispatch({ type: 'sound/set', on: false });
    expect(sound.enabled).toBe(false);
  });
});

describe('what plays, when sound is on', () => {
  function withSound() {
    const h = mountWith();
    byFocus(h.root, 'sound').click();
    return h;
  }

  test('an exhume resurrects, a resurrect resurrects, a put down puts down', () => {
    const { root, sound } = withSound();
    byFocus(root, 'exhume:HB-108').click();
    byFocus(root, 'resurrect:HB-110').click();
    byFocus(root, 'put-down:HB-112').click();
    expect(sound.played).toEqual(['resurrect', 'resurrect', 'put-down']);
  });

  test('sending a survivor away buries; bringing them back is silent', () => {
    const { root, sound } = withSound();
    byFocus(root, 'survivor:Ana').click();
    expect(sound.played).toEqual(['bury']);
    byFocus(root, 'survivor:Ana').click();
    expect(sound.played).toEqual(['bury']);
  });

  test('a rejected exhume, a refusal and a reset are silent', () => {
    const { root, app, sound } = withSound();
    byFocus(root, 'exhume:HB-119').click();
    app.store.dispatch({ type: 'tombstone/put-down', key: 'HB-108' });
    byFocus(root, 'reset').click();
    expect(sound.played).toEqual([]);
  });

  test('one sound per change: the click makes one, not one per re-render', () => {
    const { root, sound } = withSound();
    byFocus(root, 'exhume:HB-108').click();
    expect(sound.played).toHaveLength(1);
  });
});
