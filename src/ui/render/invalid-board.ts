import type { ValidationError } from '../../engine/index';
import { el } from '../dom';
import { PRODUCT_LINE } from '../sample-board';
import { count, describeValidationError } from '../text';

/**
 * The screen for a board that fails validation: every problem, in words, with the keys and values the engine reported. No tickets are
 * drawn and no cut is computed. Nothing here comes from a language model.
 */
export function renderInvalidBoard(root: HTMLElement, errors: readonly ValidationError[]): HTMLElement {
  const list = el(
    'ul',
    { class: 'board-problems', data: { region: 'board-problems' } },
    errors.map((error) => el('li', { text: describeValidationError(error), data: { code: error.code } })),
  );
  const screen = el('div', { class: 'invalid-board' }, [
    el('header', { class: 'title-card' }, [
      el('p', { class: 'product-line', text: PRODUCT_LINE }),
      el('h1', { text: 'Night of the Living Backlog' }),
    ]),
    el('main', { id: 'main' }, [
      el('section', { attrs: { 'aria-labelledby': 'h-invalid' }, data: { region: 'invalid-board' } }, [
        el('h2', { id: 'h-invalid', text: 'This board cannot be used' }),
        el('p', { text: `The board has ${count(errors.length, 'problem')}. Fix ${errors.length === 1 ? 'it' : 'them'} and load the board again.` }),
        list,
      ]),
    ]),
  ]);
  root.replaceChildren(screen);
  return screen;
}
