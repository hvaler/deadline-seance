// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { validateBoard } from '../../src/engine/index';
import type { Board, ValidationErrorCode } from '../../src/engine/index';
import { mountApp } from '../../src/ui/app';
import { sampleBoard } from '../../src/ui/sample-board';
import { describeValidationError } from '../../src/ui/text';

afterEach(() => {
  document.body.replaceChildren();
});

/** One way to break the sample board for each validation code. The Record makes a new engine code fail to compile until it is added here. */
const breakIt: Record<ValidationErrorCode, (board: Board) => Board> = {
  'duplicate-key': (b) => ({ ...b, tickets: [...b.tickets, { ...(b.tickets[0] as Board['tickets'][number]) }] }),
  'unknown-dependency': (b) => ({ ...b, tickets: b.tickets.map((t) => (t.key === 'HB-101' ? { ...t, dependsOn: ['HB-999'] } : t)) }),
  'self-dependency': (b) => ({ ...b, tickets: b.tickets.map((t) => (t.key === 'HB-101' ? { ...t, dependsOn: ['HB-101'] } : t)) }),
  'dependency-cycle': (b) => ({
    ...b,
    tickets: b.tickets.map((t) => (t.key === 'HB-101' ? { ...t, dependsOn: ['HB-102'] } : t.key === 'HB-102' ? { ...t, dependsOn: ['HB-101'] } : t)),
  }),
  'not-integer': (b) => ({ ...b, tickets: b.tickets.map((t) => (t.key === 'HB-104' ? { ...t, effort: 1.5 } : t)) }),
  'negative-number': (b) => ({ ...b, people: b.people.map((p) => (p.name === 'Ana' ? { ...p, pointsPerHalfDay: -1 } : p)) }),
  'urgency-off-scale': (b) => ({
    ...b,
    tickets: b.tickets.map((t) => (t.key === 'HB-104' ? { ...t, cost: { kind: 'formula', value: 5, urgency: 4, risk: 3 } } : t)),
  }),
  'invalid-time-zone': (b) => ({ ...b, timeZone: 'Mars/Olympus' }),
  'invalid-threshold': (b) => ({ ...b, zombieThreshold: 0 }),
  'wont-do-key-in-tickets': (b) => ({ ...b, wontDo: ['HB-101'] }),
  'invalid-absence': (b) => ({ ...b, people: b.people.map((p) => (p.name === 'Ana' ? { ...p, daysOff: [{ date: '2026-02-30', part: 'full' as const }] } : p)) }),
  'board-too-large': (b) => ({ ...b, tickets: b.tickets.map((t) => ({ ...t, effort: 1_000_000_000 })) }),
};

function mountInvalid(board: Board): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  const app = mountApp(root, board);
  expect(app.kind).toBe('invalid');
  return root;
}

describe('a board that fails validation shows every problem in words', () => {
  for (const code of Object.keys(breakIt) as ValidationErrorCode[]) {
    test(`${code}: the screen lists the engine's problem with its keys and values`, () => {
      const broken = breakIt[code](sampleBoard());
      const checked = validateBoard(broken);
      expect(checked.ok).toBe(false);
      if (checked.ok) return;
      expect(checked.error.map((e) => e.code)).toContain(code);

      const root = mountInvalid(broken);
      const shown = [...root.querySelectorAll('li')].map((li) => li.textContent);
      expect(shown).toEqual(checked.error.map(describeValidationError));
      const withCode = root.querySelector(`li[data-code="${code}"]`);
      expect(withCode?.textContent).toBe(describeValidationError(checked.error.find((e) => e.code === code)!));
    });
  }

  test('the sentences name the keys and values the engine reported', () => {
    const texts = (code: ValidationErrorCode): string => {
      const root = mountInvalid(breakIt[code](sampleBoard()));
      const text = root.querySelector(`li[data-code="${code}"]`)?.textContent ?? '';
      root.remove();
      return text;
    };
    expect(texts('unknown-dependency')).toBe('HB-101 depends on HB-999, which is not on the board.');
    expect(texts('dependency-cycle')).toBe('Dependency cycle: HB-101 → HB-102 → HB-101.');
    expect(texts('not-integer')).toBe('HB-104: effort must be a whole number (got 1.5).');
    expect(texts('negative-number')).toBe('Ana: pointsPerHalfDay cannot be negative (got -1).');
    expect(texts('urgency-off-scale')).toBe('HB-104: urgency must be 1, 2, 3, 5, 8, 13 or 20 (got 4).');
    expect(texts('invalid-time-zone')).toBe('Unknown time zone "Mars/Olympus".');
    expect(texts('invalid-absence')).toBe('Ana has an invalid day off: 2026-02-30 full.');
    expect(texts('duplicate-key')).toBe('Duplicate key HB-101: two tickets use it.');
  });

  test('several problems at once are all listed, and the count is right', () => {
    const board = breakIt['invalid-time-zone'](breakIt['self-dependency'](breakIt['negative-number'](sampleBoard())));
    const root = mountInvalid(board);
    expect(root.querySelectorAll('li')).toHaveLength(3);
    expect(root.querySelector('section p')?.textContent).toBe('The board has 3 problems. Fix them and load the board again.');
  });

  test('one problem is singular', () => {
    const root = mountInvalid(breakIt['invalid-threshold'](sampleBoard()));
    expect(root.querySelector('section p')?.textContent).toBe('The board has 1 problem. Fix it and load the board again.');
  });

  test('the grounds, the candle and the cut are not drawn, and no state exists', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const app = mountApp(root, breakIt['unknown-dependency'](sampleBoard()));
    expect(app.kind).toBe('invalid');
    expect('store' in app).toBe(false);
    for (const region of ['safehouse', 'yard', 'candle', 'survivors', 'sign']) expect(root.querySelector(`[data-region="${region}"]`)).toBeNull();
    expect(root.querySelector('[data-region="board-problems"]')).not.toBeNull();
    expect(root.querySelector('h1')?.textContent).toBe('Night of the Living Backlog');
    expect(root.querySelector('h2')?.textContent).toBe('This board cannot be used');
  });

  test('has a main landmark and one h1', () => {
    const root = mountInvalid(breakIt['invalid-threshold'](sampleBoard()));
    expect(root.querySelectorAll('main')).toHaveLength(1);
    expect(root.querySelectorAll('h1')).toHaveLength(1);
  });

  test('a valid board still mounts, and mounting an invalid one afterwards replaces the page', () => {
    const root = document.createElement('div');
    document.body.append(root);
    expect(mountApp(root, sampleBoard()).kind).toBe('board');
    expect(root.querySelector('[data-region="safehouse"]')).not.toBeNull();
    expect(mountApp(root, breakIt['invalid-threshold'](sampleBoard())).kind).toBe('invalid');
    expect(root.querySelector('[data-region="safehouse"]')).toBeNull();
  });

  test('destroy clears the screen', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const app = mountApp(root, breakIt['invalid-threshold'](sampleBoard()));
    app.destroy();
    expect(root.childNodes).toHaveLength(0);
  });
});
