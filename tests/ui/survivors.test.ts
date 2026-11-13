// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { sampleBoard } from '../../src/ui/sample-board';
import { byFocus, mountWith, region, texts } from './harness';

afterEach(() => {
  document.body.replaceChildren();
});

const switches = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('[data-region="survivors"] button[role="switch"]')];

/** The accessible name of an element built from aria-labelledby, as a screen reader would compute it. */
function nameOf(root: ParentNode, node: HTMLElement): string {
  const ids = (node.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => root.querySelector(`#${id}`)?.textContent ?? '').join(' ');
}

describe('survivors', () => {
  test('one switch per person, in the order of the board, all here at the start', () => {
    const { root } = mountWith();
    expect(switches(root)).toHaveLength(4);
    expect(switches(root).map((s) => s.dataset.name)).toEqual(['Ana', 'Bruno', 'Carla', 'Dev']);
    expect(switches(root).map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true', 'true', 'true']);
    expect(texts(switches(root).map((s) => s.querySelector('.chip-state')!))).toEqual(['Here', 'Here', 'Here', 'Here']);
  });

  test('each switch is a native button with role switch, named by the person and the points per half day', () => {
    const { root } = mountWith();
    for (const s of switches(root)) {
      expect(s.tagName).toBe('BUTTON');
      expect(s.getAttribute('type')).toBe('button');
      expect(s.getAttribute('tabindex')).toBeNull();
    }
    expect(nameOf(root, switches(root)[0]!)).toBe('Ana 2 points per half day');
    expect(nameOf(root, switches(root)[2]!)).toBe('Carla 1 point per half day');
    const describedBy = switches(root)[0]!.getAttribute('aria-describedby') ?? '';
    expect(root.querySelector(`#${describedBy}`)?.textContent).toBe('Here');
  });

  test('pressing a switch sends the person away: the capacity falls and the diff is shown', () => {
    const { root, app } = mountWith();
    byFocus(root, 'survivor:Ana').click();
    expect(app.store.getState().away).toEqual(['Ana']);
    const ana = byFocus(root, 'survivor:Ana');
    expect(ana.getAttribute('aria-checked')).toBe('false');
    expect(ana.querySelector('.chip-state')?.textContent).toBe('Away');
    expect(ana.closest('li')?.classList.contains('is-away')).toBe(true);
    expect(region(root, 'candle').querySelector('.candle-capacity')?.textContent).toBe('39 points');
    expect(region(root, 'change').querySelector('.change-headline')?.textContent).toBe('Ana sent away.');
    expect(texts(region(root, 'change').querySelectorAll('li'))).toEqual([
      'Sinks: HB-113 (14), HB-115 (13), HB-118 (16); together 43.',
      'Loss: 43.',
      'Saved cod 167 → 124.',
    ]);
  });

  test('pressing it again brings the person back, and the cut returns', () => {
    const { root, app } = mountWith();
    byFocus(root, 'survivor:Ana').click();
    byFocus(root, 'survivor:Ana').click();
    expect(app.store.getState().away).toEqual([]);
    expect(byFocus(root, 'survivor:Ana').getAttribute('aria-checked')).toBe('true');
    expect(region(root, 'change').querySelector('.change-headline')?.textContent).toBe('Ana is back.');
    expect(region(root, 'candle').querySelector('.candle-capacity')?.textContent).toBe('59 points');
  });

  test('the same switch element is kept (so keyboard focus stays on it)', () => {
    const { root } = mountWith();
    const before = byFocus(root, 'survivor:Bruno');
    before.focus();
    before.click();
    expect(byFocus(root, 'survivor:Bruno')).toBe(before);
    expect(document.activeElement).toBe(before);
  });

  test("a day off stays on the board: Dev's is written next to Dev", () => {
    const { root } = mountWith();
    const notes = texts(root.querySelectorAll('.team-member .chip-note'));
    expect(notes).toEqual(['', '', '', 'Day off: 2026-11-18 afternoon']);
  });

  test('everybody away: capacity 0 and the verdict says the must-haves do not fit', () => {
    const { root } = mountWith();
    for (const name of ['Ana', 'Bruno', 'Carla', 'Dev']) byFocus(root, `survivor:${name}`).click();
    expect(region(root, 'candle').querySelector('.candle-capacity')?.textContent).toBe('0 points');
    expect(texts(region(root, 'verdict').querySelectorAll('p'))[0]).toBe('The must-haves need 15 points; there are 0 (0 after the 0 % reserve).');
  });

  test('survivors keep their order when the state changes', () => {
    const { root } = mountWith();
    byFocus(root, 'survivor:Carla').click();
    byFocus(root, 'survivor:Ana').click();
    expect(switches(root).map((s) => s.dataset.name)).toEqual(['Ana', 'Bruno', 'Carla', 'Dev']);
  });

  test('the list is a list for assistive technology', () => {
    const { root } = mountWith();
    expect(root.querySelector('[data-region="survivors"] ul')?.getAttribute('role')).toBe('list');
  });
});

describe('survivors: text stays text', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';

  test('a person named with markup is shown as text, in the name, the label and the day-off note', () => {
    const board = sampleBoard();
    const people = board.people.map((p) => (p.name === 'Ana' ? { ...p, name: PAYLOAD, daysOff: [{ date: '2026-11-17', part: 'full' as const }] } : p));
    const { root } = mountWith({ ...board, people });
    expect(document.querySelector('img')).toBeNull();
    const chip = root.querySelector<HTMLElement>('.team-member');
    expect(chip?.querySelector('.chip-name')?.textContent).toBe(PAYLOAD);
    expect(chip?.querySelector('.chip-note')?.textContent).toBe('Day off: 2026-11-17 all day');
    expect(nameOf(root, chip!.querySelector('button')!)).toBe(`${PAYLOAD} 2 points per half day`);
    expect(chip?.querySelector('[onerror]')).toBeNull();
  });

  test('pressing the switch of a person with markup in the name still works', () => {
    const board = sampleBoard();
    const people = board.people.map((p) => (p.name === 'Ana' ? { ...p, name: '"><b onclick=alert(1)>Ana</b>' } : p));
    const { root, app } = mountWith({ ...board, people });
    byFocus(root, 'survivor:"><b onclick=alert(1)>Ana</b>').click();
    expect(app.store.getState().away).toEqual(['"><b onclick=alert(1)>Ana</b>']);
    expect(document.querySelector('b')).toBeNull();
  });
});
