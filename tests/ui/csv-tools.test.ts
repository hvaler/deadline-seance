// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { CSV_LIMITS, SCALE, exportCsv, importCsv } from '../../src/engine/index';
import type { CsvError } from '../../src/engine/index';
import { DEFAULT_NEXT_RELEASE, DOWNLOADED, DOWNLOADED_NO_CUT, EXPORT_FILE, SAMPLE_FILE, UNREADABLE } from '../../src/ui/render/csv-group';
import { SAMPLE_RELEASE, sampleBoard } from '../../src/ui/sample-board';
import { initialState } from '../../src/ui/state';
import { describeCsvError } from '../../src/ui/text';
import { sampleScript } from '../../src/ui/tour/sample-script';
import { totalMs } from '../../src/ui/tour/simulate';
import { byFocus, mountWith as mountHarness, region, shownKeys } from './harness';
import type { Harness } from './harness';

// "Your tickets": the controls, importing (by the picker and by a drop), the errors, the banner, the downloads, and the tour on an imported board.

const fixtures = import.meta.glob('../engine/fixtures/*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const errorsFixture = fixtures['../engine/fixtures/jira-errors.csv'] as string;

const mounted: Harness[] = [];
const mountWith: typeof mountHarness = (...args) => {
  const h = mountHarness(...args);
  mounted.push(h);
  return h;
};
afterEach(() => {
  for (const h of mounted.splice(0)) h.app.destroy();
  document.body.replaceChildren();
});

const HEADER = 'Issue key,Summary,Story Points,Cost of Delay';
const GOOD = [HEADER, 'Z-1,First ticket,5,9', 'Z-2,Second ticket,3,4', 'Z-3,Third ticket,8,12'].join('\n') + '\n';

const sleep = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(h: Harness): Promise<void> {
  await sleep();
  h.frame.flush();
}

function fileOf(name: string, size?: number): File {
  const f = new File(['x'], name, { type: 'text/csv' });
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
  return f;
}

/** Chooses a file through the picker: the hidden input gets it and says it changed. */
async function choose(h: Harness, name: string, text: string, size?: number): Promise<void> {
  h.reader.texts.set(name, text);
  const input = h.root.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [fileOf(name, size)], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(h);
}

function dragEvent(type: string, files: File[], withFiles = true): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types: withFiles ? ['Files'] : ['text/plain'], files } });
  return event;
}

const banner = (root: ParentNode): HTMLElement => region(root, 'source');
const errorsRegion = (root: ParentNode): HTMLElement | null => root.querySelector<HTMLElement>('[data-region="csv-errors"]');
const errorTexts = (root: ParentNode): string[] => [...(errorsRegion(root)?.querySelectorAll('li') ?? [])].map((li) => li.textContent ?? '');
const status = (root: ParentNode): string => root.querySelector('[data-region="csv-status"]')?.textContent ?? '';

describe('the controls', () => {
  test('a group "Your tickets" with the three buttons, the next release name, a drop zone and a hidden file input', () => {
    const { root } = mountWith();
    const group = region(root, 'csv');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.querySelector('h3')?.textContent).toBe('Your tickets');
    expect(group.closest('[data-region="tools"]')).not.toBeNull();
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Import Jira CSV', 'Download sample CSV', 'Export CSV for Jira']);
    const next = group.querySelector<HTMLInputElement>('#csv-next-release')!;
    expect([next.value, group.querySelector(`label[for="csv-next-release"]`)?.textContent]).toEqual([DEFAULT_NEXT_RELEASE, 'Next release name']);
    const file = group.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect([file.accept, file.hidden, file.getAttribute('aria-label')]).toEqual(['.csv,text/csv', true, 'Import Jira CSV']);
    expect(region(root, 'csv-drop').getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('[data-slot="csv"]')).toBeNull();
  });

  test('"Import Jira CSV" opens the file picker', () => {
    const { root } = mountWith();
    const file = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    let clicked = 0;
    file.click = () => void clicked++;
    byFocus(root, 'csv-pick').click();
    expect(clicked).toBe(1);
  });
});

