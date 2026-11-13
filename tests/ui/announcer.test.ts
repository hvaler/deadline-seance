// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { createAnnouncer } from '../../src/ui/announcer';
import { FakeFrame } from './harness';

function setup() {
  const polite = document.createElement('div');
  const assertive = document.createElement('div');
  const frame = new FakeFrame();
  return { polite, assertive, frame, announcer: createAnnouncer(polite, assertive, frame) };
}

describe('announcer', () => {
  test('says a sentence in the polite region, a frame after clearing it', () => {
    const { polite, assertive, frame, announcer } = setup();
    announcer.say('Candle moved to Fri 13:00.');
    expect(polite.textContent).toBe(''); // cleared first, so the same sentence is read again
    frame.flush();
    expect(polite.textContent).toBe('Candle moved to Fri 13:00.');
    expect(assertive.textContent).toBe('');
  });

  test('an alert goes to the assertive region and empties the polite one', () => {
    const { polite, assertive, frame, announcer } = setup();
    announcer.say('one');
    frame.flush();
    announcer.alert('HB-119 stays in the ground.');
    expect(polite.textContent).toBe('');
    frame.flush();
    expect(assertive.textContent).toBe('HB-119 stays in the ground.');
    expect(polite.textContent).toBe('');
  });

  test('only the latest sentence is spoken when several come in one frame', () => {
    const { polite, frame, announcer } = setup();
    announcer.say('first');
    announcer.say('second');
    frame.flush();
    expect(polite.textContent).toBe('second');
  });

  test('saying the same sentence twice clears it in between, so it is announced twice', () => {
    const { polite, frame, announcer } = setup();
    announcer.say('same');
    frame.flush();
    announcer.say('same');
    expect(polite.textContent).toBe('');
    frame.flush();
    expect(polite.textContent).toBe('same');
  });

  test('clear empties both regions and drops what was waiting', () => {
    const { polite, assertive, frame, announcer } = setup();
    announcer.say('waiting');
    announcer.clear();
    frame.flush();
    expect(polite.textContent).toBe('');
    expect(assertive.textContent).toBe('');
  });

  test('text is text: markup in a sentence stays text', () => {
    const { polite, frame, announcer } = setup();
    announcer.say('<img src=x onerror=alert(1)>');
    frame.flush();
    expect(polite.children).toHaveLength(0);
    expect(polite.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
