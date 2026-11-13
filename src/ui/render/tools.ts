import type { Ctx, Part } from '../context';
import { el } from '../dom';

/**
 * The tools: the one thing that works (back to the sample board) and, clearly marked, the places where later features will go. Each slot
 * is a disabled button or plain text that says it is not built yet, and does nothing.
 */

export interface SlotSpec {
  readonly name: 'certificate' | 'chronicle' | 'csv' | 'mcp';
  readonly label: string;
  /** Plain text instead of a disabled button. */
  readonly plain?: boolean;
}

export const TOOL_SLOTS: readonly SlotSpec[] = [
  { name: 'certificate', label: 'Death certificate' },
  { name: 'chronicle', label: 'Night chronicle and undo' },
  { name: 'csv', label: 'CSV import and export' },
  { name: 'mcp', label: 'The rule as an MCP server for the Kiro agent', plain: true },
];

export function mountTools(section: HTMLElement, ctx: Ctx): Part {
  const reset = el('button', {
    class: 'button button-primary',
    attrs: { type: 'button' },
    data: { action: 'reset', focus: 'reset' },
    text: 'Reset the sample board',
    on: { click: () => ctx.act({ type: 'board/reset' }) },
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

  section.append(el('div', { class: 'tools-row' }, [reset]), slots);
  return { update() {} };
}
