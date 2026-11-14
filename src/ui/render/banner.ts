import type { Ctx, Part } from '../context';
import { el, setAttr, setText } from '../dom';
import { MAX_RELEASE } from '../release';
import { bannerSentences } from '../text';

/**
 * The banner above the page while your own tickets are loaded: where they came from, what is still the sample's, how many closed issues were
 * skipped, the name of the release (editable: it names the death certificate and the export) and the way back to the sample board.
 * It is hidden on the built-in board.
 */
export interface BannerPart extends Part {
  readonly node: HTMLElement;
}

export function mountBanner(main: HTMLElement, ctx: Ctx): BannerPart {
  const lead = el('p', { class: 'source-lead' });
  const rest = el('p', { class: 'source-rest' });
  const notes = el('ul', { class: 'source-notes' });
  const input = el('input', {
    id: 'source-release',
    class: 'text-field',
    attrs: { type: 'text', maxlength: MAX_RELEASE, autocomplete: 'off' },
    data: { focus: 'release' },
  });
  const back = el('button', {
    class: 'button',
    attrs: { type: 'button' },
    data: { action: 'sample', focus: 'back-to-sample' },
    text: 'Back to the sample board',
    on: {
      click: () => {
        ctx.act({ type: 'board/sample' });
        // The banner is gone: the focus goes to where the next import starts.
        ctx.root.querySelector<HTMLElement>('[data-focus="csv-pick"]')?.focus();
      },
    },
  });
  const node = el(
    'div',
    { class: 'source-banner', attrs: { role: 'region', 'aria-label': 'Your tickets', tabindex: -1, hidden: true }, data: { region: 'source' } },
    [lead, rest, notes, el('div', { class: 'source-actions' }, [el('label', { class: 'field-label', attrs: { for: 'source-release' }, text: 'Release name' }), input, back])],
  );
  input.addEventListener('change', () => ctx.act({ type: 'release/set', name: input.value }));
  main.prepend(node);

  let shownNotes = '';
  return {
    node,
    update(_view, state) {
      const text = bannerSentences(state);
      setAttr(node, 'hidden', text === null);
      if (text === null) return;
      setText(lead, text.lead);
      setText(rest, text.rest);
      const joined = text.notes.join('\n');
      if (joined !== shownNotes) {
        shownNotes = joined;
        notes.replaceChildren(...text.notes.map((n) => el('li', { text: n })));
      }
      if (ctx.root.ownerDocument.activeElement !== input && input.value !== (state.release ?? '')) input.value = state.release ?? '';
    },
    destroy: () => node.remove(),
  };
}
