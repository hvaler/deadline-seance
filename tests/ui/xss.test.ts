// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Board } from '../../src/engine/index';
import { mountApp } from '../../src/ui/app';
import { el } from '../../src/ui/dom';
import { sampleBoard } from '../../src/ui/sample-board';

// Board text must stay text (Requirement 15.2). This file proves it for everything the screen draws so far: the screen for a board that
// fails validation (which prints keys, names and values from the board) and the helpers every renderer uses. The same payloads are drawn
// again when the survivors and the grounds exist (tasks 9 and 10 add their cases here).

const PAYLOAD = '<img src=x onerror=alert(1)>';
const PAYLOADS = [
  PAYLOAD,
  '<script>alert(1)</script>',
  '"><svg onload=alert(1)>',
  '</li><li><img src=x onerror=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '&lt;b&gt;&amp;',
];

let alertSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  alertSpy = vi.fn();
  vi.stubGlobal('alert', alertSpy);
  window.alert = alertSpy as unknown as typeof window.alert;
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** Nothing the payloads could create exists in the page, and the text is there literally. */
function expectInert(root: HTMLElement, literal: string): void {
  expect(root.textContent).toContain(literal);
  // The page's own chains drawing is the only svg it draws (class chains); anything else would be injected.
  expect(document.querySelector('img, script, iframe, object, embed, svg:not(.chains)')).toBeNull();
  expect(document.querySelector('[onerror], [onload], [onclick], [onmouseover]')).toBeNull();
  expect(document.querySelector('a[href^="javascript:" i]')).toBeNull();
  expect(alertSpy).not.toHaveBeenCalled();
}

function mountInvalid(board: Board): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  expect(mountApp(root, board).kind).toBe('invalid');
  return root;
}

describe('markup in a key', () => {
  for (const payload of PAYLOADS) {
    test(`a duplicate key ${JSON.stringify(payload)} is printed as text`, () => {
      const board = sampleBoard();
      const dup = { ...(board.tickets[0] as Board['tickets'][number]), key: payload };
      const root = mountInvalid({ ...board, tickets: [...board.tickets, dup, { ...dup }] });
      expectInert(root, payload);
      expect(root.querySelector('li[data-code="duplicate-key"]')?.textContent).toBe(`Duplicate key ${payload}: two tickets use it.`);
    });
  }

  test('an unknown dependency named with markup is printed as text', () => {
    const board = sampleBoard();
    const root = mountInvalid({ ...board, tickets: board.tickets.map((t) => (t.key === 'HB-101' ? { ...t, dependsOn: [PAYLOAD] } : t)) });
    expectInert(root, PAYLOAD);
    expect(root.querySelector('li')?.textContent).toBe(`HB-101 depends on ${PAYLOAD}, which is not on the board.`);
  });

  test('a cycle through keys with markup is printed as text', () => {
    const board = sampleBoard();
    const a = '<b>a</b>';
    const b = '<i>b</i>';
    const root = mountInvalid({
      ...board,
      tickets: [
        ...board.tickets,
        { ...(board.tickets[0] as Board['tickets'][number]), key: a, dependsOn: [b] },
        { ...(board.tickets[0] as Board['tickets'][number]), key: b, dependsOn: [a] },
      ],
    });
    expect(root.textContent).toContain(`Dependency cycle: ${a} → ${b} → ${a}.`);
    expect(document.querySelector('b, i')).toBeNull();
  });
});

