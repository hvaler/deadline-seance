// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { sampleBoard } from '../../src/ui/sample-board';
import { drag, mountWith, region, release } from './harness';
import type { Harness } from './harness';

const styles = import.meta.glob('../../src/ui/styles/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const css = (name: string): string => Object.entries(styles).find(([path]) => path.endsWith(name))?.[1] ?? '';

afterEach(() => {
  document.body.replaceChildren();
});

const block = (root: ParentNode) => region(root, 'fog');
const strip = (root: ParentNode) => region(root, 'fog-strip');
const items = (root: ParentNode): HTMLElement[] => [...strip(root).querySelectorAll<HTMLElement>('li')];
const spoken = (item: HTMLElement): string => item.querySelector('.visually-hidden')?.textContent ?? '';
const headline = (root: ParentNode): string => (block(root).querySelector('.fog-headline')?.textContent ?? '').replace(/\s+/g, ' ').trim();
const sentence = (root: ParentNode): string => block(root).querySelector('.fog-sentence')?.textContent ?? '';

function setReserve(h: Harness, pct: number): void {
  const input = h.root.querySelector<HTMLInputElement>('input[data-focus="reserve"]')!;
  drag(input, pct);
  release(input);
}

describe('the fog block on the sign', () => {
  test('replaces the slot: a painted figure with the percentage, and one sentence with the numbers behind it', () => {
    const { root } = mountWith();
    expect(root.querySelector('[data-slot="fog"]')).toBeNull();
    expect(block(root).closest('[data-region="sign"]')).not.toBeNull();
    expect(headline(root)).toBe('Holds in 0 % of 1,000 nights');
    expect(block(root).querySelector('.fog-figure')?.textContent).toBe('0 %');
    expect(sentence(root)).toBe('Inside needs 59 points on paper; the team has 59; estimates land between 80 % and 150 %. It held on 0 of 1,000 nights.');
  });

  test('follows the reserve: the figure, the sentence and the count change with it', () => {
    const h = mountWith();
    setReserve(h, 15);
    expect(headline(h.root)).toBe('Holds in 34 % of 1,000 nights');
    expect(sentence(h.root)).toBe('Inside needs 49 points on paper; the team has 59; estimates land between 80 % and 150 %. It held on 347 of 1,000 nights.');
    setReserve(h, 30);
    expect(block(h.root).querySelector('.fog-figure')?.textContent).toBe('99 %');
  });

  test('a point whose floored percentage is 0 while some nights hold still says how many: 0 % and "6 of 1,000 nights"', () => {
    const h = mountWith();
    setReserve(h, 5);
    expect(block(h.root).querySelector('.fog-figure')?.textContent).toBe('0 %');
    expect(sentence(h.root)).toBe('Inside needs 56 points on paper; the team has 59; estimates land between 80 % and 150 %. It held on 6 of 1,000 nights.');
    const current = items(h.root).find((i) => i.getAttribute('aria-current') === 'true')!;
    expect(current.querySelector('.strip-chance')?.textContent).toBe('0 %');
    expect(spoken(current)).toBe('5 % reserve (current): holds in 0 % of 1,000 nights (6 nights)');
  });

  test('follows the candle', () => {
    const h = mountWith();
    h.app.store.dispatch({ type: 'candle/set', step: 8 });
    expect(headline(h.root)).toMatch(/^Holds in \d+ % of 1,000 nights$/);
    expect(sentence(h.root)).toMatch(/^Inside needs \d+ points on paper; the team has \d+;/);
  });

  test('does not take the class of the drifting fog on the screen (that one is a canvas in the atmosphere)', () => {
    const { root } = mountWith();
    expect(block(root).classList.contains('fog')).toBe(false);
    expect([...root.querySelectorAll('.fog')].map((n) => n.tagName)).toEqual(['CANVAS']);
  });

  test('the figure is real text, not hidden from assistive technology, and the block is a labelled region that is not live', () => {
    const { root } = mountWith();
    const fog = block(root);
    expect(fog.tagName).toBe('SECTION');
    expect(fog.closest('[aria-hidden="true"]')).toBeNull();
    const label = fog.getAttribute('aria-labelledby')!;
    expect(root.querySelector(`[id="${label}"]`)?.textContent).toBe(headline(root));
    expect(fog.querySelector('[aria-live], [role="alert"], [role="status"]')).toBeNull();
    expect(fog.querySelector('img, svg, canvas')).toBeNull();
    expect(fog.querySelector('a, button, input, [tabindex]')).toBeNull();
  });

  test('has no colour or wording by threshold: the same classes whatever the chance', () => {
    const h = mountWith();
    const classes = new Set<string>();
    for (const pct of [0, 5, 10, 15, 20, 25, 30]) {
      setReserve(h, pct);
      classes.add([...block(h.root).querySelectorAll('*')].map((n) => n.className).join('|') + block(h.root).className);
      expect(block(h.root).querySelector('.fog-figure')?.getAttribute('data-tone')).toBeNull();
    }
    expect(classes.size).toBe(1);
  });

  test('an impossible freeze says there is no cut to test, with the engine numbers, and shows no percentage', () => {
    const h = mountWith();
    h.app.store.dispatch({ type: 'candle/set', step: 2 });
    expect(headline(h.root)).toBe('No cut to test');
    expect(block(h.root).querySelector('.fog-figure')?.hasAttribute('hidden')).toBe(true);
    expect(sentence(h.root)).toBe('No cut to test: the must-haves need 15 points; 12 are available after the 0 % reserve.');
    expect(block(h.root).textContent).not.toMatch(/\d+ %\s*of/);
  });

  test('a board with nothing on it holds on every night, with no special case on the screen: "needs 0 points", 100 %', () => {
    const h = mountWith({ ...sampleBoard(), tickets: [], wontDo: [] });
    expect(block(h.root).querySelector('.fog-figure')?.textContent).toBe('100 %');
    expect(sentence(h.root)).toBe('Inside needs 0 points on paper; the team has 59; estimates land between 80 % and 150 %. It held on 1,000 of 1,000 nights.');
    expect(spoken(items(h.root)[0]!)).toBe('0 % reserve (current): holds in 100 % of 1,000 nights (1,000 nights)');
  });
});

describe('the strip under the reserve slider', () => {
  test('is an ordered list of the seven reserve steps, in the reserve control, after the slider and before its hint', () => {
    const { root } = mountWith();
    const list = strip(root);
    expect(list.tagName).toBe('OL');
    expect(list.getAttribute('role')).toBe('list');
    expect(list.getAttribute('aria-label')).toBe('Chance the shelter holds, at each reserve');
    expect(items(root)).toHaveLength(7);
    expect(items(root).map((i) => i.dataset.reserve)).toEqual(['0', '5', '10', '15', '20', '25', '30']);
    const reserve = list.parentElement!;
    expect(reserve.className).toBe('reserve');
    const order = [...reserve.children].map((c) => (c as HTMLElement).tagName + '.' + c.className.split(' ')[0]);
    expect(order.indexOf('OL.fog-strip')).toBeGreaterThan(order.indexOf('INPUT.range'));
    expect(order.indexOf('OL.fog-strip')).toBeLessThan(order.indexOf('P.reserve-hint'));
  });

  test('shows each reserve and its chance as text, with the sentence for a screen reader', () => {
    const { root } = mountWith();
    const rows = items(root).map((i) => [i.querySelector('.strip-reserve')?.textContent, i.querySelector('.strip-chance')?.textContent]);
    expect(rows).toEqual([['0 %', '0 %'], ['5 %', '0 %'], ['10 %', '13 %'], ['15 %', '34 %'], ['20 %', '70 %'], ['25 %', '95 %'], ['30 %', '99 %']]);
    expect(items(root).map(spoken)).toEqual([
      '0 % reserve (current): holds in 0 % of 1,000 nights (0 nights)',
      '5 % reserve: holds in 0 % of 1,000 nights (6 nights)',
      '10 % reserve: holds in 13 % of 1,000 nights (134 nights)',
      '15 % reserve: holds in 34 % of 1,000 nights (347 nights)',
      '20 % reserve: holds in 70 % of 1,000 nights (707 nights)',
      '25 % reserve: holds in 95 % of 1,000 nights (959 nights)',
      '30 % reserve: holds in 99 % of 1,000 nights (996 nights)',
    ]);
  });

  test('the visible parts are hidden from a screen reader, so nothing is read twice', () => {
    const { root } = mountWith();
    for (const item of items(root)) {
      for (const part of item.querySelectorAll('.strip-reserve, .strip-bar, .strip-chance, .strip-now')) expect(part.getAttribute('aria-hidden')).toBe('true');
      expect(item.querySelector('.visually-hidden')?.hasAttribute('aria-hidden')).toBe(false);
    }
  });

  test('marks the current reserve by more than colour: the word "now" and aria-current, on exactly one item', () => {
    const h = mountWith();
    for (const [pct, index] of [[0, 0], [10, 2], [30, 6], [5, 1]] as const) {
      setReserve(h, pct);
      const all = items(h.root);
      expect(all.filter((i) => i.getAttribute('aria-current') === 'true')).toEqual([all[index]]);
      expect(all.map((i) => i.querySelector('.strip-now')?.textContent)).toEqual(all.map((_, i) => (i === index ? 'now' : '')));
      expect(spoken(all[index]!)).toContain('(current)');
      expect(all.filter((i) => spoken(i).includes('(current)'))).toHaveLength(1);
    }
  });

  test('moving the reserve only moves the highlight: the numbers of the other steps do not change', () => {
    const h = mountWith();
    const before = items(h.root).map((i) => i.querySelector('.strip-chance')?.textContent);
    setReserve(h, 20);
    expect(items(h.root).map((i) => i.querySelector('.strip-chance')?.textContent)).toEqual(before);
  });

  test('the bar is drawn from the engine percentage, as a custom property set through the CSSOM', () => {
    const { root } = mountWith();
    expect(items(root).map((i) => (i.querySelector('.strip-fill') as HTMLElement).style.getPropertyValue('--pct'))).toEqual(['0', '0', '13', '34', '70', '95', '99']);
  });

  test('an impossible freeze: every step says so, none is current-marked as a chance, and no percentage is invented', () => {
    const h = mountWith();
    h.app.store.dispatch({ type: 'candle/set', step: 0 });
    expect(items(h.root).map((i) => i.querySelector('.strip-chance')?.textContent)).toEqual(Array(7).fill('—'));
    expect(items(h.root).every((i) => spoken(i).endsWith('impossible freeze') || spoken(i).endsWith('impossible freeze'))).toBe(true);
    expect(spoken(items(h.root)[0]!)).toBe('0 % reserve (current): impossible freeze');
    expect((items(h.root)[0]!.querySelector('.strip-fill') as HTMLElement).style.getPropertyValue('--pct')).toBe('0');
  });

  test('takes no focus and has no action: no button, no link, no tabindex, no listener target', () => {
    const { root } = mountWith();
    expect(strip(root).querySelector('a, button, input, select, [tabindex], [role="button"]')).toBeNull();
    expect(strip(root).querySelector('[aria-live], [role="alert"]')).toBeNull();
  });

  test('does not rank the steps: no best, no recommended, no trend', () => {
    const { root } = mountWith();
    const text = strip(root).textContent + block(root).textContent;
    expect(text).not.toMatch(/best|recommend|highest|lowest|trend|safe|better/i);
    expect(strip(root).querySelector('svg, path, line, canvas')).toBeNull();
    expect(new Set(items(root).map((i) => i.className)).size).toBe(1);
  });
});

describe('the strip lines up with the slider (measured in a real browser; here, what the styles promise)', () => {
  test('each chance is a number with its percent sign under it, and still reads "34 %" as text', () => {
    const { root } = mountWith();
    for (const item of items(root)) {
      const chance = item.querySelector('.strip-chance')!;
      expect([...chance.children].map((c) => c.className)).toEqual(['strip-number', 'strip-percent']);
    }
    expect(items(root).map((i) => i.querySelector('.strip-number')?.textContent)).toEqual(['0', '0', '13', '34', '70', '95', '99']);
    expect(items(root).map((i) => i.querySelector('.strip-percent')?.textContent)).toEqual(Array(7).fill(' %'));
  });

  test('an impossible freeze keeps the line of the percent sign, empty, so the strip does not change height', () => {
    const h = mountWith();
    h.app.store.dispatch({ type: 'candle/set', step: 0 });
    expect(items(h.root).map((i) => i.querySelector('.strip-number')?.textContent)).toEqual(Array(7).fill('—'));
    expect(items(h.root).map((i) => i.querySelector('.strip-percent')?.textContent)).toEqual(Array(7).fill(''));
    expect(css('components.css')).toMatch(/\.strip-percent\s*\{[^}]*min-height:\s*1\.1em/);
  });

  test('the strip is as wide as the slider plus (W - thumb) / 6 minus the thumb, so the item centres sit on the thumb centres', () => {
    expect(css('components.css')).toMatch(/\.fog-strip\s*\{[^}]*margin-inline:\s*calc\(var\(--thumb\) \/ 2 - \(100% - var\(--thumb\)\) \/ 12\)/);
    expect(css('components.css')).toMatch(/\.fog-strip\s*\{[^}]*grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/);
    expect(css('components.css')).toMatch(/\.fog-strip\s*\{[^}]*padding:\s*6px 0;/);
  });

  test('on a phone the slider takes a row of its own and the strip the row under it, in the same columns', () => {
    const layout = css('layout.css');
    expect(layout).toMatch(/@media \(max-width: 639\.98px\)\s*\{\s*\.reserve\s*\{[^}]*grid-template-areas:\s*'label output'\s*'range range'\s*'strip strip'\s*'hint hint'/);
    expect(layout).toMatch(/\.fog-strip\s*\{\s*grid-area:\s*strip;/);
    expect(layout).toMatch(/\.reserve-range\s*\{\s*grid-area:\s*range;/);
  });

  test('on a wide screen the strip is in the slider\'s column', () => {
    expect(css('layout.css')).toMatch(/\.fog-strip\s*\{\s*grid-column:\s*2;/);
  });
});