import { validateBoard } from '../engine/index';
import type { Board, ValidationError } from '../engine/index';
import { el, setAttr, setText } from './dom';
import { renderInvalidBoard } from './render/invalid-board';
import { PRODUCT_LINE } from './sample-board';
import { initialStateFor, reducer } from './state';
import type { Action, AppState } from './state';
import { createStore } from './store';
import type { Store } from './store';

/**
 * Builds the page and keeps it in step with the state. A board that fails validation never reaches the state: the app shows the list of
 * problems instead (`render/invalid-board.ts`). The regions below start empty; later tasks fill them in, one concern each.
 */

export interface MountedBoard {
  readonly kind: 'board';
  readonly store: Store<AppState, Action>;
  readonly root: HTMLElement;
  destroy(): void;
}

export interface MountedInvalid {
  readonly kind: 'invalid';
  readonly errors: readonly ValidationError[];
  readonly root: HTMLElement;
  destroy(): void;
}

export type MountedApp = MountedBoard | MountedInvalid;

/** The sections of the page, top to bottom, as `data-region` names. */
export const REGIONS = ['sign', 'candle', 'survivors', 'safehouse', 'yard', 'tools'] as const;
export type Region = (typeof REGIONS)[number];

function section(region: Region, headingId: string, heading: string, extra: { id?: string; focusable?: boolean } = {}): HTMLElement {
  return el(
    'section',
    {
      id: extra.id,
      class: `region region-${region}`,
      attrs: { 'aria-labelledby': headingId, tabindex: extra.focusable === true ? -1 : undefined },
      data: { region },
    },
    [el('h2', { id: headingId, text: heading })],
  );
}

export function mountApp(root: HTMLElement, board: Board): MountedApp {
  const checked = validateBoard(board);
  if (!checked.ok) {
    renderInvalidBoard(root, checked.error);
    return { kind: 'invalid', errors: checked.error, root, destroy: () => root.replaceChildren() };
  }

  const store = createStore(reducer, initialStateFor(checked.value));

  // ---- the page ----
  const soundButton = el('button', {
    class: 'button sound-button',
    attrs: { type: 'button', 'aria-pressed': 'false' },
    data: { action: 'sound', focus: 'sound' },
    text: 'Sound off',
    on: { click: () => store.dispatch({ type: 'sound/set', on: !store.getState().sound }) },
  });
  const tourSlot = el('button', {
    class: 'button slot',
    attrs: { type: 'button', disabled: true, 'aria-describedby': 'slot-note-tour' },
    data: { slot: 'tour' },
    text: 'Play the night · 60 s',
  });

  const announcer = el('div', { class: 'visually-hidden', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' }, data: { region: 'announcer' } });
  const atmosphere = el('div', { class: 'atmosphere', attrs: { 'aria-hidden': 'true' }, data: { region: 'atmosphere' } });

  const page = el('div', { class: 'page' }, [
    el('a', { class: 'skip-link', attrs: { href: '#safehouse' }, text: 'Skip to the safehouse' }),
    atmosphere,
    el('header', { class: 'title-card' }, [
      el('p', { class: 'product-line', text: PRODUCT_LINE }),
      el('h1', { text: 'Night of the Living Backlog' }),
      el('div', { class: 'title-actions' }, [
        tourSlot,
        el('span', { id: 'slot-note-tour', class: 'slot-note', text: 'The guided tour is not built yet.' }),
        soundButton,
      ]),
    ]),
    el('main', { id: 'main' }, [
      section('sign', 'h-verdict', 'Verdict'),
      section('candle', 'h-candle', 'The candle'),
      section('survivors', 'h-survivors', 'Survivors'),
      el('div', { class: 'grounds' }, [
        section('safehouse', 'h-safehouse', 'Inside the safehouse', { id: 'safehouse', focusable: true }),
        section('yard', 'h-yard', 'Left outside', { id: 'yard', focusable: true }),
      ]),
      section('tools', 'h-tools', 'Tools'),
    ]),
    announcer,
  ]);
  root.replaceChildren(page);

  // ---- keeping the page in step with the state ----
  function render(state: AppState): void {
    setText(soundButton, state.sound ? 'Sound on' : 'Sound off');
    setAttr(soundButton, 'aria-pressed', state.sound ? 'true' : 'false');
  }
  render(store.getState());
  const stop = store.subscribe(render);

  return {
    kind: 'board',
    store,
    root,
    destroy() {
      stop();
      root.replaceChildren();
    },
  };
}
