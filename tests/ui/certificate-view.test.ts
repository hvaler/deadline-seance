// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { deathCertificate, nightFacts } from '../../src/engine/index';
import { nightInputOf } from '../../src/ui/night';
import { COPIED, COPY_BLOCKED, DOWNLOADED, MARKDOWN_TYPE } from '../../src/ui/render/certificate';
import { SAMPLE_RELEASE, sampleBoard } from '../../src/ui/sample-board';
import { sampleScript } from '../../src/ui/tour/sample-script';
import { readMarkdown } from '../engine/markdown-helpers';
import type { Said } from '../engine/markdown-helpers';
import { byFocus, mountWith as mountHarness, region } from './harness';
import type { Harness } from './harness';

// Every app is destroyed after its test: an open note keeps a listener on the document, and a stale one would answer the next test's keys.
const mounted: Harness[] = [];
const mountWith: typeof mountHarness = (...args) => {
  const h = mountHarness(...args);
  mounted.push(h);
  return h;
};

afterEach(() => {
  for (const h of mounted.splice(0)) h.app.destroy();
  document.body.replaceChildren();
});

const key = (target: EventTarget, name: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

const dialog = (root: ParentNode): HTMLElement | null => root.querySelector<HTMLElement>('[data-region="certificate"]');
const markdownOf = (h: Harness): string => {
  const facts = nightFacts(nightInputOf(h.app.store.getState()));
  if (!facts.ok) throw new Error('no facts');
  return deathCertificate(facts.value);
};
const settle = async (h: Harness): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0)); // the promise of the clipboard
  h.frame.flush(); // the status line is written on the next frame
};

describe('the button', () => {
  test('a closed note leaves nothing on the page: no dialog, no text area, one h2 per region', () => {
    const h = mountWith();
    expect(dialog(h.root)).toBeNull();
    expect(h.root.querySelector('textarea')).toBeNull();
    expect(h.app.certificate.isOpen).toBe(false);
  });

  test('opens the note for the night as it is at that moment', () => {
    const h = mountWith(undefined, {}, { release: SAMPLE_RELEASE });
    h.app.store.dispatch({ type: 'candle/set', step: 6 });
    byFocus(h.root, 'certificate').click();
    expect(dialog(h.root)).not.toBeNull();
    expect(dialog(h.root)?.textContent).toContain('Freeze: Wed 2026-11-18 18:00');
    expect(h.app.certificate.isOpen).toBe(true);
  });

  test('says nothing through the announcer and plays no sound: opening is not a change of the night', () => {
    const h = mountWith();
    h.sound.enabled = true;
    const before = h.app.store.getState();
    byFocus(h.root, 'certificate').click();
    h.frame.flush();
    expect(h.app.store.getState()).toBe(before);
    expect(region(h.root, 'announcer').textContent).toBe('');
    expect(h.sound.played).toEqual([]);
  });
});

