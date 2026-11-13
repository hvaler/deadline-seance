// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { effectiveUrgency } from '../../src/engine/index';
import { derive } from '../../src/ui/derive';
import { initialState } from '../../src/ui/state';
import { TAGLINE, hungerText, reasonCovered, verdictFigures } from '../../src/ui/text';
import { mountWith, region } from './harness';

const files = import.meta.glob(['../../public/favicon.svg', '../../index.html'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const read = (name: string): string => Object.entries(files).find(([path]) => path.endsWith(name))?.[1] ?? '';

afterEach(() => {
  document.body.replaceChildren();
});

describe('the verdict figures', () => {
  test('the sample night: freeze time, points available, points inside, tickets outside, all from the engine totals', () => {
    expect(verdictFigures(derive(initialState()))).toEqual([
      { tone: 'time', value: 'Fri 18:00', label: 'freeze' },
      { tone: 'available', value: '59', label: 'points available' },
      { tone: 'inside', value: '59', label: 'points inside' },
      { tone: 'outside', value: '7', label: 'tickets outside' },
    ]);
  });

  test('is painted for the eyes and hidden from assistive technology, which keeps the full sentence', () => {
    const { root } = mountWith();
    const figures = root.querySelector('.verdict-figures')!;
    expect(figures.getAttribute('aria-hidden')).toBe('true');
    expect([...figures.querySelectorAll('.figure-value')].map((n) => n.textContent)).toEqual(['Fri 18:00', '59', '59', '7']);
    expect([...figures.querySelectorAll('.figure')].map((n) => (n as HTMLElement).dataset.tone)).toEqual(['time', 'available', 'inside', 'outside']);
    const sentences = root.querySelector('.verdict-sentences')!;
    expect(sentences.classList.contains('visually-hidden')).toBe(true);
    expect(sentences.textContent).toBe('Inside the safehouse: 12 tickets, 59 of 59 points, saved cod 167. Left outside: 7 tickets, cod 101.');
    expect(figures.closest('[data-region="verdict"]')).toBe(region(root, 'verdict'));
  });

  test('an impossible freeze shows the time, the points available and the points needed, and the advice in plain sight', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 2 });
    expect([...root.querySelectorAll('.verdict-figures .figure')].map((n) => `${(n as HTMLElement).dataset.tone}:${n.querySelector('.figure-value')?.textContent}`)).toEqual([
      'time:Mon 18:00',
      'available:12',
      'needed:15',
    ]);
    expect(root.querySelector('.verdict-sentences')?.classList.contains('visually-hidden')).toBe(false);
  });

  test('one ticket outside reads in the singular', () => {
    const view = derive(initialState());
    const one = { ...view, totals: view.totals === null ? null : { ...view.totals, buriedCount: 1 } };
    expect(verdictFigures(one).at(-1)?.label).toBe('ticket outside');
  });
});

describe('the title and its tagline', () => {
  test('the tagline is painted under the title', () => {
    expect(TAGLINE).toBe('Not everything gets inside before the freeze.');
    const { root } = mountWith();
    const header = root.querySelector('header')!;
    const tagline = header.querySelector('.tagline')!;
    expect(tagline.textContent).toBe(TAGLINE);
    expect(tagline.previousElementSibling?.tagName).toBe('H1');
  });
});

describe('the hunger line', () => {
  const tombs = derive(initialState()).yard;
  const tomb = (key: string) => tombs.find((t) => t.key === key)!;

  test('is built from the engine: the urgency now and after one more release left out', () => {
    for (const key of ['HB-110', 'HB-112']) {
      const t = tomb(key);
      expect(t.nextUrgency).toBe(effectiveUrgency(t.cost.urgency, t.cost.past + 1));
      expect(hungerText(t)).toBe(`Hungrier next release: urgency ${t.cost.effectiveUrgency} → ${t.nextUrgency}`);
    }
  });

  test('exists only for a zombie with a formula', () => {
    expect(hungerText(tomb('HB-108'))).toBeNull(); // not a zombie
    expect(hungerText(tomb('HB-111'))).toBeNull(); // imported cost, no formula
    expect(tomb('HB-111').nextUrgency).toBeNull();
  });

  test('says so when the urgency cannot grow any more', () => {
    const t = { ...tomb('HB-110'), nextUrgency: tomb('HB-110').cost.effectiveUrgency };
    expect(hungerText(t)).toBe(`Urgency is already at the top: ${t.cost.effectiveUrgency}.`);
  });
});

describe('the reason is not repeated when the epitaph says it', () => {
  test('a reason is covered by an epitaph that names its numbers or keys', () => {
    expect(reasonCovered({ kind: 'no-room', needed: 8, left: 0 }, 'It needed 8 points and the night had 0 left.')).toBe(true);
    expect(reasonCovered({ kind: 'no-room', needed: 8, left: 0 }, 'It needed 8 points and the night had 3 left.')).toBe(false);
    expect(reasonCovered({ kind: 'depends-on-buried', buriedDependencies: ['HB-1', 'HB-2'] }, 'It followed HB-1 and HB-2 into the ground.')).toBe(true);
    expect(reasonCovered({ kind: 'depends-on-buried', buriedDependencies: ['HB-1', 'HB-2'] }, 'It followed HB-1 into the ground.')).toBe(false);
    expect(reasonCovered({ kind: 'blocked-by-put-down', putDownKey: 'HB-9' }, 'HB-9 was closed as Won\'t Do.')).toBe(true);
    expect(reasonCovered({ kind: 'blocked-by-put-down', putDownKey: 'HB-9' }, 'Nothing to see.')).toBe(false);
  });
});

describe('the favicon', () => {
  const svg = read('favicon.svg');

  test('is a small SVG drawn in code, linked from the page', () => {
    expect(svg.length).toBeLessThan(2000);
    expect(svg).toMatch(/^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(read('index.html')).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg">');
  });

  test('has no script, no external reference and no colour outside the palette', () => {
    expect(svg).not.toMatch(/<script|<image|<use|<foreignObject|href=|url\(|@import|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
    const palette = ['#110e16', '#3a2c22', '#4a3829', '#ebe4d3', '#a49cad', '#6f6779', '#ff3d3d', '#8fd47e', '#7d5cff', '#d9cfa6', '#b8592f', '#f1b24a'];
    const used = [...svg.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase());
    expect(used.length).toBeGreaterThan(0);
    for (const colour of used) expect(palette, colour).toContain(colour);
  });
});
