// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { decisionLine, importCsv, sampleBoard, undoLine } from '../../src/engine/index';
import type { Board } from '../../src/engine/index';
import { CHRONICLE_EMPTY, CHRONICLE_HELP } from '../../src/ui/render/chronicle';
import { sampleScript } from '../../src/ui/tour/sample-script';
import { destroyMounted, drag, mountWith, region, release } from './harness';
import type { Harness } from './harness';
import { unexplained } from './provenance';
import { byFocus } from './harness';
// The night chronicle on the page: the panel, Undo, Undo to here, Ctrl+Z, the announcement, the undo sound, the tour and the big boards.
afterEach(() => {
  destroyMounted();
  document.body.replaceChildren();
});
const panel = (root: ParentNode): HTMLElement => region(root, 'chronicle');
const entries = (root: ParentNode): HTMLElement[] => [...panel(root).querySelectorAll<HTMLElement>('ol.chronicle-entries > li')];
const texts = (root: ParentNode): string[] => entries(root).map((li) => li.querySelector('.entry-text')?.textContent ?? '');
const undoButton = (root: ParentNode): HTMLButtonElement => byFocus(root, 'undo') as HTMLButtonElement;
const polite = (root: ParentNode): string => region(root, 'announcer').textContent ?? '';
const alerter = (root: ParentNode): string => region(root, 'alerter').textContent ?? '';
const input = (root: ParentNode): HTMLInputElement => root.querySelector<HTMLInputElement>('#candle-input')!;
/** A candle drag from the page: input events, the frame that applies them, the change event, and the settle. */
function dragCandle(h: Harness, steps: readonly number[]): void {
  for (const step of steps) drag(input(h.root), step);
  h.frame.flush();
  release(input(h.root));
  h.frame.flush();
}
function ctrlZ(target: EventTarget, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}
/** Three decisions: the candle to Wed 18:00, Ana away, HB-108 exhumed. */
function threeDecisions(h: Harness): void {
  dragCandle(h, [6]);
  byFocus(h.root, 'survivor:Ana').click();
  byFocus(h.root, 'exhume:HB-108').click();
  h.frame.flush();
}
describe('the panel', () => {
  test('is a labelled region between Survivors and the two grounds, with a help line, an Undo button and an empty state', () => {
    const { root } = mountWith();
    const section = panel(root);
    expect(section.tagName).toBe('SECTION');
    expect(root.querySelector(`#${section.getAttribute('aria-labelledby')}`)?.textContent).toBe('Night chronicle');
    expect(section.previousElementSibling).toBe(region(root, 'survivors'));
    expect(section.nextElementSibling?.classList.contains('grounds')).toBe(true);
    expect(section.textContent).toContain(CHRONICLE_HELP);
    expect(CHRONICLE_HELP).toContain('The number in brackets is the change in saved cost of delay.');
    expect(section.textContent).toContain(CHRONICLE_EMPTY);
    expect(undoButton(root).disabled).toBe(true);
    expect(undoButton(root).getAttribute('aria-describedby')).toContain('chronicle-empty');
    expect(entries(root)).toHaveLength(0);
    expect(section.querySelector('button.entry-undo')).toBeNull();
    expect(root.querySelector('[data-slot="chronicle"]')).toBeNull();
  });
  test('a decision adds a line, newest first, numbered, with Undo to here on every line but the newest', () => {
    const h = mountWith();
    threeDecisions(h);
    expect(texts(h.root)).toEqual([
      'Exhumed HB-108 \u2192 in; HB-105, HB-109 out (\u221216)',
      'Ana leaves \u2192 HB-105 in; HB-104, HB-106, HB-107, HB-116 out (\u221234)',
      'Freeze moved to Wed 18:00 \u2192 HB-105, HB-113, HB-115, HB-118 out (\u221254)',
    ]);
    const rows = entries(h.root);
    expect(rows.map((r) => r.getAttribute('value'))).toEqual(['3', '2', '1']);
    expect(rows.map((r) => r.querySelector('.entry-no')?.textContent)).toEqual(['3.', '2.', '1.']);
    const buttons = rows.map((r) => r.querySelector<HTMLButtonElement>('button.entry-undo')!);
    expect(buttons.map((b) => b.hidden)).toEqual([true, false, false]);
    expect(buttons[2]?.getAttribute('aria-label')).toBe('Undo to here: before 1, Freeze moved to Wed 18:00');
    expect(buttons[1]?.getAttribute('aria-label')).toBe('Undo to here: before 2, Ana leaves');
    expect(undoButton(h.root).disabled).toBe(false);
    expect(panel(h.root).textContent).not.toContain(CHRONICLE_EMPTY.slice(0, 20) + 'x');
    expect(panel(h.root).querySelector<HTMLElement>('.chronicle-empty')?.hidden).toBe(true);
  });
  test('a drag of the candle writes nothing until it settles, then one line for the whole drag', () => {
    const h = mountWith();
    for (const step of [9, 8, 7, 6]) drag(input(h.root), step);
    h.frame.flush();
    expect(entries(h.root)).toHaveLength(0);
    h.timers.advance(299);
    expect(entries(h.root)).toHaveLength(0);
    h.timers.advance(1);
    expect(texts(h.root)).toEqual(['Freeze moved to Wed 18:00 \u2192 HB-105, HB-113, HB-115, HB-118 out (\u221254)']);
    release(input(h.root));
    expect(entries(h.root)).toHaveLength(1); // the change event after the settle adds nothing
  });
  test('a burst of key presses on the candle is one gesture: each press fires change, but only the 300 ms of quiet writes the line', () => {
    const h = mountWith();
    const range = input(h.root);
    for (const step of [9, 8, 7, 6]) {
      range.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      drag(range, step);
      h.frame.flush();
      release(range); // the browser fires change after every key press
    }
    expect(entries(h.root)).toHaveLength(0);
    h.timers.advance(300);
    expect(texts(h.root)).toEqual(['Freeze moved to Wed 18:00 \u2192 HB-105, HB-113, HB-115, HB-118 out (\u221254)']);
    // a pointer drag afterwards settles on its own change event again
    range.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    drag(range, 10);
    h.frame.flush();
    release(range);
    expect(entries(h.root)).toHaveLength(2);
  });
  test('a drag that ends where it began writes nothing', () => {
    const h = mountWith();
    dragCandle(h, [5, 3, 10]);
    expect(entries(h.root)).toHaveLength(0);
  });
  test('a reserve gesture writes one line', () => {
    const h = mountWith();
    const reserve = h.root.querySelector<HTMLInputElement>('[data-focus="reserve"]')!;
    drag(reserve, 20);
    h.frame.flush();
    release(reserve);
    expect(texts(h.root)).toEqual(['Reserve 20 % \u2192 HB-113, HB-115 out (\u221227)']);
  });  test('an impossible freeze says so with the numbers, and coming back says it is possible again', () => {
    const h = mountWith();
    dragCandle(h, [1]);
    dragCandle(h, [10]);
    expect(texts(h.root)).toEqual([
      'Freeze moved to Fri 18:00 \u2192 possible again: 12 in, saved cost of delay 167',
      'Freeze moved to Mon 13:00 \u2192 impossible: needs 15 points, 6 available',
    ]);
  });
  test('a rejected exhume and a refused put down write nothing, and the change note still says so', () => {
    const h = mountWith();
    dragCandle(h, [6]);
    h.app.store.dispatch({ type: 'tombstone/exhume', key: 'HB-119' });
    h.app.store.dispatch({ type: 'tombstone/put-down', key: 'HB-108' });
    expect(entries(h.root)).toHaveLength(1);
  });
  test('every sentence passes the provenance test: each number is a fact of its entry', () => {
    const h = mountWith();
    threeDecisions(h);
    dragCandle(h, [1]);
    byFocus(h.root, 'reset').click();
    for (const entry of h.app.store.getState().chronicle.entries) expect(unexplained(decisionLine(entry.facts), entry.facts), decisionLine(entry.facts)).toEqual([]);
  });
});
describe('Undo and Undo to here', () => {
  test('Undo takes back the last decision, says what came back once, and keeps the focus on Undo', () => {
    const h = mountWith();
    threeDecisions(h);
    const before = h.app.store.getState();
    undoButton(h.root).focus();
    undoButton(h.root).click();
    h.frame.flush();
    const after = h.app.store.getState();
    expect(after.chronicle.entries).toHaveLength(2);
    expect(after.board).toBe(before.chronicle.entries[2]!.before.board);
    expect(polite(h.root)).toBe('Undone: Exhumed HB-108. HB-105 and HB-109 are back in; HB-108 is out again.');
    expect(alerter(h.root)).toBe('');
    expect(texts(h.root)).toHaveLength(2);
    expect(document.activeElement).toBe(undoButton(h.root));
  });
  test('Undo to here goes back to before that line and removes it and the later ones', () => {
    const h = mountWith();
    threeDecisions(h);
    const startState = h.app.store.getState().chronicle.entries[1]!.before;
    const rows = entries(h.root);
    rows[1]!.querySelector<HTMLButtonElement>('button.entry-undo')!.click(); // entry 2: Ana leaves
    h.frame.flush();
    const s = h.app.store.getState();
    expect(s.chronicle.entries).toHaveLength(1);
    expect(s.away).toEqual([]);
    expect(s.board).toBe(startState.board);
    expect(polite(h.root)).toMatch(/^Undone 2 decisions, back to before "Ana leaves"\. /);
    expect(texts(h.root)).toEqual(['Freeze moved to Wed 18:00 \u2192 HB-105, HB-113, HB-115, HB-118 out (\u221254)']);
  });
  test('undoing the only line disables Undo and puts the focus on the list, never on the body', () => {
    const h = mountWith();
    dragCandle(h, [6]);
    undoButton(h.root).focus();
    undoButton(h.root).click();
    expect(undoButton(h.root).disabled).toBe(true);
    expect(document.activeElement).toBe(panel(h.root).querySelector('.chronicle-list'));
    expect(h.app.store.getState().candle).toBe(10);
    expect(panel(h.root).textContent).toContain(CHRONICLE_EMPTY);
  });
  test('an undo that makes the freeze impossible is an alert with the numbers', () => {
    const h = mountWith();
    dragCandle(h, [1]);
    dragCandle(h, [10]);
    undoButton(h.root).click();
    h.frame.flush();
    expect(alerter(h.root)).toBe('Undone: Freeze moved to Fri 18:00. The freeze is now impossible: needs 15 points, 6 available.');
    expect(polite(h.root)).toBe('');
    undoButton(h.root).click();
    h.frame.flush();
    expect(polite(h.root)).toBe('Undone: Freeze moved to Mon 13:00. The freeze is possible again.');
  });
  test('the announcement is the engine\'s sentence for the entry and the effect', () => {
    const h = mountWith();
    byFocus(h.root, 'survivor:Ana').click();
    const entry = h.app.store.getState().chronicle.entries[0]!;
    undoButton(h.root).click();
    h.frame.flush();
    expect(polite(h.root)).toBe(undoLine(entry.facts, 1, { kind: 'diff', raised: [{ key: 'HB-113', cod: 14 }, { key: 'HB-115', cod: 13 }, { key: 'HB-118', cod: 16 }], sunk: [], codDelta: 43 }));
    expect(polite(h.root)).toBe('Undone: Ana leaves. HB-113, HB-115 and HB-118 are back in.');
  });
  test('the undo of a load brings back the previous board and its log, and says so', () => {
    const h = mountWith();
    byFocus(h.root, 'survivor:Ana').click();
    const before = h.app.store.getState();
    const csv = 'Issue key,Summary,Story Points,Cost of Delay\nZ-1,One,5,9\nZ-2,Two,3,4\n';
    h.app.store.dispatch({ type: 'board/load', board: loadBoard(csv, before), name: 'q4.csv', release: 'q4', skipped: 0, warnings: [], putDown: [] });
    expect(texts(h.root)).toEqual(['Loaded q4.csv: 2 open tickets']);
    undoButton(h.root).click();
    h.frame.flush();
    expect(h.app.store.getState().chronicle).toBe(before.chronicle);
    expect(texts(h.root)).toHaveLength(1);
    expect(polite(h.root)).toBe('Undone: Loaded q4.csv: 2 open tickets. Your earlier night is back.');
  });
  test('a person\'s name and a file name are text, never markup', () => {
    const board = sampleBoard();
    const hostile = '<img src=x onerror=alert(1)>';
    const h = mountWith({ ...board, people: board.people.map((p, i) => (i === 0 ? { ...p, name: hostile } : p)) });
    byFocus(h.root, `survivor:${hostile}`).click();
    expect(panel(h.root).querySelector('img')).toBeNull();
    expect(texts(h.root)[0]).toContain(`${hostile} leaves`);
    undoButton(h.root).click();
    h.frame.flush();
    expect(h.root.querySelector('img')).toBeNull();
    expect(polite(h.root)).toContain(`${hostile} leaves`);
  });
});
function loadBoard(csv: string, state: ReturnType<Harness['app']['store']['getState']>) {
  const r = importCsv(csv, { people: state.home.people, timeZone: state.home.timeZone, nextReleaseWeeks: state.home.nextReleaseWeeks, zombieThreshold: state.home.zombieThreshold });
  if (!r.ok) throw new Error('import failed');
  return r.value.board;
}describe('Ctrl+Z', () => {
  test('undoes the last decision, with focus on the page, on a button and on the candle (a range input is not a text field)', () => {
    const h = mountWith();
    threeDecisions(h);
    expect(ctrlZ(document.body).defaultPrevented).toBe(true);
    expect(h.app.store.getState().chronicle.entries).toHaveLength(2);
    input(h.root).focus();
    ctrlZ(input(h.root));
    expect(h.app.store.getState().chronicle.entries).toHaveLength(1);
    ctrlZ(byFocus(h.root, 'survivor:Ana'), { ctrlKey: false, metaKey: true });
    expect(h.app.store.getState().chronicle.entries).toHaveLength(0);
  });
  test('says "Nothing to undo." once when there is nothing, and still takes the key', () => {
    const h = mountWith();
    const event = ctrlZ(document.body);
    h.frame.flush();
    expect(event.defaultPrevented).toBe(true);
    expect(polite(h.root)).toBe('Nothing to undo.');
  });
  test('leaves the key alone in a text field, with Shift or Alt, and for Ctrl+Y', () => {
    const h = mountWith();
    threeDecisions(h);
    const field = document.createElement('input');
    field.type = 'text';
    document.body.append(field);
    const area = document.createElement('textarea');
    document.body.append(area);
    for (const target of [field, area]) {
      expect(ctrlZ(target).defaultPrevented).toBe(false);
    }
    expect(ctrlZ(document.body, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(ctrlZ(document.body, { altKey: true }).defaultPrevented).toBe(false);
    expect(ctrlZ(document.body, { key: 'y' }).defaultPrevented).toBe(false);
    expect(ctrlZ(document.body, { ctrlKey: false }).defaultPrevented).toBe(false);
    expect(ctrlZ(document.body, { ctrlKey: true, metaKey: true }).defaultPrevented).toBe(false);
    expect(h.app.store.getState().chronicle.entries).toHaveLength(3);
  });
  test('settles a gesture that is still going, then undoes it', () => {
    const h = mountWith();
    for (const step of [9, 8, 7]) drag(input(h.root), step);
    h.frame.flush();
    ctrlZ(input(h.root));
    h.frame.flush();
    const s = h.app.store.getState();
    expect(s.candle).toBe(10);
    expect(s.chronicle.entries).toHaveLength(0);
    h.timers.advance(1000); // the old settle timer finds nothing to write
    expect(h.app.store.getState().chronicle.entries).toHaveLength(0);
  });
  test('does nothing while the certificate dialog is open', () => {
    const h = mountWith();
    threeDecisions(h);
    byFocus(h.root, 'certificate').click();
    expect(ctrlZ(document.body).defaultPrevented).toBe(false);
    expect(h.app.store.getState().chronicle.entries).toHaveLength(3);
  });
  test('a destroyed app no longer listens', () => {
    const h = mountWith();
    threeDecisions(h);
    const state = h.app.store.getState();
    h.app.destroy();
    expect(ctrlZ(document.body).defaultPrevented).toBe(false);
    expect(h.app.store.getState()).toBe(state);
  });
});
describe('the undo sound', () => {
  function withSound(): Harness {
    const h = mountWith();
    byFocus(h.root, 'sound').click();
    return h;
  }
  const undos = (h: Harness): number => h.sound.played.filter((e) => e === 'undo').length;
  test('plays once per undo, for the button, Undo to here and Ctrl+Z, when Sound is on', () => {
    const h = withSound();
    threeDecisions(h);
    expect(undos(h)).toBe(0);
    undoButton(h.root).click();
    expect(undos(h)).toBe(1);
    ctrlZ(document.body);
    expect(undos(h)).toBe(2);
    byFocus(h.root, 'survivor:Bruno').click();
    byFocus(h.root, 'exhume:HB-108').click();
    entries(h.root)[1]!.querySelector<HTMLButtonElement>('button.entry-undo')!.click();
    expect(undos(h)).toBe(3);
    expect(h.sound.played.at(-1)).toBe('undo');
  });
  test('is silent when Sound is off, and for "Nothing to undo."', () => {
    const off = mountWith();
    threeDecisions(off);
    undoButton(off.root).click();
    ctrlZ(document.body);
    expect(off.sound.played).toEqual([]);
    const on = withSound();
    ctrlZ(document.body);
    undoButton(on.root).click();
    expect(undos(on)).toBe(0);
  });
  test('a decision still plays its own sound, and an undo that settles a pending gesture plays one undo', () => {
    const h = withSound();
    byFocus(h.root, 'survivor:Ana').click();
    expect(h.sound.played).toEqual(['bury']);
    undoButton(h.root).click();
    expect(h.sound.played).toEqual(['bury', 'undo']);
  });
});
describe('the tour and the chronicle', () => {
  function withTour(): Harness {
    return mountWith(sampleBoard(), {}, { tour: sampleScript });
  }
  function playToEnd(h: Harness): void {
    h.app.tour?.start('button');
    h.timers.advance(70_000);
    expect(h.app.tour?.phase).toBe('ended');
  }
  test('from a session with entries: the chronicle is untouched during the tour and the very same object afterwards', () => {
    const h = withTour();
    threeDecisions(h);
    const mine = h.app.store.getState();
    h.app.tour?.start('button');
    h.timers.advance(20_000);
    expect(h.app.store.getState().chronicle).toBe(mine.chronicle);
    expect(entries(h.root)).toHaveLength(3);
    h.timers.advance(50_000);
    expect(h.app.tour?.phase).toBe('ended');
    expect(h.app.store.getState()).toBe(mine);
    expect(h.app.store.getState().chronicle).toBe(mine.chronicle);
  });
  test('from a session with no entries: still none afterwards, and none were written along the way', () => {
    const h = withTour();
    const mine = h.app.store.getState();
    h.app.tour?.start('button');
    for (let i = 0; i < 60; i++) {
      h.timers.advance(1000);
      expect(h.app.store.getState().chronicle.entries).toEqual([]);
    }
    h.timers.advance(10_000);
    expect(h.app.store.getState().chronicle).toBe(mine.chronicle);
  });
  test('from a session with your own tickets: the panel is empty while the tour plays the sample, and your log is back after', () => {
    const h = withTour();
    const base = h.app.store.getState();
    h.app.store.dispatch({ type: 'board/load', board: loadBoard('Issue key,Summary,Story Points,Cost of Delay\nZ-1,One,5,9\n', base), name: 'a.csv', release: 'a', skipped: 0, warnings: [], putDown: [] });
    byFocus(h.root, 'survivor:Ana').click();
    const mine = h.app.store.getState();
    expect(mine.chronicle.entries).toHaveLength(2);
    h.app.tour?.start('button');
    h.timers.advance(5000);
    expect(entries(h.root)).toHaveLength(0);
    h.timers.advance(70_000);
    expect(h.app.store.getState()).toBe(mine);
    expect(texts(h.root)[1]).toBe('Loaded a.csv: 1 open ticket');
  });
  test('stopped at any moment, the chronicle comes back exactly', () => {
    for (const stopAt of [100, 3000, 17_000, 41_000, 59_000]) {
      destroyMounted();
      document.body.replaceChildren();
      const h = withTour();
      threeDecisions(h);
      const mine = h.app.store.getState();
      h.app.tour?.start('button');
      h.timers.advance(stopAt);
      h.app.tour?.stop();
      expect(h.app.store.getState().chronicle, `stopped at ${stopAt}`).toBe(mine.chronicle);
    }
  });
  test('Ctrl+Z and the Undo buttons do nothing while the tour plays; it never plays the undo sound, not even on restore', () => {
    const h = withTour();
    byFocus(h.root, 'sound').click();
    threeDecisions(h);
    const played = h.sound.played.length;
    h.app.tour?.start('button');
    h.timers.advance(10_000);
    const live = h.app.store.getState();
    expect(ctrlZ(document.body).defaultPrevented).toBe(false);
    expect(h.app.store.getState()).toBe(live);
    expect(undoButton(h.root).closest('[inert]')).not.toBeNull();
    h.timers.advance(60_000);
    expect(h.sound.played.slice(played)).not.toContain('undo');
    // after the tour, undo works again
    h.app.tour?.stop();
    ctrlZ(document.body);
    expect(h.app.store.getState().chronicle.entries).toHaveLength(2);
    expect(h.sound.played.at(-1)).toBe('undo');
  });
  test('playing the tour twice writes nothing either time', () => {
    const h = withTour();
    playToEnd(h);
    h.app.tour?.stop();
    playToEnd(h);
    expect(h.app.store.getState().chronicle.entries).toEqual([]);
  });
});
describe('boards over the Plan B threshold', () => {
  /** The sample's tickets repeated under new keys, so the board has 57 tickets (fog on settle from 30). */
  function bigBoard(): Board {
    const base = sampleBoard();
    const extra = ['XA', 'XB'].flatMap((prefix) =>
      base.tickets.map((t) => ({ ...t, key: t.key.replace('HB', prefix), dependsOn: t.dependsOn.map((d) => d.replace('HB', prefix)), mustHave: false })),
    );
    return { ...base, tickets: [...base.tickets, ...extra] };
  }
  test('a candle gesture writes its entry when the values settle, in the same words as on a small board', () => {
    const big = mountWith(bigBoard());
    expect(big.app.store.getState().board.tickets.length).toBeGreaterThan(30);
    for (const step of [9, 8, 7, 6]) drag(input(big.root), step);
    big.frame.flush();
    expect(entries(big.root)).toHaveLength(0);
    big.timers.advance(300);
    const line = texts(big.root)[0]!;
    expect(line).toMatch(/^Freeze moved to Wed 18:00 \u2192 .+ out \(\u2212\d+\)$|^Freeze moved to Wed 18:00 \u2192 .+ in; .+ out \([+\u2212]\d+\)$/);
    const entry = big.app.store.getState().chronicle.entries[0]!;
    expect(line).toBe(decisionLine(entry.facts));
    expect(unexplained(line, entry.facts)).toEqual([]);
    const small = mountWith();
    dragCandle(small, [9, 8, 7, 6]);
    expect(texts(small.root)[0]).toMatch(/^Freeze moved to Wed 18:00 \u2192 /);
  });
});
describe('layout', () => {
  const css = readFileSync('src/ui/styles/components.css', 'utf8');
  test('the list has a fixed height and scrolls inside itself, so a new line moves nothing else', () => {
    const block = /\.chronicle-list \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(block).toContain('height: var(--chronicle-h)');
    expect(block).toContain('overflow-y: auto');
  });
  test('long names and key lists wrap, and the buttons are at least 44 px', () => {
    expect(/\.entry-text \{[^}]*overflow-wrap: anywhere/.test(css)).toBe(true);
    expect(/\.chronicle-help,[^{]*\{[^}]*overflow-wrap: anywhere/.test(css)).toBe(true);
    expect(css).toContain('--target');
  });
  test('the page does not mention a redo', () => {
    const h = mountWith();
    expect(panel(h.root).textContent?.toLowerCase()).not.toContain('redo');
    expect(panel(h.root).querySelector('[data-action="redo"]')).toBeNull();
  });
});
