// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { sampleBoard } from '../../src/ui/sample-board';
import { sampleScript } from '../../src/ui/tour/sample-script';
import { byFocus, drag, mountWith, release } from './harness';
import type { Harness } from './harness';

// The structure assistive technology relies on, checked on the whole page and in several states: the first screen, an impossible freeze,
// after an exhume, a rejected exhume (the alert), a put-down. (Contrast and the reduced-motion rules are in contrast.test.ts, tokens.test.ts
// and atmosphere.test.ts; what a screen reader actually says needs a real screen reader and is on the manual checklist.)

afterEach(() => {
  document.body.replaceChildren();
});

/** The states the checks run on: each one drives the real page the way a user would. */
const STATES: [string, (h: Harness) => void][] = [
  ['the first screen', () => {}],
  [
    'an impossible freeze',
    (h) => {
      const input = byFocus(h.root, 'candle') as HTMLInputElement;
      drag(input, 1);
      release(input);
    },
  ],
  ['after an exhume', (h) => byFocus(h.root, 'exhume:HB-108').click()],
  ['after a rejected exhume (an alert)', (h) => byFocus(h.root, 'exhume:HB-119').click()],
  ['after a zombie was put down', (h) => byFocus(h.root, 'put-down:HB-112').click()],
  ['after a survivor was sent away', (h) => byFocus(h.root, 'survivor:Ana').click()],
  ['with the death certificate open', (h) => byFocus(h.root, 'certificate').click()],
  ['with the death certificate open in tour mode', (h) => h.app.certificate.openForTour()],
];

const idsIn = (root: ParentNode): string[] => [...root.querySelectorAll('[id]')].map((n) => n.id);

/** The accessible name, by the rules that matter here: aria-labelledby, aria-label, a label for the control, its own text, its title. */
function nameOf(node: Element, root: ParentNode): string {
  const labelledby = node.getAttribute('aria-labelledby');
  if (labelledby !== null) {
    return labelledby
      .split(/\s+/)
      .map((id) => root.querySelector(`[id="${id}"]`)?.textContent ?? '')
      .join(' ')
      .trim();
  }
  const label = node.getAttribute('aria-label');
  if (label !== null && label.trim() !== '') return label.trim();
  if (node.id !== '') {
    const forLabel = root.querySelector(`label[for="${node.id}"]`);
    if (forLabel !== null) return (forLabel.textContent ?? '').trim();
  }
  return ((node.textContent ?? '').trim() || node.getAttribute('title') || '').trim();
}

