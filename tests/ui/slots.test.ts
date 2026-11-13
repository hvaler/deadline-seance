// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { byFocus, mountWith, region } from './harness';

afterEach(() => {
  document.body.replaceChildren();
});

/** The empty slots of features that are out of scope for this version, and the text each one must show. */
const SLOTS = ['tour', 'fog', 'certificate', 'chronicle', 'csv', 'mcp'] as const;

const slot = (root: ParentNode, name: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(`[data-slot="${name}"]`)];

/** What a reader gets for a slot: its own text, and the text of what describes it. */
function wordsOf(root: ParentNode, node: HTMLElement): string {
  const note = (node.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => root.querySelector(`#${id}`)?.textContent ?? '')
    .join(' ');
  // A plain-text slot has its note beside it, inside the same list item.
  const item = node.closest('.slot-item')?.textContent ?? '';
  return `${node.textContent ?? ''} ${note} ${item}`.toLowerCase();
}

describe('empty slots', () => {
  test('every feature that is not built yet has exactly one slot on the screen', () => {
    const { root } = mountWith();
    for (const name of SLOTS) expect(slot(root, name), name).toHaveLength(1);
  });

  test('each one says it is not built yet', () => {
    const { root } = mountWith();
    for (const name of SLOTS) expect(wordsOf(root, slot(root, name)[0]!), name).toContain('not built yet');
  });

  test('each one is either a disabled button or plain text: nothing to focus, nothing to press', () => {
    const { root } = mountWith();
    for (const name of SLOTS) {
      const node = slot(root, name)[0]!;
      if (node.tagName === 'BUTTON') {
        expect((node as HTMLButtonElement).disabled, `${name} must be disabled`).toBe(true);
      } else {
        expect(node.matches('a, input, select, textarea, [tabindex], [role="button"]'), `${name} must not be interactive`).toBe(false);
        expect(node.querySelector('a, button, input, select, textarea, [tabindex]'), `${name} must not hold anything interactive`).toBeNull();
      }
    }
  });

  test('the slots are where the brief puts them: the tour in the title card, the fog in the sign, the rest in the tools', () => {
    const { root } = mountWith();
    expect(slot(root, 'tour')[0]?.closest('header')).not.toBeNull();
    expect(slot(root, 'fog')[0]?.closest('[data-region="sign"]')).not.toBeNull();
    for (const name of ['certificate', 'chronicle', 'csv', 'mcp']) expect(slot(root, name)[0]?.closest('[data-region="tools"]'), name).not.toBeNull();
  });

  test('the labels name the feature', () => {
    const { root } = mountWith();
    expect(slot(root, 'tour')[0]?.textContent).toBe('Play the night · 60 s');
    expect(slot(root, 'fog')[0]?.textContent).toBe('Chance the shelter holds: not built yet.');
    expect(slot(root, 'certificate')[0]?.textContent).toBe('Death certificate');
    expect(slot(root, 'chronicle')[0]?.textContent).toBe('Night chronicle and undo');
    expect(slot(root, 'csv')[0]?.textContent).toBe('CSV import and export');
    expect(slot(root, 'mcp')[0]?.textContent).toBe('The rule as an MCP server for the Kiro agent');
  });

  test('pressing a slot does nothing: no change of state, no announcement, no sound', () => {
    const { root, app, frame, sound } = mountWith();
    sound.enabled = true;
    const before = app.store.getState();
    for (const name of SLOTS) for (const node of slot(root, name)) node.click();
    frame.flush();
    expect(app.store.getState()).toBe(before);
    expect(region(root, 'announcer').textContent).toBe('');
    expect(region(root, 'alerter').textContent).toBe('');
    expect(sound.played).toEqual([]);
  });

  test('the slots do not look like working controls: each disabled one is out of the tab order', () => {
    const { root } = mountWith();
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-slot]')) {
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('tabindex')).toBeNull();
    }
  });
});

describe('what the language-model slot must not have', () => {
  test('the page has no key field, no model name and no call to a model', () => {
    const { root } = mountWith();
    expect(root.textContent).not.toMatch(/api[ -]?key|\bllm\b|language model|gpt|claude|openai|anthropic|gemini|chatbot/i);
    expect(root.querySelector('input[type="password"], input[type="text"], textarea')).toBeNull();
  });

  test('the epitaph text is the fixed template, the same on every mount', () => {
    const a = mountWith();
    const first = a.root.querySelector('li[data-key="HB-108"] .card-epitaph')?.textContent;
    document.body.replaceChildren();
    const b = mountWith();
    expect(b.root.querySelector('li[data-key="HB-108"] .card-epitaph')?.textContent).toBe(first);
    expect(first).toBe('Here lies HB-108. It needed 8 points and the night had 0 left. Waiting 2 weeks costs 20.');
  });
});

describe('the title card', () => {
  test('has the product line above the title, the tour slot and the sound button, in that order', () => {
    const { root } = mountWith();
    const header = root.querySelector('header')!;
    expect([...header.children].map((c) => c.className.split(' ')[0])).toEqual(['product-line', 'title', 'title-actions', 'slot-note']);
    expect(header.querySelector('h1')?.textContent).toBe('Night of the Living Backlog');
    const buttons = [...header.querySelectorAll('.title-actions button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Play the night · 60 s', 'Sound off']);
  });
});

describe('the tools', () => {
  test('"Reset the sample board" works and is not a slot', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 4 });
    const reset = byFocus(root, 'reset');
    expect(reset.textContent).toBe('Reset the sample board');
    expect(reset.hasAttribute('data-slot')).toBe(false);
    reset.click();
    expect(app.store.getState().candle).toBe(10);
    expect(region(root, 'change').querySelector('.change-headline')?.textContent).toBe('Back to the sample board.');
  });
});