describe('markup in a person name or a value', () => {
  for (const payload of PAYLOADS) {
    test(`a survivor named ${JSON.stringify(payload)} with a bad day off is printed as text`, () => {
      const board = sampleBoard();
      const people = board.people.map((p) => (p.name === 'Ana' ? { ...p, name: payload, daysOff: [{ date: '2026-02-30', part: 'full' as const }] } : p));
      const root = mountInvalid({ ...board, people });
      expectInert(root, payload);
      expect(root.querySelector('li[data-code="invalid-absence"]')?.textContent).toBe(`${payload} has an invalid day off: 2026-02-30 full.`);
    });
  }

  test('a time zone with markup is printed as text', () => {
    const root = mountInvalid({ ...sampleBoard(), timeZone: PAYLOAD });
    expectInert(root, PAYLOAD);
    expect(root.querySelector('li')?.textContent).toBe(`Unknown time zone "${PAYLOAD}".`);
  });

  for (const payload of PAYLOADS) {
    test(`a ticket titled ${JSON.stringify(payload)} is shown as plain text in the safehouse and in the yard`, () => {
      const board = sampleBoard();
      const root = document.createElement('div');
      document.body.append(root);
      const tickets = board.tickets.map((t) => (t.key === 'HB-101' || t.key === 'HB-108' ? { ...t, title: payload } : t));
      const app = mountApp(root, { ...board, tickets });
      expect(app.kind).toBe('board');
      const titles = [...root.querySelectorAll('li[data-key="HB-101"] .card-title, li[data-key="HB-108"] .card-title')].map((n) => n.textContent);
      expect(titles).toEqual([payload, payload]);
      expectInert(root, payload);
    });
  }

  for (const payload of PAYLOADS) {
    test(`a survivor named ${JSON.stringify(payload)} is shown as plain text in the team, and its switch works`, () => {
      const board = sampleBoard();
      const root = document.createElement('div');
      document.body.append(root);
      const people = board.people.map((p) => (p.name === 'Ana' ? { ...p, name: payload } : p));
      const app = mountApp(root, { ...board, people });
      expect(app.kind).toBe('board');
      expect(root.querySelector('.team-member .chip-name')?.textContent).toBe(payload);
      expectInert(root, payload);
      root.querySelector<HTMLButtonElement>('.team-member button')?.click();
      if (app.kind === 'board') expect(app.store.getState().away).toEqual([payload]);
      expectInert(root, payload);
    });
  }

  test('a key with markup is shown as text and does not become part of any selector, label or attribute name', () => {
    const board = sampleBoard();
    const root = document.createElement('div');
    document.body.append(root);
    const tickets = board.tickets.map((t) => (t.key === 'HB-108' ? { ...t, key: PAYLOAD } : t));
    const app = mountApp(root, { ...board, tickets });
    expect(app.kind).toBe('board');
    expectInert(root, PAYLOAD);
    root.querySelector<HTMLButtonElement>('button.action-exhume')?.click();
    expectInert(root, PAYLOAD);
  });

  test('a reason, an epitaph and a change note built from keys and names with markup are text too', () => {
    const board = sampleBoard();
    const root = document.createElement('div');
    document.body.append(root);
    const key = '<i>fall</i>';
    const tickets = board.tickets.map((t) => (t.key === 'HB-112' ? { ...t, key } : t.key === 'HB-114' ? { ...t, dependsOn: [key] } : t));
    const people = board.people.map((p) => (p.name === 'Ana' ? { ...p, name: PAYLOAD } : p));
    const app = mountApp(root, { ...board, tickets, people });
    expect(app.kind).toBe('board');
    root.querySelector<HTMLButtonElement>('.team-member button')?.click(); // the change note now names the survivor
    expect(root.querySelector('[data-region="change"] .change-headline')?.textContent).toBe(`${PAYLOAD} sent away.`);
    expect(root.querySelector('li[data-key="HB-114"] .card-epitaph')?.textContent).toContain(`It followed ${key} into the ground.`);
    expectInert(root, PAYLOAD);
    expect(document.querySelector('i')).toBeNull();
  });
});

describe('the helpers every renderer uses', () => {
  test('el writes any payload as text, in text, children and attribute values', () => {
    for (const payload of PAYLOADS) {
      const node = el('div', {}, [el('p', { text: payload }), payload, el('span', { attrs: { title: payload, 'aria-label': payload } })]);
      document.body.append(node);
      expectInert(node, payload);
      expect(node.querySelector('span')?.getAttribute('title')).toBe(payload);
      node.remove();
    }
  });

  test('a payload cannot become an attribute name: event handlers and styles throw instead of being written', () => {
    expect(() => el('div', { attrs: { onerror: 'alert(1)' } })).toThrow();
    expect(() => el('div', { attrs: { style: 'background:url(javascript:alert(1))' } })).toThrow();
    expect(() => el('a', { attrs: { href: 'javascript:alert(1)' } })).toThrow();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('the page has no element with an inline event handler after mounting the sample', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountApp(root, sampleBoard());
    expect(root.querySelector('[onclick], [onerror], [onload], [onmouseover]')).toBeNull();
  });

  test('the only style the page carries is a number in a custom property, set through the CSSOM (allowed by style-src self)', () => {
    const root = document.createElement('div');
    document.body.append(root);
    mountApp(root, sampleBoard());
    const styles = [...root.querySelectorAll('[style]')].map((n) => n.getAttribute('style') ?? '');
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) expect(style).toMatch(/^\s*(--[a-z-]+:\s*-?[0-9.]+;?\s*)+$/);
  });
});