describe('a dialog (Requirement 7.5)', () => {
  test('has the role, is modal, and is named by its title', () => {
    const h = mountWith();
    byFocus(h.root, 'certificate').click();
    const d = dialog(h.root)!;
    expect(d.getAttribute('role')).toBe('dialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
    const title = h.root.querySelector(`#${d.getAttribute('aria-labelledby')}`);
    expect(title?.tagName).toBe('H2');
    expect(title?.textContent).toBe('Death certificate');
  });

  test('moves the focus to the title, and makes the header, the page and the skip link inert', () => {
    const h = mountWith();
    const opener = byFocus(h.root, 'certificate');
    opener.focus();
    opener.click();
    expect(document.activeElement?.id).toBe('certificate-title');
    expect(h.root.querySelector('header')?.hasAttribute('inert')).toBe(true);
    expect(h.root.querySelector('main')?.hasAttribute('inert')).toBe(true);
    expect(h.root.querySelector('.skip-link')?.hasAttribute('inert')).toBe(true);
    expect(dialog(h.root)?.closest('[inert]')).toBeNull();
  });

  test('Tab and Shift+Tab stay inside: the last control leads to the first, the title back to the last', () => {
    const h = mountWith();
    byFocus(h.root, 'certificate').click();
    const copy = byFocus(h.root, 'certificate-copy');
    const close = byFocus(h.root, 'certificate-close');
    const table = h.root.querySelector<HTMLElement>('.certificate-table-scroll')!;
    expect(table.getAttribute('tabindex')).toBe('0');
    // the last focusable is the table box (it comes after the buttons in the document)
    table.focus();
    expect(key(table, 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(copy);
    const title = h.root.querySelector<HTMLElement>('#certificate-title')!;
    title.focus();
    expect(key(title, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(table);
    // in the middle, Tab is left to the browser
    close.focus();
    expect(key(close, 'Tab').defaultPrevented).toBe(false);
  });

  test('Esc closes it, removes the inert and returns the focus to the button', () => {
    const h = mountWith();
    const opener = byFocus(h.root, 'certificate');
    opener.focus();
    opener.click();
    const event = key(document.activeElement as HTMLElement, 'Escape');
    expect(event.defaultPrevented).toBe(true);
    expect(dialog(h.root)).toBeNull();
    expect(h.root.querySelector('[inert]')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(h.app.certificate.isOpen).toBe(false);
  });

  test('Esc works when the focus is somewhere else on the page', () => {
    const h = mountWith();
    byFocus(h.root, 'certificate').click();
    (document.activeElement as HTMLElement).blur();
    key(document.body, 'Escape');
    expect(dialog(h.root)).toBeNull();
  });

  test('Close does the same, and the note can be opened again', () => {
    const h = mountWith();
    const opener = byFocus(h.root, 'certificate');
    opener.click();
    byFocus(h.root, 'certificate-close').click();
    expect(dialog(h.root)).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.click();
    expect(dialog(h.root)).not.toBeNull();
  });

  test('Esc closes the note only: a visible #play prompt stays', () => {
    const h = mountWith(undefined, {}, { tour: sampleScript, hash: '#play' });
    expect(h.root.querySelector('[data-region="tour-prompt"]')).not.toBeNull();
    byFocus(h.root, 'certificate').click();
    key(document.activeElement as HTMLElement, 'Escape');
    expect(dialog(h.root)).toBeNull();
    expect(h.root.querySelector('[data-region="tour-prompt"]')).not.toBeNull();
  });

  test('a tour that starts while the note is open closes it first', () => {
    const h = mountWith(undefined, {}, { tour: sampleScript, hash: '#play' });
    byFocus(h.root, 'certificate').click();
    key(document.body, ' ', { code: 'Space' });
    expect(h.app.tour?.phase).toBe('playing');
    expect(dialog(h.root)).toBeNull();
    expect(h.root.querySelector('header')?.hasAttribute('inert')).toBe(false);
    h.app.tour?.stop();
  });
});

describe('what the screen says is what the Markdown says (Requirement 7.3)', () => {
  function shown(root: ParentNode): Said[] {
    const d = dialog(root)!;
    const said: Said[] = [{ kind: 'title', text: d.querySelector('h2')?.textContent ?? '' }];
    for (const node of d.querySelectorAll('.certificate-body > *')) {
      if (node.tagName === 'H3') said.push({ kind: 'heading', text: node.textContent ?? '' });
      else if (node.tagName === 'P') said.push({ kind: 'paragraph', text: node.textContent ?? '' });
      else if (node.tagName === 'UL') for (const li of node.querySelectorAll('li')) said.push({ kind: 'item', text: li.textContent ?? '' });
      else if (node.classList.contains('certificate-table-scroll')) {
        for (const tr of node.querySelectorAll('tr')) said.push({ kind: 'row', cells: [...tr.children].map((c) => c.textContent ?? '') });
      }
    }
    return said;
  }

  test('on the Friday night, every line, item and cell, in the same order', () => {
    const h = mountWith(undefined, {}, { release: SAMPLE_RELEASE });
    byFocus(h.root, 'certificate').click();
    expect(shown(h.root)).toEqual(readMarkdown(markdownOf(h)));
  });

  test('after the tour\'s actions, with everything filled', () => {
    const h = mountWith(undefined, {}, { release: SAMPLE_RELEASE });
    for (const action of [
      { type: 'candle/set', step: 6 },
      { type: 'survivor/toggle', name: 'Ana' },
      { type: 'tombstone/put-down', key: 'HB-112' },
      { type: 'tombstone/exhume', key: 'HB-108' },
    ] as const) h.app.store.dispatch(action);
    byFocus(h.root, 'certificate').click();
    const said = shown(h.root);
    expect(said).toEqual(readMarkdown(markdownOf(h)));
    expect(said.some((s) => s.kind === 'item' && s.text.startsWith('HB-108, Transaction search: 8 points'))).toBe(true);
  });

  test('the table is a table: a hidden caption, column headers, the key as the row header, and a box that can be scrolled with the keyboard', () => {
    const h = mountWith();
    byFocus(h.root, 'certificate').click();
    const box = h.root.querySelector('.certificate-table-scroll')!;
    expect(box.getAttribute('role')).toBe('region');
    expect(box.getAttribute('aria-label')).toBe('Left outside');
    expect(box.querySelector('caption.visually-hidden')?.textContent).toBe('Left outside');
    expect([...box.querySelectorAll('thead th')].map((th) => [th.getAttribute('scope'), th.textContent])).toEqual([
      ['col', 'Key'],
      ['col', 'Title'],
      ['col', 'Points'],
      ['col', 'Cost of delay'],
      ['col', 'Waiting cost (× 2 weeks)'],
      ['col', 'Reason'],
    ]);
    // every header is in the same face: the figure class (the mono face) is only on the cells of the rows
    expect([...box.querySelectorAll('thead th')].filter((th) => th.classList.contains('num'))).toEqual([]);
    expect([...box.querySelectorAll('tbody td.is-number')].every((td) => td.classList.contains('num'))).toBe(true);
    const first = box.querySelector('tbody tr')!;
    expect(first.firstElementChild?.tagName).toBe('TH');
    expect(first.firstElementChild?.getAttribute('scope')).toBe('row');
    expect(first.children).toHaveLength(6);
  });

  test('the release is a line of the note when the app has one, and not otherwise', () => {
    const named = mountWith(undefined, {}, { release: SAMPLE_RELEASE });
    byFocus(named.root, 'certificate').click();
    expect(dialog(named.root)?.textContent).toContain('Release: Hollow Bank app 3.2');
    document.body.replaceChildren();
    const plain = mountWith();
    byFocus(plain.root, 'certificate').click();
    expect(dialog(plain.root)?.textContent).not.toContain('Release:');
  });

  test('an empty board and an impossible freeze both show a correct note', () => {
    const empty = mountWith({ ...sampleBoard(), tickets: [] });
    byFocus(empty.root, 'certificate').click();
    expect(dialog(empty.root)?.querySelector('.certificate-table')).toBeNull();
    expect(dialog(empty.root)?.textContent).toContain('Kept inside: 0 tickets, 0 points');
    document.body.replaceChildren();
    const impossible = mountWith();
    impossible.app.store.dispatch({ type: 'candle/set', step: 0 });
    byFocus(impossible.root, 'certificate').click();
    expect(dialog(impossible.root)?.textContent).toContain('The freeze is impossible');
    expect(dialog(impossible.root)?.querySelector('table')).toBeNull();
  });

  test('a title with markup, pipes and Markdown characters is text: no element is made from it', () => {
    const board = sampleBoard();
    const hostile = '<img src=x onerror=alert(1)>|*bold*\n# not a heading `x`';
    const h = mountWith({ ...board, tickets: board.tickets.map((t) => (t.key === 'HB-119' ? { ...t, title: hostile } : t)) });
    byFocus(h.root, 'certificate').click();
    const d = dialog(h.root)!;
    expect(d.querySelector('img, script, b, strong, em')).toBeNull();
    const cell = [...d.querySelectorAll('td')].find((td) => td.textContent?.includes('onerror'));
    expect(cell?.textContent).toBe(hostile);
    expect(d.querySelectorAll('h3')).toHaveLength(7);
  });
});

describe('Copy (Requirement 8)', () => {
  test('writes exactly the Markdown of the note and says so', async () => {
    const h = mountWith(undefined, {}, { release: SAMPLE_RELEASE });
    byFocus(h.root, 'certificate').click();
    byFocus(h.root, 'certificate-copy').click();
    await settle(h);
    expect(h.clipboard.written).toEqual([markdownOf(h)]);
    expect(dialog(h.root)?.querySelector('[role="status"]')?.textContent).toBe(COPIED);
    expect(h.root.querySelector('textarea')?.hidden).toBe(true);
  });

  test('a second press works the same', async () => {
    const h = mountWith();
    byFocus(h.root, 'certificate').click();
    byFocus(h.root, 'certificate-copy').click();
    await settle(h);
    byFocus(h.root, 'certificate-copy').click();
    await settle(h);
    expect(h.clipboard.written).toHaveLength(2);
    expect(dialog(h.root)?.querySelector('[role="status"]')?.textContent).toBe(COPIED);
  });

  test('when the browser refuses, the note is shown selected in a text area, focused, with the way out', async () => {
    const h = mountWith();
    h.clipboard.accepts = false;
    byFocus(h.root, 'certificate').click();
    byFocus(h.root, 'certificate-copy').click();
    await settle(h);
    const area = h.root.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(area.hidden).toBe(false);
    expect(area.readOnly).toBe(true);
    expect(area.value).toBe(markdownOf(h));
    expect(document.activeElement).toBe(area);
    expect([area.selectionStart, area.selectionEnd]).toEqual([0, area.value.length]);
    expect(dialog(h.root)?.querySelector('[role="status"]')?.textContent).toBe(COPY_BLOCKED);
    expect(h.clipboard.written).toEqual([]);
  });

  test('closing clears the message and hides the text area', async () => {
    const h = mountWith();
    h.clipboard.accepts = false;
    byFocus(h.root, 'certificate').click();
    byFocus(h.root, 'certificate-copy').click();
    await settle(h);
    byFocus(h.root, 'certificate-close').click();
    byFocus(h.root, 'certificate').click();
    expect(dialog(h.root)?.querySelector('[role="status"]')?.textContent).toBe('');
    expect(h.root.querySelector<HTMLTextAreaElement>('textarea')?.hidden).toBe(true);
  });
});

describe('Download (Requirement 9)', () => {
  test('saves the same Markdown under a name made from the freeze date, as Markdown text', () => {
    const h = mountWith(undefined, {}, { release: SAMPLE_RELEASE });
    byFocus(h.root, 'certificate').click();
    byFocus(h.root, 'certificate-download').click();
    h.frame.flush();
    expect(h.files.saved).toEqual([{ name: 'death-certificate-2026-11-20.md', text: markdownOf(h), type: MARKDOWN_TYPE }]);
    expect(dialog(h.root)?.querySelector('[role="status"]')?.textContent).toBe(DOWNLOADED);
  });

  test('the name follows the candle and is plain ASCII, with no title and no name in it', () => {
    const h = mountWith();
    h.app.store.dispatch({ type: 'candle/set', step: 6 });
    byFocus(h.root, 'certificate').click();
    byFocus(h.root, 'certificate-download').click();
    expect(h.files.saved[0]?.name).toBe('death-certificate-2026-11-18.md');
    expect(h.files.saved[0]?.name).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  test('Copy and Download give the same string', async () => {
    const h = mountWith();
    byFocus(h.root, 'certificate').click();
    byFocus(h.root, 'certificate-copy').click();
    byFocus(h.root, 'certificate-download').click();
    await settle(h);
    expect(h.files.saved[0]?.text).toBe(h.clipboard.written[0]);
  });
});

describe('tour mode (Requirement 11.3)', () => {
  test('does not take the focus, is not modal, and is itself inert and hidden from assistive technology', () => {
    const h = mountWith();
    const before = document.activeElement;
    h.app.certificate.openForTour();
    const d = dialog(h.root)!;
    expect(document.activeElement).toBe(before);
    expect(d.classList.contains('is-tour')).toBe(true);
    expect(d.hasAttribute('aria-modal')).toBe(false);
    expect(d.hasAttribute('inert')).toBe(true);
    expect(d.getAttribute('aria-hidden')).toBe('true');
    expect(h.root.querySelector('main')?.hasAttribute('inert')).toBe(false);
    expect(h.root.querySelector('header')?.hasAttribute('inert')).toBe(false);
    h.app.certificate.close({ focus: false });
    expect(dialog(h.root)).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  test('opening it twice leaves one dialog', () => {
    const h = mountWith();
    h.app.certificate.openForTour();
    h.app.certificate.openForTour();
    expect(h.root.querySelectorAll('[data-region="certificate"]')).toHaveLength(1);
  });

  test('destroying the app takes it away', () => {
    const h = mountWith();
    h.app.certificate.open();
    h.app.destroy();
    expect(document.querySelector('[data-region="certificate"]')).toBeNull();
  });
});