describe.each(STATES)('the page, %s', (_name, drive) => {
  function page(): Harness {
    const h = mountWith();
    drive(h);
    return h;
  }

  test('has exactly one h1, a header and a main, and the headings never skip a level', () => {
    const { root } = page();
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    // (a tombstone has a <header> of its own, inside an article: that is not the page banner)
    expect([...root.querySelectorAll('header')].filter((h) => h.closest('article, section, main') === null)).toHaveLength(1);
    expect(root.querySelectorAll('main')).toHaveLength(1);
    let last = 0;
    for (const heading of root.querySelectorAll('h1, h2, h3, h4')) {
      const level = Number(heading.tagName.slice(1));
      expect(level, heading.textContent ?? '').toBeLessThanOrEqual(last + 1);
      last = level;
    }
  });

  test('every section is a labelled region whose label is a real heading with text', () => {
    const { root } = page();
    const sections = [...root.querySelectorAll('main section.region')];
    expect(sections).toHaveLength(6);
    for (const section of sections) {
      const id = section.getAttribute('aria-labelledby') ?? '';
      const heading = root.querySelector(`[id="${id}"]`);
      expect(heading?.tagName, id).toBe('H2');
      expect((heading?.textContent ?? '').trim()).not.toBe('');
    }
  });

  test('the fog block is a labelled region of the sign (labelled by its own painted line, no new h2) and the strip is a named list with one current item', () => {
    const { root } = page();
    const fog = root.querySelector('section[data-region="fog"]')!;
    expect(fog.closest('main section.region')?.getAttribute('data-region')).toBe('sign');
    expect((root.querySelector(`[id="${fog.getAttribute('aria-labelledby')}"]`)?.textContent ?? '').trim()).not.toBe('');
    expect(fog.querySelector('h1, h2, h3, h4')).toBeNull();
    const list = root.querySelector('ol[data-region="fog-strip"]')!;
    expect((list.getAttribute('aria-label') ?? '').trim()).not.toBe('');
    expect(list.querySelectorAll('li')).toHaveLength(7);
    expect(list.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    expect(list.querySelector('[tabindex], a, button, input')).toBeNull();
    expect(root.querySelector('[data-region="fog"] [aria-live]')).toBeNull();
  });

  test('every button and input has an accessible name', () => {
    const { root } = page();
    const controls = [...root.querySelectorAll('button, input, select, textarea, [role="switch"], [role="button"]')];
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) {
      expect(nameOf(control, root), `${control.tagName} ${control.className}`).not.toBe('');
    }
  });

  test('the actions on tombstones say which ticket they act on', () => {
    const { root } = page();
    for (const button of root.querySelectorAll<HTMLButtonElement>('.card-actions button')) {
      const key = button.dataset.focus?.split(':')[1] ?? '';
      expect(nameOf(button, root), button.dataset.focus).toContain(key);
    }
  });

  test('nothing has a positive tabindex, and every tabindex is 0 or -1', () => {
    const { root } = page();
    for (const node of root.querySelectorAll('[tabindex]')) {
      expect(['0', '-1'], `${node.tagName} ${node.className}`).toContain(node.getAttribute('tabindex'));
    }
  });

  test('every id is unique and every reference (labelledby, describedby, for, href) points at something that exists', () => {
    const { root } = page();
    const ids = idsIn(root);
    expect(new Set(ids).size).toBe(ids.length);
    for (const node of root.querySelectorAll('[aria-labelledby], [aria-describedby], [aria-controls]')) {
      for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
        for (const id of (node.getAttribute(attribute) ?? '').split(/\s+/).filter((x) => x !== '')) {
          expect(ids, `${attribute}="${id}" on ${node.tagName}`).toContain(id);
        }
      }
    }
    for (const label of root.querySelectorAll('label[for]')) expect(ids).toContain(label.getAttribute('for'));
    for (const link of root.querySelectorAll('a[href^="#"]')) expect(ids).toContain(link.getAttribute('href')?.slice(1));
  });

  test('every decoration is aria-hidden: the atmosphere layers, the drawings, the notches, the painted figures and the R · I · P', () => {
    const { root } = page();
    for (const layer of root.querySelectorAll('.atmosphere')) expect(layer.getAttribute('aria-hidden')).toBe('true');
    for (const selector of ['svg', '.candle-art', '.notches', '.verdict-figures', '.grave-rip']) {
      for (const node of root.querySelectorAll(selector)) expect(node.closest('[aria-hidden="true"]'), selector).not.toBeNull();
    }
    expect(root.querySelectorAll('img')).toHaveLength(0);
  });

  test('the announcer is polite and atomic, the alert region is an alert, and neither is the sign itself', () => {
    const { root } = page();
    const polite = root.querySelector('[data-region="announcer"]');
    expect(polite?.getAttribute('aria-live')).toBe('polite');
    expect(polite?.getAttribute('aria-atomic')).toBe('true');
    expect(root.querySelector('[data-region="alerter"]')?.getAttribute('role')).toBe('alert');
    expect(root.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(root.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  test('the switches say whether they are on, and the ranges say what they are set to', () => {
    const { root } = page();
    const switches = [...root.querySelectorAll('[role="switch"]')];
    expect(switches).toHaveLength(4);
    for (const s of switches) expect(['true', 'false'], s.textContent ?? '').toContain(s.getAttribute('aria-checked'));
    for (const range of root.querySelectorAll('input[type="range"]')) {
      expect(range.getAttribute('aria-valuetext') ?? '', range.id).not.toBe('');
    }
    expect(root.querySelector('[data-action="sound"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  test('the skip link is the first focusable element and leads to the safehouse', () => {
    const { root } = page();
    const first = root.querySelector('a[href], button, input, [tabindex="0"]');
    expect(first?.className).toContain('skip-link');
    expect(first?.getAttribute('href')).toBe('#safehouse');
    expect(root.querySelector('#safehouse')).not.toBeNull();
  });

  test('disabled slots explain themselves, and text that carries the verdict is not hidden from a screen reader', () => {
    const { root } = page();
    for (const slot of root.querySelectorAll<HTMLButtonElement>('button.slot')) {
      expect(slot.disabled).toBe(true);
      const note = slot.getAttribute('aria-describedby');
      if (note !== null) expect(root.querySelector(`[id="${note}"]`)?.textContent ?? '').not.toBe('');
    }
    const verdict = root.querySelector('[data-region="verdict"]')!;
    expect(verdict.closest('[aria-hidden="true"]')).toBeNull();
    expect(verdict.querySelectorAll('p').length).toBeGreaterThan(0);
    for (const p of verdict.querySelectorAll('p')) expect(p.closest('[aria-hidden="true"]')).toBeNull();
  });
});

describe('what changes for assistive technology when the user acts', () => {
  test('a switch flips its aria-checked, and its name keeps the person', () => {
    const { root } = mountWith();
    const ana = byFocus(root, 'survivor:Ana');
    expect(ana.getAttribute('aria-checked')).toBe('true');
    ana.click();
    expect(byFocus(root, 'survivor:Ana').getAttribute('aria-checked')).toBe('false');
    expect(nameOf(byFocus(root, 'survivor:Ana'), root)).toContain('Ana');
  });

  test('a rejected exhume is drawn as an alert on the sign and spoken through the alert region', () => {
    const { root, timers, frame } = mountWith();
    byFocus(root, 'exhume:HB-119').click();
    timers.advance(400);
    frame.flush();
    expect(root.querySelector('[data-region="change"]')?.getAttribute('data-alert')).toBe('true');
    expect(root.querySelector('[data-region="alerter"]')?.textContent ?? '').toContain('63 points');
  });

  test('focus is never lost to the page: after exhuming, it is on something inside the app', () => {
    const { root } = mountWith();
    byFocus(root, 'exhume:HB-108').focus();
    byFocus(root, 'exhume:HB-108').click();
    expect(root.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('the guided tour', () => {
  const states: [string, (h: Harness) => void][] = [
    ['the prompt', () => {}],
    ['playing', (h) => h.app.tour?.start('button')],
    ['paused', (h) => { h.app.tour?.start('button'); byFocus(h.root, 'tour-pause').click(); }],
    ['ended', (h) => { h.app.tour?.start('button'); for (let i = 0; i < 700; i++) { h.timers.advance(100); h.frame.flush(); } }],
  ];
  for (const [name, drive] of states) {
    test(`${name}: every control has a name, no tabindex is positive, ids are unique, the live regions are the announcer's and the subtitle's, and Tab reaches the bar or prompt first`, () => {
      const h = mountWith(sampleBoard(), {}, { tour: sampleScript, hash: name === 'the prompt' ? '#play' : '' });
      drive(h);
      const root = h.root;
      for (const control of root.querySelectorAll('button, input, [role="switch"]')) expect(nameOf(control, root), `${control.tagName} ${control.className}`).not.toBe('');
      for (const node of root.querySelectorAll('[tabindex]')) expect(['0', '-1']).toContain(node.getAttribute('tabindex'));
      const ids = idsIn(root);
      expect(new Set(ids).size).toBe(ids.length);
      const live = root.querySelectorAll('[aria-live]').length;
      expect(live).toBe(name === 'the prompt' ? 1 : 2);
      const first = root.querySelector('a[href], button, input, [tabindex="0"]');
      expect(first?.className).toContain('skip-link');
      const second = [...root.querySelectorAll('a[href], button, input, [tabindex="0"]')][1];
      expect(second?.closest('.tour-bar, .tour-prompt'), 'the first control after the skip link belongs to the bar or the prompt').not.toBeNull();
      expect(root.querySelectorAll('h1')).toHaveLength(1);
    });
  }

  test('while it plays, the heading structure and the landmarks are the same as at rest, and the bar adds no heading', () => {
    const h = mountWith(sampleBoard(), {}, { tour: sampleScript });
    h.app.tour?.start('button');
    expect(h.root.querySelector('.tour-bar')?.querySelector('h1, h2, h3, h4')).toBeNull();
    expect(h.root.querySelectorAll('main section.region')).toHaveLength(6);
    expect(h.root.querySelectorAll('header')).toHaveLength(1 + h.root.querySelectorAll('article header').length);
  });
});