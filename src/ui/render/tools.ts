import type { Ctx, Part } from '../context';
import { el, setText } from '../dom';
import { createImportGroup } from './csv-group';

/**
 * The tools: what works (back to the sample board, the death certificate) and, clearly marked, the places where later features will go. Each slot
 * is a disabled button or plain text that says it is not built yet, and does nothing.
 */

export interface SlotSpec {
  readonly name: 'chronicle' | 'mcp';
  readonly label: string;
  /** Plain text instead of a disabled button. */
  readonly plain?: boolean;
}

export const TOOL_SLOTS: readonly SlotSpec[] = [
  { name: 'chronicle', label: 'Night chronicle and undo' },
  { name: 'mcp', label: 'The rule as an MCP server for the Kiro agent', plain: true },
];

/** What the tools need from the rest of the app: what to do when the death certificate button is pressed. */
export interface ToolsHook {
  readonly onCertificate: (opener: HTMLElement) => void;
  /** The banner of your tickets, to bring into view after an import. */
  readonly banner: () => HTMLElement | null;
}

export function mountTools(section: HTMLElement, ctx: Ctx, hook: ToolsHook): Part {
  const reset = el('button', {
    class: 'button button-primary',
    attrs: { type: 'button' },
    data: { action: 'reset', focus: 'reset' },
    text: 'Reset the sample board',
    on: { click: () => ctx.act({ type: 'board/reset' }) },
  });

  const certificate = el('button', {
    class: 'button',
    attrs: { type: 'button', 'aria-haspopup': 'dialog' },
    data: { action: 'certificate', focus: 'certificate' },
    text: 'Death certificate',
    on: { click: (event) => hook.onCertificate(event.currentTarget as HTMLElement) },
  });

  const slots = el(
    'ul',
    { class: 'slots', attrs: { role: 'list' } },
    TOOL_SLOTS.map((slot) => {
      const noteId = `slot-note-${slot.name}`;
      const note = el('span', { id: noteId, class: 'slot-note', text: 'Not built yet.' });
      const control = slot.plain
        ? el('span', { class: 'slot-label', data: { slot: slot.name }, text: slot.label })
        : el('button', {
            class: 'button slot',
            attrs: { type: 'button', disabled: true, 'aria-describedby': noteId },
            data: { slot: slot.name },
            text: slot.label,
          });
      return el('li', { class: 'slot-item' }, [control, note]);
    }),
  );

  const csv = createImportGroup(ctx, { banner: hook.banner });
  section.append(el('div', { class: 'tools-row' }, [reset, certificate]), csv.node, slots);
  return {
    update(view, state) {
      setText(reset, state.source.kind === 'built-in' ? 'Reset the sample board' : 'Reset your tickets');
      csv.part.update(view, state);
    },
    destroy: () => csv.part.destroy?.(),
  };
}
