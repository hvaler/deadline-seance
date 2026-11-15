import type { Frame } from '../services';
/**
 * Keeps the REC corner off the text it must never cover: the title card (product line, title, tagline, the two buttons) and the tour's bar
 * and prompt. The corner is fixed to the viewport, so a page scrolled a little at 360 or 320 px puts the title right under it. Whenever the
 * corner and one of those elements would overlap it fades out (`rec-away`, opacity only) and comes back when they no longer do.
 *
 * Reads only, then one class toggle, at most once per animation frame, and only on scroll, resize and when the tour's bar appears or goes.
 * It never changes layout.
 */
export const REC_AWAY = 'rec-away';
/** Space kept clear around the corner, in pixels. */
export const REC_MARGIN = 6;
export interface RecGuardDeps {
  readonly frame: Frame;
  /** Calls the listener when the page scrolls or is resized. Returns the function that stops listening. */
  readonly onMove: (listener: () => void) => () => void;
}
export interface RecGuard {
  /** Checks now (and not later): for when something appeared or went. */
  check(): void;
  /** Checks on the next animation frame. */
  schedule(): void;
  destroy(): void;
}
interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
function overlaps(a: Box, b: Box): boolean {
  if (b.right - b.left <= 0 || b.bottom - b.top <= 0) return false; // not drawn (hidden, or no layout)
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}
export function createRecGuard(rec: HTMLElement, avoid: () => readonly Element[], deps: RecGuardDeps): RecGuard {
  let pending: number | null = null;
  let away = false;
  function check(): void {
    const r = rec.getBoundingClientRect();
    const mine: Box = { left: r.left - REC_MARGIN, top: r.top - REC_MARGIN, right: r.right + REC_MARGIN, bottom: r.bottom + REC_MARGIN };
    const hit = avoid().some((node) => overlaps(mine, node.getBoundingClientRect()));
    if (hit === away) return;
    away = hit;
    rec.classList.toggle(REC_AWAY, hit);
  }
  function schedule(): void {
    if (pending !== null) return;
    pending = deps.frame.request(() => {
      pending = null;
      check();
    });
  }
  const stop = deps.onMove(schedule);
  return {
    check,
    schedule,
    destroy() {
      stop();
      if (pending !== null) deps.frame.cancel(pending);
      pending = null;
    },
  };
}
export function browserRecMove(): RecGuardDeps['onMove'] {
  return (listener) => {
    window.addEventListener('scroll', listener, { passive: true });
    window.addEventListener('resize', listener);
    return () => {
      window.removeEventListener('scroll', listener);
      window.removeEventListener('resize', listener);
    };
  };
}
