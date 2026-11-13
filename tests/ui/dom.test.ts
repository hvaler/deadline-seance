// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { Keyed, clear, el, focusIdOf, restoreFocus, setAttr, setClass, setText, svgEl, syncChildren } from '../../src/ui/dom';

afterEach(() => {
  document.body.replaceChildren();
});

const MARKUP = '<img src=x onerror=alert(1)>';

describe('el: text is text', () => {
  test('text, string children and attribute values are never parsed as markup', () => {
    const node = el('div', { text: MARKUP, attrs: { title: MARKUP, 'aria-label': MARKUP } });
    document.body.append(node);
    expect(node.textContent).toBe(MARKUP);
    expect(node.children).toHaveLength(0);
    expect(document.querySelector('img')).toBeNull();
    expect(node.getAttribute('title')).toBe(MARKUP);

    const withChild = el('p', {}, [MARKUP, el('span', { text: MARKUP })]);
    document.body.append(withChild);
    expect(withChild.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(withChild.textContent).toBe(MARKUP + MARKUP);
    expect(document.querySelector('img')).toBeNull();
  });

  test('null, undefined and false children are skipped', () => {
    const node = el('div', {}, ['a', null, undefined, false, 'b']);
    expect(node.textContent).toBe('ab');
  });

  test('classes, ids, attributes and data attributes', () => {
    const node = el('button', {
      class: 'a b',
      id: 'x',
      attrs: { type: 'button', disabled: true, hidden: false, 'aria-pressed': 'false', tabindex: -1, missing: undefined, nothing: null },
      data: { focus: 'sound', region: 'sign', gone: undefined },
    });
    expect(node.className).toBe('a b');
    expect(node.id).toBe('x');
    expect(node.disabled).toBe(true);
    expect(node.hasAttribute('hidden')).toBe(false);
    expect(node.getAttribute('tabindex')).toBe('-1');
    expect(node.hasAttribute('missing')).toBe(false);
    expect(node.dataset.focus).toBe('sound');
    expect(node.hasAttribute('data-gone')).toBe(false);
  });

  test('event listeners are attached through the "on" property', () => {
    const handler = vi.fn();
    const node = el('button', { on: { click: handler } });
    node.click();
    expect(handler).toHaveBeenCalledOnce();
  });

  test('attributes that would turn text into behavior or styling are refused', () => {
    expect(() => el('div', { attrs: { onclick: 'alert(1)' } })).toThrow(/event handler/);
    expect(() => el('div', { attrs: { onerror: 'alert(1)' } })).toThrow(/event handler/);
    expect(() => el('div', { attrs: { style: 'color: red' } })).toThrow(/style/);
    expect(() => el('iframe', { attrs: { srcdoc: '<p>x</p>' } })).toThrow(/srcdoc/);
    expect(() => el('a', { attrs: { href: 'javascript:alert(1)' } })).toThrow(/javascript/);
    expect(() => el('a', { attrs: { href: '  JavaScript:alert(1)' } })).toThrow(/javascript/);
    expect(() => setAttr(el('div'), 'onclick', 'x')).toThrow();
    expect(() => setAttr(el('div'), 'style', 'x')).toThrow();
  });

  test('a normal link is fine', () => {
    expect(el('a', { attrs: { href: '#safehouse' } }).getAttribute('href')).toBe('#safehouse');
  });
});

describe('svgEl', () => {
  test('creates SVG elements in the SVG namespace, with attributes and text', () => {
    const svg = svgEl('svg', { attrs: { viewBox: '0 0 10 10', 'aria-hidden': 'true' } }, [svgEl('path', { attrs: { d: 'M0 0L10 10' } })]);
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.firstElementChild?.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('viewBox')).toBe('0 0 10 10');
  });

  test('text in SVG is text too', () => {
    const text = svgEl('text', { text: MARKUP });
    expect(text.textContent).toBe(MARKUP);
    expect(text.children).toHaveLength(0);
  });

  test('the same attribute guard applies', () => {
    expect(() => svgEl('svg', { attrs: { onload: 'alert(1)' } })).toThrow(/event handler/);
  });
});

describe('patch helpers touch the DOM only when something changed', () => {
  test('setText', () => {
    const node = el('p', { text: 'a' });
    const first = node.firstChild;
    setText(node, 'a');
    expect(node.firstChild).toBe(first); // same text node: nothing was written
    setText(node, 'b');
    expect(node.textContent).toBe('b');
    setText(node, MARKUP);
    expect(node.children).toHaveLength(0);
  });

  test('setAttr', () => {
    const node = el('div');
    const spy = vi.spyOn(node, 'setAttribute');
    setAttr(node, 'aria-pressed', 'true');
    setAttr(node, 'aria-pressed', 'true');
    expect(spy).toHaveBeenCalledTimes(1);
    setAttr(node, 'aria-pressed', false);
    expect(node.hasAttribute('aria-pressed')).toBe(false);
    setAttr(node, 'hidden', true);
    expect(node.getAttribute('hidden')).toBe('');
    setAttr(node, 'hidden', null);
    expect(node.hasAttribute('hidden')).toBe(false);
  });

  test('setClass', () => {
    const node = el('div');
    const spy = vi.spyOn(node.classList, 'toggle');
    setClass(node, 'on', true);
    setClass(node, 'on', true);
    expect(spy).toHaveBeenCalledTimes(1);
    setClass(node, 'on', false);
    expect(node.classList.contains('on')).toBe(false);
  });

  test('clear', () => {
    const node = el('div', {}, ['a', el('b')]);
    clear(node);
    expect(node.childNodes).toHaveLength(0);
  });
});

