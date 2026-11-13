import { el } from '../dom';
import type { CanvasLike } from './fog';

/**
 * The decoration of the night: a faint moon, the fog canvas, a vignette, VHS scanlines, and the blinking "REC" with its timecode. All of it
 * lives inside the two `aria-hidden` layers of the page (behind the content, and above it), takes no pointer events, and carries no
 * information: everything the page says is in the text.
 */

export interface Decor {
  readonly canvas: HTMLCanvasElement;
  readonly timecode: HTMLElement;
}

export function createDecor(back: HTMLElement, front: HTMLElement): Decor {
  const canvas = el('canvas', { class: 'fog', data: { decor: 'fog' } });
  const timecode = el('span', { class: 'rec-time num', text: '00:00:00:00' });

  back.append(el('div', { class: 'moon', data: { decor: 'moon' } }), canvas);
  front.append(
    el('div', { class: 'vignette', data: { decor: 'vignette' } }),
    el('div', { class: 'scanlines', data: { decor: 'scanlines' } }),
    el('div', { class: 'rec', data: { decor: 'rec' } }, [el('span', { class: 'rec-dot', text: '●' }), el('span', { class: 'rec-text', text: 'REC' }), timecode]),
  );
  return { canvas, timecode };
}

/** The decoration canvas as the fog sees it. */
export function asCanvas(canvas: HTMLCanvasElement): CanvasLike {
  return canvas as unknown as CanvasLike;
}
