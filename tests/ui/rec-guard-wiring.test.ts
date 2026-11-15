// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { REC_AWAY } from '../../src/ui/atmosphere/rec-guard';
import { sampleScript } from '../../src/ui/tour/sample-script';
import { destroyMounted, mountWith } from './harness';

// The REC corner looks again when the app has mounted and whenever the tour's bar or the "Press Space" prompt appears or goes.
// No scroll or resize event is fired here: only the app's own wiring can make the corner move.

function box(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.matches('[data-decor="rec"]')) return box(16, 12, 174, 33);
    if (this.matches('.tour-bar, .tour-prompt')) return box(0, 0, 360, 80); // right under the corner
    return box(0, 0, 0, 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  destroyMounted();
});

function rec(root: HTMLElement): HTMLElement {
  const node = root.querySelector<HTMLElement>('[data-decor="rec"]');
  if (node === null) throw new Error('the REC corner is missing');
  return node;
}

describe('the REC guard in the app', () => {
  test('checks once after mount: a prompt from #play that is already under the corner hides it', () => {
    const h = mountWith(undefined, {}, { tour: sampleScript, hash: '#play' });
    expect(h.root.querySelector('.tour-prompt')).not.toBeNull();
    expect(rec(h.root).classList.contains(REC_AWAY)).toBe(true);
  });

  test('checks when the prompt goes', () => {
    const h = mountWith(undefined, {}, { tour: sampleScript, hash: '#play' });
    h.root.querySelector<HTMLElement>('[data-action="tour-prompt-close"]')?.click();
    expect(h.root.querySelector('.tour-prompt')).toBeNull();
    expect(rec(h.root).classList.contains(REC_AWAY)).toBe(false);
  });

  test('checks when the tour bar appears and when it goes', () => {
    const h = mountWith(undefined, {}, { tour: sampleScript });
    expect(rec(h.root).classList.contains(REC_AWAY)).toBe(false);
    if (h.app.tour === null) throw new Error('the app should have a tour');
    h.app.tour.start();
    expect(h.root.querySelector('.tour-bar')).not.toBeNull();
    expect(rec(h.root).classList.contains(REC_AWAY)).toBe(true);
    h.app.tour.stop();
    expect(h.root.querySelector('.tour-bar')).toBeNull();
    expect(rec(h.root).classList.contains(REC_AWAY)).toBe(false);
  });
});
