// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { importCsv } from '../../src/engine/index';
import type { Board } from '../../src/engine/index';
import { FOG_ON_SETTLE_FROM } from '../../src/ui/fog-cache';
import { sampleBoard } from '../../src/ui/sample-board';
import { FOG_UPDATING } from '../../src/ui/text';
import { byFocus, drag, mountWith, region, release } from './harness';
import type { Harness } from './harness';

// Plan B of the fog spec: on a board of more than 30 tickets, while the candle is being dragged, the fog is not worked out for every step. The sign
// keeps the last figures, says they are being updated, and fills them in when the drag settles.

const calls = vi.hoisted(() => ({ fog: 0 }));
vi.mock('../../src/engine/index', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/engine/index')>();
  return {
    ...mod,
    fogCurve: (...args: Parameters<typeof mod.fogCurve>) => {
      calls.fog++;
      return mod.fogCurve(...args);
    },
  };
});

afterEach(() => {
  document.body.replaceChildren();
});

/** A board of `n` tickets that the importer made (so it is valid), on the sample's team. */
function bigBoard(n: number): Board {
  const rows = Array.from({ length: n }, (_, i) => `T-${i},Ticket ${i},${1 + ((i * 7) % 9)},${3 + ((i * 5) % 11)}`);
  const base = sampleBoard();
  const r = importCsv(['Issue key,Summary,Story Points,Cost of Delay', ...rows].join('\n'), { people: base.people, timeZone: base.timeZone, nextReleaseWeeks: 2, zombieThreshold: 3 });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.board;
}

const block = (h: Harness): HTMLElement => region(h.root, 'fog');
const sentence = (h: Harness): string => block(h).querySelector('.fog-sentence')?.textContent ?? '';
const candle = (h: Harness): HTMLInputElement => byFocus(h.root, 'candle') as HTMLInputElement;
const reserve = (h: Harness): HTMLInputElement => byFocus(h.root, 'reserve') as HTMLInputElement;

function dragCandle(h: Harness, step: number): void {
  drag(candle(h), step);
  h.frame.flush();
}

describe('plan B (a board of more than 30 tickets)', () => {
  test('the threshold is 30, and the sample board (19 tickets) is below it', () => {
    expect(FOG_ON_SETTLE_FROM).toBe(30);
    expect(sampleBoard().tickets.length).toBeLessThan(FOG_ON_SETTLE_FROM);
  });

  test('the first figures of a board are never withheld', () => {
    const h = mountWith(bigBoard(40));
    expect(block(h).hasAttribute('data-stale')).toBe(false);
    expect(sentence(h)).toContain('It held on');
  });

  test('during a drag the fog is not worked out: the sign keeps the last figures, marked stale, and says "updating"', () => {
    const h = mountWith(bigBoard(40));
    const figure = block(h).querySelector('.fog-figure')?.textContent;
    const before = calls.fog;
    dragCandle(h, 8);
    dragCandle(h, 6);
    dragCandle(h, 4);
    expect(calls.fog).toBe(before);
    expect(block(h).getAttribute('data-stale')).toBe('true');
    expect(sentence(h)).toBe(FOG_UPDATING);
    expect(block(h).querySelector('.fog-figure')?.textContent).toBe(figure);
    expect(h.app.store.getState().candle).toBe(4);
  });

  test('when the drag settles (300 ms, or its end) the figures are worked out once and the mark goes', () => {
    const h = mountWith(bigBoard(40));
    dragCandle(h, 6);
    dragCandle(h, 4);
    const before = calls.fog;
    h.timers.advance(300);
    expect(calls.fog).toBe(before + 1);
    expect(block(h).hasAttribute('data-stale')).toBe(false);
    expect(sentence(h)).toContain('It held on');
    expect(sentence(h)).not.toBe(FOG_UPDATING);
  });

  test('the end of the drag (the change event) settles it at once', () => {
    const h = mountWith(bigBoard(40));
    dragCandle(h, 5);
    expect(block(h).getAttribute('data-stale')).toBe('true');
    release(candle(h));
    expect(block(h).hasAttribute('data-stale')).toBe(false);
  });

  test('a step already worked out is shown at once, even during a drag', () => {
    const h = mountWith(bigBoard(40));
    dragCandle(h, 5);
    h.timers.advance(300);
    dragCandle(h, 7);
    expect(block(h).getAttribute('data-stale')).toBe('true');
    h.timers.advance(300);
    const before = calls.fog;
    dragCandle(h, 5);
    expect(calls.fog).toBe(before);
    expect(block(h).hasAttribute('data-stale')).toBe(false);
  });

  test('what is spoken is the same as ever: the note and the verdict, never "updating"', () => {
    const h = mountWith(bigBoard(40));
    dragCandle(h, 5);
    dragCandle(h, 3);
    h.timers.advance(300);
    h.frame.flush();
    const spoken = region(h.root, 'announcer').textContent ?? '';
    expect(spoken).toContain('Candle moved to');
    expect(spoken).not.toContain(FOG_UPDATING);
  });

  test('the reserve slider needs no new figures: dragging it computes nothing and marks nothing', () => {
    const h = mountWith(bigBoard(40));
    const before = calls.fog;
    drag(reserve(h), 10);
    h.frame.flush();
    drag(reserve(h), 20);
    h.frame.flush();
    expect(calls.fog).toBe(before);
    expect(block(h).hasAttribute('data-stale')).toBe(false);
    h.timers.advance(300);
    expect(h.app.store.getState().marginPct).toBe(20);
  });

  test('a button (an exhume, a person away) works the figures out at once: there is no drag', () => {
    const h = mountWith(bigBoard(40));
    const before = calls.fog;
    byFocus(h.root, 'survivor:Ana').click();
    expect(calls.fog).toBe(before + 1);
    expect(block(h).hasAttribute('data-stale')).toBe(false);
  });
});

describe('the sample board is as it was', () => {
  test('every step of a drag works its figures out, and nothing is ever marked or says "updating"', () => {
    const h = mountWith();
    const before = calls.fog;
    for (const step of [8, 6, 4, 2]) {
      dragCandle(h, step);
      expect(block(h).hasAttribute('data-stale')).toBe(false);
      expect(sentence(h)).not.toBe(FOG_UPDATING);
    }
    expect(calls.fog).toBe(before + 4);
    h.timers.advance(300);
  });
});