describe('syncChildren', () => {
  const items = (n: number): HTMLElement[] => Array.from({ length: n }, (_, i) => el('li', { text: `item ${i}`, data: { id: i } }));

  test('builds, reorders, inserts and removes with the minimum of moves', () => {
    const list = el('ul');
    const [a, b, c, d] = items(4) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    syncChildren(list, [a, b, c]);
    expect([...list.children]).toEqual([a, b, c]);

    const spy = vi.spyOn(list, 'insertBefore');
    syncChildren(list, [a, b, c]);
    expect(spy).not.toHaveBeenCalled(); // already in order: nothing moves

    syncChildren(list, [a, d, b, c]); // one insertion
    expect([...list.children]).toEqual([a, d, b, c]);
    expect(spy).toHaveBeenCalledTimes(1);

    syncChildren(list, [c, a]); // removal and reorder
    expect([...list.children]).toEqual([c, a]);

    syncChildren(list, []);
    expect(list.children).toHaveLength(0);
  });

  test('an element that stays in place keeps the focus', () => {
    const list = el('ul');
    const buttons = [0, 1, 2].map((i) => el('button', { text: `b${i}` }));
    const rows = buttons.map((b) => el('li', {}, [b]));
    document.body.append(list);
    syncChildren(list, rows);
    buttons[1]?.focus();
    expect(document.activeElement).toBe(buttons[1]);
    syncChildren(list, [rows[0] as HTMLElement, rows[1] as HTMLElement]); // the third is removed, the focused one stays
    expect(document.activeElement).toBe(buttons[1]);
  });
});

describe('Keyed', () => {
  test('creates once per key and forgets keys that left', () => {
    let made = 0;
    const keyed = new Keyed((key) => {
      made++;
      return el('li', { text: key });
    });
    const a = keyed.get('HB-1');
    expect(keyed.get('HB-1')).toBe(a);
    keyed.get('HB-2');
    expect(made).toBe(2);
    keyed.retain(new Set(['HB-2']));
    const again = keyed.get('HB-1');
    expect(again).not.toBe(a);
    expect(made).toBe(3);
    expect(keyed.get('HB-2').textContent).toBe('HB-2');
  });
});

describe('focus helpers', () => {
  function board(): { root: HTMLElement; ids: Record<string, HTMLButtonElement>; heading: HTMLElement } {
    const heading = el('h2', { text: 'Left outside', attrs: { tabindex: -1 } });
    const ids: Record<string, HTMLButtonElement> = {};
    const buttons = ['exhume:HB-1', 'exhume:HB-2', 'card:HB-1'].map((id) => {
      const b = el('button', { text: id, data: { focus: id } });
      ids[id] = b;
      return b;
    });
    const root = el('section', {}, [heading, ...buttons]);
    document.body.append(root);
    return { root, ids, heading };
  }

  test('focusIdOf reads the id of the focused control, or of the holder around it', () => {
    const { root, ids } = board();
    ids['exhume:HB-2']?.focus();
    expect(focusIdOf(root, document.activeElement)).toBe('exhume:HB-2');
    const inner = el('span', { text: 'x', attrs: { tabindex: 0 } });
    const holder = el('div', { data: { focus: 'holder' } }, [inner]);
    root.append(holder);
    inner.focus();
    expect(focusIdOf(root, document.activeElement)).toBe('holder');
    expect(focusIdOf(root, null)).toBeNull();
    expect(focusIdOf(root, document.body)).toBeNull();
  });

  test('leaves the focus alone when it is still inside the root', () => {
    const { root, ids } = board();
    ids['exhume:HB-1']?.focus();
    restoreFocus(root, 'exhume:HB-2');
    expect(document.activeElement).toBe(ids['exhume:HB-1']);
  });

  test('moves the focus to the same id when it was lost, then to a fallback, then to the last resort', () => {
    const { root, ids, heading } = board();
    ids['exhume:HB-1']?.focus();
    ids['exhume:HB-1']?.remove(); // the button disappears and the focus falls to the page
    expect(document.activeElement).toBe(document.body);
    restoreFocus(root, 'exhume:HB-1', ['card:HB-1'], heading);
    expect(document.activeElement).toBe(ids['card:HB-1']); // the same id is gone: first fallback

    ids['card:HB-1']?.remove();
    expect(document.activeElement).toBe(document.body);
    restoreFocus(root, 'card:HB-1', ['exhume:HB-1'], heading);
    expect(document.activeElement).toBe(heading); // nothing left: the section heading

    heading.blur();
    restoreFocus(root, 'exhume:HB-2');
    expect(document.activeElement).toBe(ids['exhume:HB-2']); // the id itself still exists
  });

  test('does nothing when there was no focus to restore', () => {
    const { root } = board();
    restoreFocus(root, null, ['exhume:HB-1']);
    expect(document.activeElement).toBe(document.body);
  });

  test('an id with quotes or backslashes cannot break the selector', () => {
    const tricky = 'exhume:"><img src=x onerror=alert(1)>\\';
    const root = el('section', {}, [el('button', { text: 'x', data: { focus: tricky } })]);
    document.body.append(root);
    restoreFocus(root, tricky);
    expect(document.activeElement).toBe(root.querySelector('button'));
    expect(document.querySelector('img')).toBeNull();
  });
});
