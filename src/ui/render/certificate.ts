import { certificateNote, deathCertificate, nightFacts, plainText } from '../../engine/index';
import type { Note } from '../../engine/index';
import type { Ctx } from '../context';
import { el, setText } from '../dom';
import { nightInputOf } from '../night';

/**
 * The death certificate on the screen: a dialog that shows the note for stakeholders, with Copy and Download. The note comes from the engine
 * (`certificateNote`, `deathCertificate`); this file only puts it on the page, as DOM nodes made with `textContent` (no `innerHTML`, no Markdown
 * parser), and offers the same Markdown to the clipboard and to a file.
 *
 * Two ways to open it:
 * - **modal** (the user pressed the button): the focus moves to the title and stays inside, the page behind it is inert, `Esc` closes it, and the
 *   focus goes back to the button;
 * - **tour** (a scene of the guided tour): it does not take the focus, is itself inert and hidden from assistive technology (the subtitle is the
 *   only live region while the tour runs), and sits above the caption bar. The tour closes it.
 */
export interface CertificateControls {
  readonly isOpen: boolean;
  /** The user's way: modal. `opener` is where the focus returns to. */
  open(opener?: HTMLElement | null): void;
  /** The tour's way: not modal, no focus change. */
  openForTour(): void;
  /** `focus: false` closes without moving the focus (the tour does). */
  close(options?: { readonly focus?: boolean }): void;
  destroy(): void;
}

export interface CertificateOptions {
  readonly ctx: Ctx;
  readonly page: HTMLElement;
  readonly header: HTMLElement;
  readonly main: HTMLElement;
}

export const COPIED = 'Copied to the clipboard.';
export const COPY_BLOCKED = 'Copy was blocked. The note is selected below: press Ctrl+C.';
export const DOWNLOADED = 'Download started.';
export const NOTE_FAILED = 'The note could not be made.';
export const MARKDOWN_TYPE = 'text/markdown;charset=utf-8';

interface View {
  readonly overlay: HTMLElement;
  readonly title: HTMLElement;
  readonly status: HTMLElement;
  readonly fallback: HTMLTextAreaElement;
  readonly body: HTMLElement;
}