describe('importing a good file (Requirement 7)', () => {
  test('replaces the board, starts the night again, keeps the sound, and says where the tickets came from', async () => {
    const h = mountWith();
    h.app.store.dispatch({ type: 'candle/set', step: 3 });
    h.app.store.dispatch({ type: 'survivor/toggle', name: 'Ana' });
    h.app.store.dispatch({ type: 'sound/set', on: true });
    await choose(h, 'q4_freeze.csv', GOOD);
    const state = h.app.store.getState();
    expect(state).toMatchObject({ candle: 10, marginPct: 0, away: [], sound: true, release: 'q4 freeze', source: { kind: 'file', name: 'q4_freeze.csv', skipped: 0, warnings: [] } });
    expect(state.home.tickets.map((t) => t.key)).toEqual(['Z-1', 'Z-2', 'Z-3']);
    expect(state.home.wontDo).toEqual([]);
    expect([state.home.fogSeed, state.home.nextReleaseWeeks, state.home.zombieThreshold]).toEqual([0, 2, 3]);
    expect(state.home.people).toEqual(sampleBoard().people);
    expect([...shownKeys(h.root, 'safehouse'), ...shownKeys(h.root, 'yard')].sort()).toEqual(['Z-1', 'Z-2', 'Z-3']);
  });

  test('the banner: two sentences from the file and the sample, the release name, and the way back', async () => {
    const h = mountWith();
    await choose(h, 'q4_freeze.csv', GOOD);
    const b = banner(h.root);
    expect(b.hasAttribute('hidden')).toBe(false);
    expect(b.querySelector('.source-lead')?.textContent).toBe("Your tickets from q4_freeze.csv: 3 tickets. Team and calendar are the sample's.");
    expect(b.querySelector('.source-rest')?.textContent).toBe("Release weeks and the zombie threshold are the sample's too (2 weeks, threshold 3); the fog uses seed 0.");
    expect(b.querySelector<HTMLInputElement>('#source-release')?.value).toBe('q4 freeze');
    expect(b.querySelector('label')?.textContent).toBe('Release name');
    expect(byFocus(b, 'back-to-sample').textContent).toBe('Back to the sample board');
    expect(b.getAttribute('aria-label')).toBe('Your tickets');
  });

  test('the banner is hidden on the sample board', () => {
    expect(banner(mountWith().root).hasAttribute('hidden')).toBe(true);
  });

  test('the focus goes to the banner, which is brought into view, and the change is announced; no sound', async () => {
    const h = mountWith();
    h.sound.enabled = true;
    await choose(h, 'q4_freeze.csv', GOOD);
    expect(document.activeElement).toBe(banner(h.root));
    expect(h.page.revealed.at(-1)).toEqual({ element: banner(h.root), instant: true });
    h.frame.flush();
    expect(region(h.root, 'announcer').textContent).toContain('Loaded your tickets from q4_freeze.csv. The file has 3 open tickets.');
    expect(h.sound.played).toEqual([]);
  });

  test('the change note says it is a new board, with the closed issues that were skipped', async () => {
    const h = mountWith();
    await choose(h, 'x.csv', 'Issue key,Summary,Story Points,Cost of Delay,Resolution\nA-1,a,1,1,\nA-2,b,1,1,Done\nA-3,c,1,1,Done\n');
    const note = region(h.root, 'change');
    expect(note.querySelector('.change-headline')?.textContent).toBe('Loaded your tickets from x.csv.');
    expect(note.textContent).toContain('The file has 1 open ticket.');
    expect(note.textContent).toContain('Skipped 2 closed issues.');
    expect(note.textContent).not.toMatch(/Rises|Sinks|Gain|Loss/);
    expect(banner(h.root).querySelector('.source-notes')?.textContent).toBe('2 closed issues skipped: a finished issue is not part of a freeze.');
  });

  test('the title card, the reset button and the certificate speak of your tickets', async () => {
    const h = mountWith();
    expect(byFocus(h.root, 'reset').textContent).toBe('Reset the sample board');
    await choose(h, 'q4_freeze.csv', GOOD);
    expect(h.root.querySelector('.product-line')?.textContent).toBe('q4 freeze · your tickets');
    expect(byFocus(h.root, 'reset').textContent).toBe('Reset your tickets');
    byFocus(h.root, 'certificate').click();
    expect(document.querySelector('[data-region="certificate"]')?.textContent).toContain('Release: q4 freeze');
  });

  test('a drop does the same as the picker, and a drag that is not a file does nothing', async () => {
    const h = mountWith();
    const zone = region(h.root, 'csv-drop');
    const file = fileOf('dropped.csv');
    h.reader.texts.set('dropped.csv', GOOD);
    const text = dragEvent('dragover', [], false);
    zone.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
    const over = dragEvent('dragover', [file]);
    zone.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(zone.classList.contains('is-over')).toBe(true);
    zone.dispatchEvent(dragEvent('drop', [file]));
    await settle(h);
    expect(zone.classList.contains('is-over')).toBe(false);
    expect(h.app.store.getState().source).toMatchObject({ kind: 'file', name: 'dropped.csv' });
  });

  test('a file dropped outside the zone does not navigate the page away, and a drag of text is left alone', () => {
    const h = mountWith();
    void h;
    const miss = dragEvent('drop', [fileOf('a.csv')]);
    document.body.dispatchEvent(miss);
    expect(miss.defaultPrevented).toBe(true);
    const other = dragEvent('dragover', [], false);
    document.body.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  test('choosing the same file twice works (the input is emptied)', async () => {
    const h = mountWith();
    await choose(h, 'again.csv', GOOD);
    await choose(h, 'again.csv', GOOD);
    expect(h.reader.read_).toEqual(['again.csv', 'again.csv']);
  });
});

describe('a file with errors (Requirement 8)', () => {
  test('changes nothing: the state is the very same object', async () => {
    const h = mountWith();
    h.app.store.dispatch({ type: 'candle/set', step: 4 });
    const before = h.app.store.getState();
    await choose(h, 'bad.csv', errorsFixture);
    expect(h.app.store.getState()).toBe(before);
  });

  test('lists every problem in an announced region that takes the focus, in the order of the file', async () => {
    const h = mountWith();
    await choose(h, 'bad.csv', errorsFixture);
    const r = errorsRegion(h.root)!;
    expect(r.getAttribute('role')).toBe('alert');
    expect(r.querySelector('h4')?.textContent).toBe('The file was not imported');
    expect(document.activeElement).toBe(r);
    expect(errorTexts(h.root)).toEqual([
      'Row 3, column C (Story Points): must be a whole number (got "2.5").',
      'Row 4, column C (Story Points): cannot be negative (got "-1").',
      'Row 5, column D (Value): must be 1, 2, 3, 5, 8, 13 or 20 (got "4").',
      'Row 6, column F (Risk): Risk is empty. Give Value, Urgency and Risk together, or only a Cost of Delay.',
      'Row 7, column G (Cost of Delay): this row has a Cost of Delay and also Value, Urgency or Risk. Give one or the other.',
      'Row 8, column G (Cost of Delay): this row has no cost of delay. Fill Cost of Delay, or Value, Urgency and Risk.',
      'Row 9, column H (Must Have): must be yes or no (got "maybe").',
      'Row 10, column A (Issue key): E-1 is also used in row 2.',
      'Row 11, column A (Issue key): "E 9" cannot be a key (no spaces, commas or semicolons, at most 100 characters).',
      'Row 12, column B (Summary): this cell is empty.',
      'Row 13, column I (Depends On): NOPE is not in the file. Remove the link, or add that issue to the file.',
      'Row 14, column I (Depends On): E-12 depends on itself.',
      'Row 15: these tickets depend on each other in a circle: E-13 → E-14 → E-13.',
      'Row 18, column J (Times Postponed): must be a whole number (got "abc").',
    ]);
  });

  test('every number in a sentence is a field of its error (or the scale)', () => {
    const r = importCsv(errorsFixture, { people: [], timeZone: 'Europe/Madrid', nextReleaseWeeks: 2, zombieThreshold: 3 });
    const errors: CsvError[] = r.ok ? [] : [...r.error];
    expect(errors.length).toBeGreaterThan(10);
    const extra: CsvError[] = [
      { code: 'too-many-tickets', row: null, column: null, value: '81', limit: 60 },
      { code: 'file-too-large', row: null, column: null, limit: CSV_LIMITS.bytes },
      { code: 'too-many-errors', row: null, column: null, total: 151, limit: 100 },
      { code: 'too-many-rows', row: null, column: null, value: '2001', limit: 2000 },
      { code: 'too-long', row: 4, column: { index: 1, letter: 'B', header: 'Summary' }, value: 'x', limit: 1000 },
    ];
    const allowed = (e: CsvError): Set<number> => {
      const set = new Set<number>(SCALE);
      const add = (text: string | number | undefined | null): void => {
        for (const m of String(text ?? '').replace(/(\d),(?=\d{3})/g, '$1').match(/\d+/g) ?? []) set.add(Number(m));
      };
      add(e.row);
      add(e.limit);
      add(e.total);
      add(e.value);
      for (const k of e.keys ?? []) add(k);
      add(e.column?.letter);
      add(e.column?.header);
      return set;
    };
    for (const e of [...errors, ...extra]) {
      const sentence = describeCsvError(e).replace(/[A-Z]+-\d+/g, ' ');
      const numbers = (sentence.replace(/(\d),(?=\d{3})/g, '$1').match(/\d+/g) ?? []).map(Number);
      const ok = allowed(e);
      expect(numbers.filter((n) => !ok.has(n)), sentence).toEqual([]);
    }
  });

  test('the sentence for too many tickets says to filter the export by fix version or sprint', () => {
    expect(describeCsvError({ code: 'too-many-tickets', row: null, column: null, value: '81', limit: 60 })).toBe(
      'The file: it has 81 open tickets; the most is 60. Filter the Jira export by fix version or sprint, then import it again.',
    );
  });

  test('a file that is too large is refused on its size, and is not read', async () => {
    const h = mountWith();
    await choose(h, 'big.csv', GOOD, CSV_LIMITS.bytes + 1);
    expect(errorTexts(h.root)).toEqual(['The file: it is larger than 1,048,576 bytes.']);
    expect(h.reader.read_).toEqual([]);
  });

  test('a file that cannot be read says so', async () => {
    const h = mountWith();
    h.reader.fails = true;
    await choose(h, 'x.csv', GOOD);
    expect(errorsRegion(h.root)?.textContent).toContain(UNREADABLE);
    expect(h.app.store.getState().source.kind).toBe('built-in');
  });

  test('more than a hundred problems: a hundred are listed and the last line says how many there were', async () => {
    const h = mountWith();
    const rows = Array.from({ length: 80 }, (_, i) => `K-${i},t,abc,def,,,,,,`);
    await choose(h, 'many.csv', ['Issue key,Summary,Story Points,Value,Urgency,Risk,Cost of Delay,Must Have,Depends On,Times Postponed', ...rows].join('\n'));
    const texts = errorTexts(h.root);
    expect(texts.length).toBeLessThanOrEqual(101);
    expect(texts.at(-1)).toMatch(/^The file has \d+ problems; the first 100 are listed\.$/);
  });

  test('text from the file is shown as text: no element is made from a cell or a file name', async () => {
    const h = mountWith();
    await choose(h, '<img src=x onerror=1>.csv', `${HEADER}\nA-1,x,"<b>bold</b>",9\n`);
    const r = errorsRegion(h.root)!;
    expect(r.querySelector('b, img')).toBeNull();
    expect(r.textContent).toContain('<b>bold</b>');
    await choose(h, '<img src=x onerror=1>.csv', GOOD);
    expect(banner(h.root).querySelector('img')).toBeNull();
    expect(banner(h.root).textContent).toContain('<img src=x onerror=1>.csv');
  });

  test('the list goes away with the next attempt, a good import, a reset and "Back to the sample board"; a good board stays when a later file is bad', async () => {
    const h = mountWith();
    await choose(h, 'bad.csv', errorsFixture);
    await choose(h, 'bad2.csv', 'nothing');
    expect(errorTexts(h.root)).toEqual(['The file: the column Cost of Delay is missing.', 'The file: the column Issue key is missing.', 'The file: the column Story Points is missing.', 'The file: the column Summary is missing.'].sort());
    await choose(h, 'good.csv', GOOD);
    expect(errorsRegion(h.root)).toBeNull();
    const loaded = h.app.store.getState();
    await choose(h, 'bad.csv', errorsFixture);
    expect(h.app.store.getState()).toBe(loaded);
    byFocus(h.root, 'reset').click();
    expect(errorsRegion(h.root)).toBeNull();
    await choose(h, 'bad.csv', errorsFixture);
    byFocus(h.root, 'back-to-sample').click();
    expect(errorsRegion(h.root)).toBeNull();
  });
});

describe('the banner, reset and the way back', () => {
  test('"Back to the sample board" loads the built-in board, hides the banner and puts the focus on the import button', async () => {
    const h = mountWith(undefined, {}, { release: SAMPLE_RELEASE });
    await choose(h, 'q4_freeze.csv', GOOD);
    byFocus(h.root, 'back-to-sample').click();
    const s = h.app.store.getState();
    expect(s).toMatchObject({ source: { kind: 'built-in' }, release: SAMPLE_RELEASE });
    expect(s.home).toBe(s.builtIn.board);
    expect(s.home.tickets).toHaveLength(19);
    expect(banner(h.root).hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(byFocus(h.root, 'csv-pick'));
    expect(h.root.querySelector('.product-line')?.textContent).toBe('Hollow Bank app 3.2 · release eve');
  });

  test('Reset keeps your tickets and says so', async () => {
    const h = mountWith();
    await choose(h, 'q4_freeze.csv', GOOD);
    h.app.store.dispatch({ type: 'candle/set', step: 2 });
    byFocus(h.root, 'reset').click();
    const s = h.app.store.getState();
    expect(s.source.kind).toBe('file');
    expect(s.candle).toBe(10);
    expect(region(h.root, 'change').querySelector('.change-headline')?.textContent).toBe('Back to your tickets.');
  });

  test('the release name can be edited: it names the certificate, and a blank name takes the line away; nothing is announced', async () => {
    const h = mountWith();
    await choose(h, 'q4_freeze.csv', GOOD);
    h.frame.flush();
    const spoken = region(h.root, 'announcer').textContent;
    const field = banner(h.root).querySelector<HTMLInputElement>('#source-release')!;
    field.value = 'Spring freeze';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    h.frame.flush();
    expect(h.app.store.getState().release).toBe('Spring freeze');
    expect(region(h.root, 'announcer').textContent).toBe(spoken);
    byFocus(h.root, 'certificate').click();
    expect(document.querySelector('[data-region="certificate"]')?.textContent).toContain('Release: Spring freeze');
    byFocus(document.body, 'certificate-close').click();
    field.value = '  ';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.app.store.getState().release).toBeNull();
  });
});

describe('the downloads (Requirement 6)', () => {
  const baseOfSample = { people: sampleBoard().people, timeZone: 'Europe/Madrid', nextReleaseWeeks: 2, zombieThreshold: 3 };

  test('"Download sample CSV" saves the sample, which imports back to the same tickets', () => {
    const h = mountWith(undefined, {}, { release: SAMPLE_RELEASE });
    byFocus(h.root, 'csv-sample').click();
    h.frame.flush();
    const saved = h.files.saved[0]!;
    expect([saved.name, saved.type]).toEqual([SAMPLE_FILE, 'text/csv;charset=utf-8']);
    expect(status(h.root)).toBe(DOWNLOADED);
    const back = importCsv(saved.text, baseOfSample);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const sample = initialState().home;
    expect(back.value.board.tickets.map((t) => [t.key, t.title, t.effort, t.cost, t.mustHave, t.past, [...t.dependsOn].sort()])).toEqual(
      sample.tickets.map((t) => [t.key, t.title, t.effort, t.cost, t.mustHave, t.past, [...t.dependsOn].sort()]),
    );
    // the start of the night: the tickets the cut keeps are in the release, the others in the next one
    expect(saved.text).toContain('HB-101,Fix stale balance after a transfer,5,8,5,5,,yes,,0,Hollow Bank app 3.2,');
    expect(saved.text).toContain('HB-119,Core ledger migration,48,8,5,8,,no,,0,Next release,');
  });

  test('a changed sample goes back in, and the change shows', async () => {
    const h = mountWith(undefined, {}, { release: SAMPLE_RELEASE });
    byFocus(h.root, 'csv-sample').click();
    const edited = h.files.saved[0]!.text.replace('HB-108,Transaction search,8,5,2,3,', 'HB-108,Transaction search,8,13,2,3,');
    expect(edited).not.toBe(h.files.saved[0]!.text);
    await choose(h, 'edited-sample.csv', edited);
    const t = h.app.store.getState().home.tickets.find((x) => x.key === 'HB-108')!;
    expect(t.cost).toEqual({ kind: 'formula', value: 13, urgency: 2, risk: 3 });
    expect(h.app.store.getState().source).toMatchObject({ kind: 'file', name: 'edited-sample.csv' });
  });

  test('"Export CSV for Jira" exports the board as it is: put-down tickets, exhumes, the cut and the next release name', () => {
    const h = mountWith(undefined, {}, { release: 'Rel A' });
    h.app.store.dispatch({ type: 'tombstone/put-down', key: 'HB-112' });
    h.app.store.dispatch({ type: 'tombstone/exhume', key: 'HB-108' });
    const next = h.root.querySelector<HTMLInputElement>('#csv-next-release')!;
    next.value = '  Q1   2027 ';
    byFocus(h.root, 'csv-export').click();
    const saved = h.files.saved[0]!;
    expect([saved.name, saved.type]).toEqual([EXPORT_FILE, 'text/csv;charset=utf-8']);
    expect(saved.text).toContain("HB-112,Multi-currency wallet,21,5,2,3,,no,,3,,Won't Do");
    expect(saved.text).toMatch(/HB-108,Transaction search,8,5,2,3,,yes,,0,Rel A,\r\n/);
    expect(saved.text).toContain(',Q1 2027,');
    const state = h.app.store.getState();
    expect(saved.text).toBe(exportCsv({ board: state.board, home: state.home, kept: new Set(h.root.querySelectorAll('li').length ? shownKeys(h.root, 'safehouse') : []), release: 'Rel A', nextRelease: 'Q1 2027' }));
  });

  test('a ticket the file closed as Won\'t Do is written back with its title, points, cost, links and past', async () => {
    const h = mountWith();
    const file = ['Issue key,Summary,Story Points,Value,Urgency,Risk,Cost of Delay,Must Have,Depends On,Times Postponed,Resolution', 'AB-1,Keep me,3,,,,9,no,,0,', 'AB-4,Dropped idea,2,3,2,5,,no,AB-1,1,Won\'t Do', 'AB-5,Needs the dropped one,1,,,,4,no,AB-4,0,'].join('\n') + '\n';
    await choose(h, 'ab.csv', file);
    expect(h.app.store.getState().home.wontDo).toEqual(['AB-4']);
    byFocus(h.root, 'csv-export').click();
    const text = h.files.saved[0]!.text;
    expect(text).toContain("AB-4,Dropped idea,2,3,2,5,,no,AB-1,1,,Won't Do\r\n");
    // and it comes back in again as it was
    await choose(h, 'ab-again.csv', text);
    expect(h.app.store.getState().source).toMatchObject({ kind: 'file', putDown: [{ key: 'AB-4', title: 'Dropped idea', effort: 2, cost: { kind: 'formula', value: 3, urgency: 2, risk: 5 }, past: 1, dependsOn: ['AB-1'] }] });
  });

  test('a ticket put down with the button keeps being exported with its data, and Reset keeps the file\'s own put-down tickets', async () => {
    const h = mountWith();
    await choose(h, 'ab.csv', ['Issue key,Summary,Story Points,Cost of Delay,Resolution', 'AB-1,One,3,9,', 'AB-4,Dropped idea,2,4,Won\'t Do'].join('\n') + '\n');
    byFocus(h.root, 'reset').click();
    byFocus(h.root, 'csv-export').click();
    expect(h.files.saved[0]!.text).toContain("AB-4,Dropped idea,2,,,,4,no,,0,,Won't Do");
  });

  test('a blank next release name is "Next release"; an impossible freeze leaves Fix Version/s empty and says why', () => {
    const h = mountWith();
    h.app.store.dispatch({ type: 'candle/set', step: 0 });
    h.root.querySelector<HTMLInputElement>('#csv-next-release')!.value = '   ';
    byFocus(h.root, 'csv-export').click();
    h.frame.flush();
    expect(status(h.root)).toBe(DOWNLOADED_NO_CUT);
    const rows = h.files.saved[0]!.text.split('\r\n').slice(1, -1);
    expect(rows.every((r) => /,,$/.test(r) || r.endsWith(`,`))).toBe(true);
    expect(rows.map((r) => r.split(',').at(-2))).toEqual(rows.map(() => ''));
  });

  test('your own tickets export as they are, with the release from the banner as the current version', async () => {
    const h = mountWith();
    await choose(h, 'q4_freeze.csv', GOOD);
    byFocus(h.root, 'csv-export').click();
    const text = h.files.saved[0]!.text;
    expect(text.startsWith('Issue key,Summary,Story Points,')).toBe(true);
    expect(text).toContain('Z-1,First ticket,5,,,,9,no,,0,');
    expect(text).toMatch(/,(q4 freeze|Next release),\r\n/);
  });
});

describe('the tour on an imported board (Requirement 9)', () => {
  const run = (h: Harness, ms: number): void => {
    for (let elapsed = 0; elapsed < ms; elapsed += 100) {
      h.timers.advance(100);
      h.frame.flush();
    }
  };

  test('the prompt says it plays on the sample while a file is loaded, and not otherwise', async () => {
    const h = mountWith(undefined, {}, { tour: sampleScript, hash: '' });
    await choose(h, 'q4_freeze.csv', GOOD);
    h.app.tour?.showPrompt();
    expect(h.root.querySelector('[data-region="tour-prompt"]')?.textContent).toContain('The tour plays on the sample board. Your tickets come back when it ends.');
    document.body.replaceChildren();
    const plain = mountWith(undefined, {}, { tour: sampleScript, hash: '' });
    plain.app.tour?.showPrompt();
    expect(plain.root.querySelector('[data-region="tour-prompt"]')?.textContent).not.toContain('Your tickets come back');
  });

  test('the tour plays the sample, and your board comes back as the very same state when it ends or is stopped', async () => {
    const h = mountWith(undefined, {}, { tour: sampleScript });
    await choose(h, 'q4_freeze.csv', GOOD);
    h.app.store.dispatch({ type: 'candle/set', step: 5 });
    const mine = h.app.store.getState();
    h.app.tour?.start('button');
    expect(h.app.store.getState().source.kind).toBe('built-in');
    run(h, 9000);
    expect(h.app.store.getState().home.tickets).toHaveLength(19);
    expect(banner(h.root).hasAttribute('hidden')).toBe(true);
    run(h, totalMs(sampleScript));
    expect(h.app.tour?.phase).toBe('ended');
    expect(h.app.store.getState()).toBe(mine);
    expect(banner(h.root).hasAttribute('hidden')).toBe(false);
    h.app.tour?.stop();
    h.app.tour?.start('button');
    run(h, 3000);
    h.app.tour?.stop();
    expect(h.app.store.getState()).toBe(mine);
  });

  test('starting the tour takes the error list away', async () => {
    const h = mountWith(undefined, {}, { tour: sampleScript });
    await choose(h, 'bad.csv', errorsFixture);
    expect(errorsRegion(h.root)).not.toBeNull();
    h.app.tour?.start('button');
    expect(errorsRegion(h.root)).toBeNull();
    h.app.tour?.stop();
  });

  test('the sample board plays exactly as before: the same captions', () => {
    const h = mountWith(undefined, {}, { tour: sampleScript });
    h.app.tour?.start('button');
    run(h, 100);
    expect(h.root.querySelector('[data-tour="caption"]')?.textContent).toBe('Mon 09:00, freeze Fri 18:00: 59 points, and 7 tickets stay outside.');
    h.app.tour?.stop();
  });
});
