import type { Ctx, Part } from '../context';
import { el, setAttr, setText } from '../dom';
import { PRODUCT_LINE } from '../sample-board';
import { TAGLINE } from '../text';

/**
 * The title card: the product line, the big title, "Play the night" (an empty slot until the tour exists) and the sound switch. Sound is
 * off until the user turns it on; the audio context is created inside that click, which is the user gesture browsers require.
 */

export const TITLE = 'Night of the Living Backlog';

export function mountTitleCard(header: HTMLElement, ctx: Ctx): Part {
  const soundButton = el('button', {
    class: 'button sound-button',
    attrs: { type: 'button', 'aria-pressed': 'false' },
    data: { action: 'sound', focus: 'sound' },
    text: 'Sound off',
    on: {
      click: () => {
        const next = !ctx.store.getState().sound;
        ctx.services.sound.setEnabled(next); // inside the click: this is where the audio context is created
        ctx.store.dispatch({ type: 'sound/set', on: next });
      },
    },
  });
  const tourSlot = el('button', {
    class: 'button slot',
    attrs: { type: 'button', disabled: true, 'aria-describedby': 'slot-note-tour' },
    data: { slot: 'tour' },
    text: 'Play the night · 60 s',
  });

  header.append(
    el('p', { class: 'product-line', text: PRODUCT_LINE }),
    el('h1', { class: 'title', text: TITLE }),
    el('p', { class: 'tagline', text: TAGLINE }),
    el('div', { class: 'title-actions' }, [tourSlot, soundButton]),
    el('p', { id: 'slot-note-tour', class: 'slot-note', text: 'The guided tour is not built yet.' }),
  );

  return {
    update(_view, state) {
      setText(soundButton, state.sound ? 'Sound on' : 'Sound off');
      setAttr(soundButton, 'aria-pressed', state.sound ? 'true' : 'false');
      // Turning sound off from anywhere else also silences the player. Turning it on happens only inside the click above.
      if (!state.sound && ctx.services.sound.enabled) ctx.services.sound.setEnabled(false);
    },
  };
}
