import type { Ctx, Part } from '../context';
import { el, setAttr, setClass, setText } from '../dom';
import { createGesture } from '../gestures';
import { changeNote, verdictSentences } from '../text';

/**
 * The taped plywood sign: the verdict, what the last change did, and the reserve slider. It has no live region of its own: what a screen
 * reader hears comes from the announcer, once per settled change. A rejected exhume is drawn as an alert (`data-alert`), and the same
 * sentences reach assistive technology through the assertive region.
 */

export const RESERVE_INPUT_ID = 'reserve-input';

function lineKind(text: string): string {
  const word = text.split(':')[0] ?? '';
  switch (word) {
    case 'Rises':
      return 'rises';
    case 'Sinks':
      return 'sinks';
    case 'Gain':
      return 'gain';
    case 'Loss':
      return 'loss';
    default:
      return 'info';
  }
}

/** Keeps `container` holding exactly one child per text, reusing the ones already there. */
function syncTexts(container: HTMLElement, tag: 'p' | 'li', texts: readonly string[], decorate?: (node: HTMLElement, text: string) => void): void {
  while (container.children.length > texts.length) container.lastElementChild?.remove();
  texts.forEach((text, i) => {
    let node = container.children[i] as HTMLElement | undefined;
    if (node === undefined) {
      node = el(tag);
      container.append(node);
    }
    setText(node, text);
    decorate?.(node, text);
  });
}

export function mountSign(section: HTMLElement, ctx: Ctx): Part {
  const verdict = el('div', { class: 'verdict', data: { region: 'verdict' } });
  const headline = el('p', { class: 'change-headline' });
  const lines = el('ul', { class: 'change-lines' });
  const note = el('div', { class: 'change-note', data: { region: 'change', alert: 'false', kind: 'none' } }, [headline, lines]);

  const input = el('input', {
    class: 'range reserve-range',
    id: RESERVE_INPUT_ID,
    attrs: { type: 'range', min: 0, max: 30, step: 5, value: 0 },
    data: { focus: 'reserve' },
  });
  const output = el('output', { class: 'reserve-output num', attrs: { for: RESERVE_INPUT_ID } });
  const reserve = el('div', { class: 'reserve' }, [
    el('label', { class: 'reserve-label', attrs: { for: RESERVE_INPUT_ID }, text: 'Reserve' }),
    output,
    input,
    el('p', { class: 'reserve-hint', text: 'Keeps part of the capacity free, so the cut only fits what is left.' }),
  ]);

  const fogSlot = el('p', { class: 'slot-text', data: { slot: 'fog' }, text: 'Chance the shelter holds: not built yet.' });

  const board = el('div', { class: 'sign-board' }, [verdict, note, reserve, fogSlot]);
  section.append(board);

  const gesture = createGesture({
    store: ctx.store,
    frame: ctx.services.frame,
    timers: ctx.services.timers,
    toAction: (pct) => ({ type: 'reserve/set', pct }),
    subjectOf: (start, end) => (start.marginPct === end.marginPct ? null : { kind: 'reserve', from: start.marginPct, to: end.marginPct }),
    onSettle: (change, end) => ctx.settle(change, end),
  });
  input.addEventListener('input', () => gesture.input(Number(input.value)));
  input.addEventListener('change', () => gesture.commit());

  return {
    update(view, state) {
      syncTexts(verdict, 'p', verdictSentences(view));
      setClass(board, 'is-impossible', view.solution.status === 'impossible');

      const shown = changeNote(state.change);
      setText(headline, shown.headline);
      syncTexts(lines, 'li', shown.lines, (node, text) => setAttr(node, 'data-kind', lineKind(text)));
      setAttr(note, 'data-alert', shown.alert ? 'true' : 'false');
      setAttr(note, 'data-kind', shown.kind);

      if (!gesture.active && input.value !== String(state.marginPct)) input.value = String(state.marginPct);
      setText(output, `${state.marginPct} %`);
      setAttr(input, 'aria-valuetext', `${state.marginPct} percent, ${view.candle.effectiveCapacity} points after the reserve`);
    },
    destroy: () => gesture.destroy(),
  };
}
