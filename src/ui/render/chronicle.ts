import { decisionLine, describeWhat, plainText } from '../../engine/index';
import type { Ctx, Part } from '../context';
import { el, setAttr, setText, syncChildren } from '../dom';
import type { Entry } from '../model';
/**
 * The night chronicle panel: every decision of the night, newest first, with Undo and, on every line but the newest, Undo to here. The text of
 * a line is the engine's sentence for its facts (`decisionLine`); this file only places it. All text is set with `textContent`, so a person's or a
 * file's name is never markup.
 *
 * The list has a fixed height and scrolls inside itself, so a new line moves nothing else on the page.
 */
export const CHRONICLE_HELP = 'Every decision of tonight, newest first. The number in brackets is the change in saved cod.';
export const CHRONICLE_EMPTY = 'No decisions yet. Move the candle, send someone away or exhume a ticket, and each decision is written here.';
interface Row {
  readonly item: HTMLLIElement;
  readonly number: HTMLElement;
  readonly text: HTMLElement;
  readonly button: HTMLButtonElement;
}
export function droppedSentence(dropped: number, lostBoard: boolean): string {
  const lead = dropped === 1 ? 'The oldest decision is not listed and cannot be undone.' : `The ${dropped} oldest decisions are not listed and cannot be undone.`;
  return lostBoard ? `${lead} The board before them cannot be brought back.` : lead;
}
export function mountChronicle(section: HTMLElement, ctx: Ctx): Part {
  const help = el('p', { id: 'chronicle-help', class: 'chronicle-help', text: CHRONICLE_HELP });
  const dropped = el('p', { class: 'chronicle-dropped', attrs: { hidden: true } });
  const undo = el('button', {
    class: 'button',
    attrs: { type: 'button', 'aria-describedby': 'chronicle-help' },
    data: { action: 'undo', focus: 'undo' },
    text: 'Undo',
  });
  const empty = el('p', { id: 'chronicle-empty', class: 'chronicle-empty', text: CHRONICLE_EMPTY });
  const list = el('ol', { class: 'chronicle-entries' });
  const box = el('div', { class: 'chronicle-list', attrs: { tabindex: -1, role: 'region', 'aria-label': 'Decisions, newest first' }, data: { focus: 'chronicle-list' } }, [list, empty]);
  section.append(help, el('div', { class: 'chronicle-tools' }, [undo]), dropped, box);
  let shown: readonly Entry[] = [];
  /** After an undo made from this panel, the focus stays on Undo, or on the list when Undo has just been disabled. */
  function keepFocus(): void {
    if (!undo.disabled) undo.focus();
    else box.focus();
  }
  undo.addEventListener('click', () => {
    ctx.undo('last');
    keepFocus();
  });
  const rows = new WeakMap<Entry, Row>();
  function rowFor(entry: Entry): Row {
    let row = rows.get(entry);
    if (row === undefined) {
      const number = el('span', { class: 'entry-no' });
      const text = el('span', { class: 'entry-text' });
      const button = el('button', {
        class: 'button entry-undo',
        attrs: { type: 'button' },
        text: 'Undo to here',
        on: {
          click: () => {
            const index = shown.indexOf(entry);
            if (index < 0) return;
            ctx.undo(index);
            keepFocus();
          },
        },
      });
      const item = el('li', { class: 'entry' }, [number, text, button]);
      row = { item, number, text, button };
      rows.set(entry, row);
    }
    return row;
  }
  return {
    update(_view, state) {
      const { entries, dropped: gone, lost } = state.chronicle;
      shown = entries;
      const newestFirst = [...entries].reverse();
      const desired = newestFirst.map((entry, i) => {
        const row = rowFor(entry);
        row.item.setAttribute('value', String(entry.no));
        setText(row.number, `${entry.no}.`);
        const line = decisionLine(entry.facts);
        setText(row.text, line);
        const newest = i === 0;
        setAttr(row.button, 'hidden', newest);
        setAttr(row.button, 'aria-label', `Undo to here: before ${entry.no}, ${plainText(describeWhat(entry.facts.subject))}`);
        return row.item;
      });
      syncChildren(list, desired);
      const none = entries.length === 0;
      setAttr(empty, 'hidden', !none);
      setAttr(list, 'hidden', none);
      undo.disabled = none;
      setAttr(undo, 'aria-describedby', none ? 'chronicle-help chronicle-empty' : 'chronicle-help');
      setAttr(box, 'tabindex', none ? -1 : 0);
      setAttr(dropped, 'hidden', gone === 0);
      if (gone > 0) setText(dropped, droppedSentence(gone, lost));
    },
  };
}