export function mountCertificate(options: CertificateOptions): CertificateControls {
  const { ctx, page, header, main } = options;
  const { services } = ctx;
  const doc = ctx.root.ownerDocument;

  // The view exists only while it is open: a closed note leaves nothing on the page (no heading, no text area) for a reader or a test to find.
  let view: View | null = null;
  let mode: 'modal' | 'tour' = 'modal';
  let opener: HTMLElement | null = null;
  let inerted: HTMLElement[] = [];
  let markdown = '';
  let fileName = 'death-certificate.md';
  let sayFrame: number | null = null;

  function create(): View {
    const title = el('h2', { id: 'certificate-title', class: 'certificate-title', attrs: { tabindex: -1 } });
    const status = el('p', { class: 'certificate-status', attrs: { role: 'status' }, data: { tour: 'certificate-status' } });
    const fallback = el('textarea', {
      class: 'certificate-fallback',
      attrs: { readonly: true, rows: 10, 'aria-label': 'The note as Markdown', hidden: true },
      data: { focus: 'certificate-fallback' },
    });
    const body = el('div', { class: 'certificate-body' });
    const copyButton = el('button', {
      class: 'button button-primary',
      attrs: { type: 'button', 'aria-label': 'Copy the note as Markdown' },
      data: { action: 'certificate-copy', focus: 'certificate-copy' },
      text: 'Copy',
      on: { click: () => void copy() },
    });
    const downloadButton = el('button', {
      class: 'button',
      attrs: { type: 'button', 'aria-label': 'Download the note as a Markdown file' },
      data: { action: 'certificate-download', focus: 'certificate-download' },
      text: 'Download .md',
      on: { click: () => download() },
    });
    const closeButton = el('button', {
      class: 'button',
      attrs: { type: 'button' },
      data: { action: 'certificate-close', focus: 'certificate-close' },
      text: 'Close',
      on: { click: () => close() },
    });
    const overlay = el(
      'div',
      { class: 'certificate', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'certificate-title' }, data: { region: 'certificate' } },
      [
        el('div', { class: 'certificate-sheet' }, [
          el('div', { class: 'certificate-head' }, [title, el('div', { class: 'certificate-actions' }, [copyButton, downloadButton, closeButton])]),
          status,
          fallback,
          body,
        ]),
      ],
    );
    overlay.addEventListener('keydown', onOverlayKey);
    return { overlay, title, status, fallback, body };
  }

  // ---- the note on the screen ----
  function build(v: View): void {
    const facts = nightFacts(nightInputOf(ctx.store.getState()));
    if (!facts.ok) {
      markdown = '';
      setText(v.title, 'Death certificate');
      v.body.replaceChildren(el('p', { text: NOTE_FAILED }));
      return;
    }
    markdown = deathCertificate(facts.value);
    fileName = `death-certificate-${facts.value.freeze.date}.md`;
    fill(v, certificateNote(facts.value));
  }

  function fill(v: View, note: Note): void {
    const nodes: HTMLElement[] = [];
    for (const block of note.blocks) {
      switch (block.kind) {
        case 'title':
          setText(v.title, plainText(block.text));
          break;
        case 'heading':
          nodes.push(el('h3', { class: 'certificate-heading', data: { heading: plainText(block.text) }, text: plainText(block.text) }));
          break;
        case 'paragraph':
          nodes.push(el('p', { class: 'certificate-text', text: plainText(block.text) }));
          break;
        case 'list':
          nodes.push(el('ul', { class: 'certificate-list' }, block.items.map((item) => el('li', { text: plainText(item) }))));
          break;
        case 'table': {
          const cell = (index: number): string => (block.align[index] === 'right' ? 'num is-number' : '');
          // Every header is in the same (body) face; only the figures of the rows are in the mono face.
          const head = el('tr', {}, block.head.map((h, i) => el('th', { class: block.align[i] === 'right' ? 'is-number' : '', attrs: { scope: 'col' }, text: plainText(h) })));
          const rows = block.rows.map((row) =>
            el(
              'tr',
              {},
              row.map((c, i) => (i === 0 ? el('th', { class: cell(i), attrs: { scope: 'row' }, text: plainText(c) }) : el('td', { class: cell(i), text: plainText(c) }))),
            ),
          );
          const table = el('table', { class: 'certificate-table' }, [
            el('caption', { class: 'visually-hidden', text: block.label }),
            el('thead', {}, [head]),
            el('tbody', {}, rows),
          ]);
          // A real table, in a box that scrolls on its own (a phone) and can be reached with the keyboard.
          nodes.push(el('div', { class: 'certificate-table-scroll', attrs: { tabindex: 0, role: 'region', 'aria-label': block.label } }, [table]));
          break;
        }
      }
    }
    v.body.replaceChildren(...nodes);
  }

  // ---- what the status line says ----
  function say(text: string): void {
    const v = view;
    if (v === null) return;
    v.status.textContent = '';
    if (sayFrame !== null) services.frame.cancel(sayFrame);
    // A live region speaks what changes after it exists: the new text goes in on the next frame, so the same message can be said twice.
    sayFrame = services.frame.request(() => {
      sayFrame = null;
      v.status.textContent = text;
    });
  }

  // ---- Copy and Download ----
  async function copy(): Promise<void> {
    const v = view;
    if (v === null) return;
    v.fallback.hidden = true;
    try {
      await services.clipboard.writeText(markdown);
      say(COPIED);
    } catch {
      if (view !== v) return;
      v.fallback.value = markdown;
      v.fallback.hidden = false;
      v.fallback.focus();
      v.fallback.select();
      say(COPY_BLOCKED);
    }
  }

  function download(): void {
    services.files.save(fileName, markdown, MARKDOWN_TYPE);
    say(DOWNLOADED);
  }

  // ---- opening and closing ----
  function openModal(from?: HTMLElement | null): void {
    if (view !== null) return;
    const v = create();
    view = v;
    mode = 'modal';
    build(v);
    opener = from ?? (doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null);
    page.append(v.overlay);
    inerted = [header, main, page.querySelector<HTMLElement>('.skip-link')].filter((n): n is HTMLElement => n !== null);
    for (const node of inerted) node.setAttribute('inert', '');
    doc.addEventListener('keydown', onDocumentKey);
    v.title.focus();
  }

  function openForTour(): void {
    if (view !== null) close({ focus: false });
    const v = create();
    view = v;
    mode = 'tour';
    build(v);
    v.overlay.classList.add('is-tour');
    v.overlay.removeAttribute('aria-modal');
    v.overlay.setAttribute('inert', '');
    v.overlay.setAttribute('aria-hidden', 'true');
    page.append(v.overlay);
    // The part of the note a viewer came for: what is left outside, and why.
    const heading = v.body.querySelector<HTMLElement>('[data-heading="Left outside"]');
    if (heading !== null) v.body.scrollTop = heading.offsetTop;
  }

  function close(closing: { readonly focus?: boolean } = {}): void {
    const v = view;
    if (v === null) return;
    const wasModal = mode === 'modal';
    view = null;
    v.overlay.removeEventListener('keydown', onOverlayKey);
    v.overlay.remove();
    for (const node of inerted) node.removeAttribute('inert');
    inerted = [];
    doc.removeEventListener('keydown', onDocumentKey);
    if (sayFrame !== null) services.frame.cancel(sayFrame);
    sayFrame = null;
    if (wasModal && closing.focus !== false) {
      const target =
        opener !== null && opener.isConnected
          ? opener
          : (ctx.root.querySelector<HTMLElement>('[data-focus="certificate"]') ?? ctx.root.querySelector<HTMLElement>('[data-focus="reset"]'));
      target?.focus();
    }
    opener = null;
  }

  // ---- the keyboard, while it is modal ----
  function focusables(v: View): HTMLElement[] {
    return [...v.overlay.querySelectorAll<HTMLElement>('button, textarea, [tabindex="0"]')].filter((n) => !n.hidden && !(n instanceof HTMLButtonElement && n.disabled));
  }

  function onOverlayKey(event: KeyboardEvent): void {
    const v = view;
    if (v === null || mode !== 'modal') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // a visible `#play` prompt stays: Esc closes the note only
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const list = focusables(v);
    const first = list[0];
    const last = list[list.length - 1];
    if (first === undefined || last === undefined) return;
    const active = doc.activeElement;
    if (event.shiftKey && (active === first || active === v.title)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** `Esc` while the focus is somewhere else (the user clicked the backdrop). */
  function onDocumentKey(event: KeyboardEvent): void {
    if (event.defaultPrevented || view === null || mode !== 'modal') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  return {
    get isOpen() {
      return view !== null;
    },
    open: openModal,
    openForTour,
    close,
    destroy() {
      close({ focus: false });
    },
  };
}