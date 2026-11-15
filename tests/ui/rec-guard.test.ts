// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { REC_AWAY, REC_MARGIN, createRecGuard } from '../../src/ui/atmosphere/rec-guard';
import { FakeFrame } from './harness';
// The REC corner is fixed to the viewport; the title scrolls under it. The guard fades the corner while they would overlap.
afterEach(() => {
  document.body.replaceChildren();
});
function box(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) };
}
function rig() {
  const rec = document.createElement('div');
  const title = document.createElement('h1');
  document.body.append(rec, title);
  const corner = box(16, 12, 174, 33);
  let text = box(16, 78, 344, 142);
  rec.getBoundingClientRect = () => corner;
  title.getBoundingClientRect = () => text;
  const frame = new FakeFrame();
  const listeners = new Set<() => void>();
  const guard = createRecGuard(rec, () => [title], { frame, onMove: (l) => (listeners.add(l), () => void listeners.delete(l)) });
  return {
    rec,
    frame,
    guard,
    scrollTo(top: number) {
      text = box(16, top, 344, top + 64);
      for (const l of [...listeners]) l();
      frame.flush();
    },
    hideTitle() {
      text = box(0, 0, 0, 0);
    },
    listeners,
  };
}
describe('the REC guard', () => {
  test('stays visible while the title is clear of the corner, hides while it is under it, and comes back', () => {
    const r = rig();
    r.guard.check();
    expect(r.rec.classList.contains(REC_AWAY)).toBe(false);
    r.scrollTo(18); // the title scrolled up under the corner
    expect(r.rec.classList.contains(REC_AWAY)).toBe(true);
    r.scrollTo(-200); // and past it
    expect(r.rec.classList.contains(REC_AWAY)).toBe(false);
    r.scrollTo(78);
    expect(r.rec.classList.contains(REC_AWAY)).toBe(false);
  });
  test('keeps a margin: a title 3 px under the corner still counts as in the way', () => {
    const r = rig();
    r.scrollTo(33 + REC_MARGIN - 1);
    expect(r.rec.classList.contains(REC_AWAY)).toBe(true);
    r.scrollTo(33 + REC_MARGIN);
    expect(r.rec.classList.contains(REC_AWAY)).toBe(false);
  });
  test('an element that is not drawn (no size) is never in the way', () => {
    const r = rig();
    r.scrollTo(20);
    expect(r.rec.classList.contains(REC_AWAY)).toBe(true);
    r.hideTitle();
    for (const l of r.listeners) l();
    r.frame.flush();
    expect(r.rec.classList.contains(REC_AWAY)).toBe(false);
  });
  test('many scroll events in one frame make one check, and destroying stops everything', () => {
    const r = rig();
    for (let i = 0; i < 20; i++) for (const l of r.listeners) l();
    expect(r.frame.pending).toBe(1);
    r.guard.destroy();
    expect(r.listeners.size).toBe(0);
    expect(r.frame.pending).toBe(0);
  });
});
