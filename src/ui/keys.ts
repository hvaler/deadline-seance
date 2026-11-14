/**
 * Keyboard rules for undo. Pure functions of an event, so a test can feed them plain objects.
 */
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'datetime-local', 'month', 'time', 'week']);
/** True for a place where the browser's own undo of typed text belongs: a text input, a textarea, a select, or editable content. A range input is not one. */
export function isTextField(target: EventTarget | null): boolean {
  if (target === null || !('tagName' in target)) return false;
  const node = target as HTMLElement;
  const tag = node.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return TEXT_INPUT_TYPES.has(((node as HTMLInputElement).type || 'text').toLowerCase());
  return node.isContentEditable === true || node.getAttribute?.('contenteditable') === 'true' || node.getAttribute?.('contenteditable') === '';
}
/** Ctrl+Z or Cmd+Z, with no Shift and no Alt. Ctrl+Shift+Z and Ctrl+Y are not undo (there is no redo). */
export function isUndoKey(event: { readonly key: string; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean; readonly altKey: boolean }): boolean {
  if (event.key.toLowerCase() !== 'z') return false;
  if (event.shiftKey || event.altKey) return false;
  return event.ctrlKey !== event.metaKey;
}
