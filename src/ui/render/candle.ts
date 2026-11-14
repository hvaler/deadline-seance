import type { Ctx, Part } from '../context';
import { el, setAttr, setClass, setText } from '../dom';
import { createGesture } from '../gestures';
import { count } from '../text';

/**
 * The candle: a melting candle whose wax height follows the freeze, and the range input that moves it, one half day per step. The notches
 * under the input show the capacity at every position, from `capacityBetween`. The drawing and the notches are decoration (`aria-hidden`):
 * everything they say is also in the readout and in the input's `aria-valuetext`.
 */

export const CANDLE_INPUT_ID = 'candle-input';

export function mountCandle(section: HTMLElement, ctx: Ctx): Part {
  const flame = el('div', { class: 'candle-flame' });
  const wax = el('div', { class: 'candle-wax' }, [el('span', { class: 'candle-drip candle-drip-1' }), el('span', { class: 'candle-drip candle-drip-2' })]);
  const art = el('div', { class: 'candle-art', attrs: { 'aria-hidden': 'true' } }, [flame, el('div', { class: 'candle-wick' }), wax, el('div', { class: 'candle-pool' })]);

  const time = el('strong', { class: 'candle-time num' });
  const capacity = el('span', { class: 'candle-capacity num' });
  const effective = el('span', { class: 'candle-effective num' });
  const readout = el('p', { class: 'candle-readout' }, [time, ' · ', capacity, ' · ', effective]);

  const input = el('input', {
    class: 'range candle-range',
    id: CANDLE_INPUT_ID,
    attrs: { type: 'range', min: 0, max: 10, step: 1, value: 10 },
    data: { focus: 'candle' },
  });
  const notches = el('ol', { class: 'notches', attrs: { 'aria-hidden': 'true' } });

  const controls = el('div', { class: 'candle-controls' }, [
    el('label', { class: 'candle-label', attrs: { for: CANDLE_INPUT_ID }, text: 'Freeze time' }),
    readout,
    input,
    notches,
  ]);
  section.append(el('div', { class: 'candle-layout' }, [art, controls]));

  const gesture = createGesture({
    store: ctx.store,
    frame: ctx.services.frame,
    timers: ctx.services.timers,
    toAction: (step) => ({ type: 'candle/set', step }),
    subjectOf: (start, end) => (start.candle === end.candle ? null : { kind: 'candle', from: start.candle, to: end.candle }),
    onSettle: (change, end) => ctx.settle(change, end),
    onActive: (active) => ctx.gestureActive(active),
  });
  input.addEventListener('input', () => gesture.input(Number(input.value)));
  input.addEventListener('change', () => gesture.commit());

  return {
    update(view, state) {
      const { candle } = view;
      const last = candle.notches.length - 1;

      setText(time, candle.label);
      setText(capacity, count(candle.capacity, 'point'));
      setText(effective, `${candle.effectiveCapacity} after the ${state.marginPct} % reserve`);

      if (!gesture.active && input.value !== String(candle.step)) input.value = String(candle.step);
      setAttr(input, 'max', last);
      setAttr(input, 'aria-valuetext', `${candle.label}, ${count(candle.capacity, 'point')}, ${candle.effectiveCapacity} after the reserve`);

      // Layout arithmetic only: how much of the candle is left, as a fraction of its height.
      art.style.setProperty('--wax', String(last === 0 ? 1 : candle.step / last));

      // One notch per position, built once and then only updated.
      while (notches.children.length < candle.notches.length) {
        notches.append(el('li', { class: 'notch' }, [el('span', { class: 'notch-tick' }), el('span', { class: 'notch-capacity num' })]));
      }
      candle.notches.forEach((n, i) => {
        const item = notches.children[i] as HTMLElement;
        setText(item.lastElementChild as HTMLElement, String(n.capacity));
        setClass(item, 'is-current', n.step === candle.step);
        setClass(item, 'is-past', n.step < candle.step);
        setAttr(item, 'data-step', n.step);
        setAttr(item, 'data-label', n.label);
      });
    },
    destroy: () => gesture.destroy(),
  };
}
