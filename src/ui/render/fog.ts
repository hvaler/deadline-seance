import type { View } from '../derive';
import { el, setAttr, setText } from '../dom';
import { FOG_NO_CUT, fogHeadline, fogImpossibleSentence, fogSentence, stripItemText } from '../text';

/**
 * The fog of estimates on the sign: a strip under the reserve slider with the chance at every reserve step, and a block with the painted
 * figure and the sentence of the current one. Everything shown comes from `view.fog` (the engine); this file only places it. No text enters
 * as markup, and nothing here ranks, colours by threshold or promises that more reserve helps.
 *
 * The strip is a list for assistive technology: each item reads as one sentence. Its visible parts (reserve, bar, chance, "now") are hidden
 * from it, so nothing is read twice. It has no focus and no action: the slider is the control.
 */
export interface FogParts {
  /** An ordered list of seven items, to go under the reserve slider. */
  readonly strip: HTMLElement;
  /** The painted figure and the sentence, to go where the old slot was. */
  readonly block: HTMLElement;
  update(view: View): void;
}

interface StripItem {
  readonly item: HTMLElement;
  readonly reserve: HTMLElement;
  readonly fill: HTMLElement;
  readonly number: HTMLElement;
  readonly percent: HTMLElement;
  readonly now: HTMLElement;
  readonly spoken: HTMLElement;
}

export const FOG_HEADLINE_ID = 'fog-headline';

function createItem(): StripItem {
  const reserve = el('span', { class: 'strip-reserve', attrs: { 'aria-hidden': 'true' } });
  const fill = el('span', { class: 'strip-fill' });
  // The number and its percent sign are two lines (the sign smaller, under the number), so seven of them fit a phone; the text still reads "34 %".
  const number = el('span', { class: 'strip-number' });
  const percent = el('span', { class: 'strip-percent' });
  const chance = el('span', { class: 'strip-chance num', attrs: { 'aria-hidden': 'true' } }, [number, percent]);
  const now = el('span', { class: 'strip-now', attrs: { 'aria-hidden': 'true' } });
  const spoken = el('span', { class: 'visually-hidden' });
  const item = el('li', { class: 'strip-item' }, [
    reserve,
    el('span', { class: 'strip-bar', attrs: { 'aria-hidden': 'true' } }, [fill]),
    chance,
    now,
    spoken,
  ]);
  return { item, reserve, fill, number, percent, now, spoken };
}

export function createFog(): FogParts {
  const items = Array.from({ length: 7 }, createItem);
  const strip = el('ol', { class: 'fog-strip', attrs: { role: 'list', 'aria-label': 'Chance the shelter holds, at each reserve' }, data: { region: 'fog-strip' } }, items.map((i) => i.item));

  const lead = el('span', { class: 'fog-lead' });
  const figure = el('span', { class: 'fog-figure', data: { fog: 'figure' } });
  const tail = el('span', { class: 'fog-tail' });
  const headline = el('p', { class: 'fog-headline', id: FOG_HEADLINE_ID }, [lead, ' ', figure, ' ', tail]);
  const sentence = el('p', { class: 'fog-sentence' });
  const block = el('section', { class: 'fog-block', attrs: { 'aria-labelledby': FOG_HEADLINE_ID }, data: { region: 'fog' } }, [headline, sentence]);

  return {
    strip,
    block,
    update(view) {
      const fog = view.fog;
      setAttr(strip, 'hidden', fog === null);
      setAttr(block, 'hidden', fog === null);
      if (fog === null) return;

      items.forEach((parts, index) => {
        const point = fog.points[index];
        if (point === undefined) return;
        const isCurrent = index === fog.currentIndex;
        setText(parts.reserve, `${point.marginPct} %`);
        setText(parts.number, point.fog === null ? '—' : String(point.fog.pct));
        setText(parts.percent, point.fog === null ? '' : ' %');
        // The bar is drawn from the engine's percentage; CSS turns it into a scale (layout only).
        parts.fill.style.setProperty('--pct', String(point.fog === null ? 0 : point.fog.pct));
        setText(parts.now, isCurrent ? 'now' : '');
        setText(parts.spoken, stripItemText(point, isCurrent));
        setAttr(parts.item, 'aria-current', isCurrent ? 'true' : null);
        setAttr(parts.item, 'data-reserve', String(point.marginPct));
        setAttr(parts.item, 'data-state', point.status);
      });

      const current = fog.currentIndex === null ? undefined : fog.points[fog.currentIndex];
      if (current === undefined) {
        setText(lead, FOG_NO_CUT);
        setText(figure, '');
        setText(tail, '');
        setAttr(figure, 'hidden', true);
        setText(sentence, '');
      } else if (current.status === 'ok') {
        const h = fogHeadline(current);
        setText(lead, h.lead);
        setText(figure, h.figure);
        setText(tail, h.tail);
        setAttr(figure, 'hidden', false);
        setText(sentence, fogSentence(current));
      } else {
        setText(lead, FOG_NO_CUT);
        setText(figure, '');
        setText(tail, '');
        setAttr(figure, 'hidden', true);
        setText(sentence, fogImpossibleSentence(current));
      }
    },
  };
}
