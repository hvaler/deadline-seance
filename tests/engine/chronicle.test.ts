import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  SAMPLE_NOW,
  checkNumbers,
  decisionEffect,
  decisionLine,
  deathCertificate,
  describeUndo,
  diffSolutions,
  guardCertificate,
  guardFacts,
  nightFacts,
  plainText,
  sampleBoard,
  solveFreeze,
  undoLine,
  validateBoard,
} from '../../src/engine/index';
import type { DecisionEffect, DecisionFacts, DecisionSubject, Decisions, Solution, ValidBoard } from '../../src/engine/index';
// The sentence of a decision, its effect (the engine's diff and nothing else), the undo announcement and the "Decisions tonight" section.
const board = ((): ValidBoard => {
  const r = validateBoard(sampleBoard());
  if (!r.ok) throw new Error('sample invalid');
  return r.value;
})();
const at = (utc: [number, number, number, number, number], marginPct = 0): Solution => {
  const r = solveFreeze(board, { now: SAMPLE_NOW, freezeAt: Date.UTC(...utc), marginPct });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};
const FRIDAY = (m = 0): Solution => at([2026, 10, 20, 17, 0], m);
const WEDNESDAY = (): Solution => at([2026, 10, 18, 17, 0]);
const MONDAY_NOON = (): Solution => at([2026, 10, 16, 12, 0]);
const facts = (subject: DecisionSubject, effect: DecisionEffect, no = 1): DecisionFacts => ({ no, subject, effect });
const diff = (raised: string[], sunk: string[], codDelta: number): DecisionEffect => ({
  kind: 'diff',
  raised: raised.map((key) => ({ key, cod: 1 })),
  sunk: sunk.map((key) => ({ key, cod: 1 })),
  codDelta,
});
describe('decisionEffect', () => {
  test('is the engine\'s diff when both solutions are solved', () => {
    const before = FRIDAY();
    const after = WEDNESDAY();
    const d = diffSolutions(before, after);
    if (!d.ok) throw new Error('no diff');
    expect(decisionEffect(before, after)).toEqual({ kind: 'diff', raised: d.value.raised, sunk: d.value.sunk, codDelta: -54 });
    expect(decisionEffect(before, FRIDAY(20))).toMatchObject({ kind: 'diff', codDelta: -27 });
  });
  test('says impossible with the numbers, still impossible, and possible again', () => {
    expect(decisionEffect(FRIDAY(), MONDAY_NOON())).toEqual({ kind: 'impossible', stillImpossible: false, needed: 15, available: 6 });
    expect(decisionEffect(MONDAY_NOON(), MONDAY_NOON())).toMatchObject({ kind: 'impossible', stillImpossible: true });
    expect(decisionEffect(MONDAY_NOON(), FRIDAY())).toEqual({ kind: 'possible-again', kept: 12, savedCod: 167 });
  });
  test('gives the totals when the two solutions do not share every ticket', () => {
    const ticket = (key: string) => ({ key, title: key, effort: 1, cost: { kind: 'imported' as const, cod: 5 }, mustHave: false, dependsOn: [], past: 0 });
    const solveOf = (keys: string[]): Solution => {
      const b = validateBoard({ ...sampleBoard(), tickets: keys.map(ticket), wontDo: [] });
      if (!b.ok) throw new Error('invalid');
      const r = solveFreeze(b.value, { now: SAMPLE_NOW, freezeAt: Date.UTC(2026, 10, 20, 17, 0), marginPct: 0 });
      if (!r.ok) throw new Error('no solution');
      return r.value;
    };
    // C is kept after but did not exist before: there is no ticket-by-ticket diff.
    expect(decisionEffect(solveOf(['A-1', 'B-1']), solveOf(['A-1', 'B-1', 'C-1']))).toEqual({ kind: 'totals', before: 10, after: 15 });
    return;
  });
});
describe('the sentence of a decision', () => {
  const LINES: readonly [string, DecisionFacts][] = [
    ['Ana leaves \u2192 HB-109 out (\u221215)', facts({ kind: 'away', name: 'Ana' }, diff([], ['HB-109'], -15))],
    ['Ana is back \u2192 HB-109 in (+15)', facts({ kind: 'back', name: 'Ana' }, diff(['HB-109'], [], 15))],
    ['Ana leaves \u2192 HB-105 in; HB-104, HB-106 out (\u221234)', facts({ kind: 'away', name: 'Ana' }, diff(['HB-105'], ['HB-104', 'HB-106'], -34))],
    ['Freeze moved to Wed 18:00 \u2192 HB-105, HB-118 out (\u221227)', facts({ kind: 'candle', weekday: 'Wed', time: '18:00' }, diff([], ['HB-105', 'HB-118'], -27))],
    ['Exhumed HB-108 \u2192 in; HB-105, HB-109 out (\u221216)', facts({ kind: 'exhume', key: 'HB-108' }, diff(['HB-108'], ['HB-105', 'HB-109'], -16))],
    ['Resurrected HB-110 \u2192 in, with HB-111; HB-105 out (\u22125)', facts({ kind: 'resurrect', key: 'HB-110' }, diff(['HB-110', 'HB-111'], ['HB-105'], -5))],
    ['Resurrected HB-110 \u2192 HB-111 in (+3)', facts({ kind: 'resurrect', key: 'HB-110' }, diff(['HB-111'], [], 3))],
    ['Reserve 20 % \u2192 no change', facts({ kind: 'reserve', from: 0, to: 20 }, diff([], [], 0))],
    ['Reserve 5 % \u2192 HB-115 out (\u221213)', facts({ kind: 'reserve', from: 0, to: 5 }, diff([], ['HB-115'], -13))],
    ['Put down HB-112 \u2192 no change', facts({ kind: 'put-down', key: 'HB-112' }, diff([], [], 0))],
    ['Reset \u2192 HB-113 in (0)', facts({ kind: 'reset' }, diff(['HB-113'], [], 0))],
    ['Freeze moved to Mon 13:00 \u2192 impossible: needs 15 points, 6 available', facts({ kind: 'candle', weekday: 'Mon', time: '13:00' }, { kind: 'impossible', stillImpossible: false, needed: 15, available: 6 })],
    ['Freeze moved to Mon 09:00 \u2192 still impossible: needs 1 point, 0 available', facts({ kind: 'candle', weekday: 'Mon', time: '09:00' }, { kind: 'impossible', stillImpossible: true, needed: 1, available: 0 })],
    ['Freeze moved to Fri 18:00 \u2192 possible again: 12 in, saved cost of delay 167', facts({ kind: 'candle', weekday: 'Fri', time: '18:00' }, { kind: 'possible-again', kept: 12, savedCod: 167 })],
    ['Reset \u2192 saved cost of delay 89 \u2192 167', facts({ kind: 'reset' }, { kind: 'totals', before: 89, after: 167 })],
    ['Loaded q4.csv: 14 open tickets', facts({ kind: 'load', file: 'q4.csv', tickets: 14, skipped: 2 }, { kind: 'new-board' })],
    ['Loaded one.csv: 1 open ticket', facts({ kind: 'load', file: 'one.csv', tickets: 1, skipped: 0 }, { kind: 'new-board' })],
    ['Back to the sample board: 19 tickets', facts({ kind: 'sample', tickets: 19 }, { kind: 'new-board' })],
  ];
  test.each(LINES)('%s', (line, f) => {
    expect(decisionLine(f)).toBe(line);
  });
  test('the minus is U+2212, the same sign the guard reads', () => {
    expect(decisionLine(LINES[0]![1])).toContain('\u2212');
    expect(decisionLine(LINES[0]![1])).not.toContain('-15');
  });
  test('no sentence promises or advises', () => {
    for (const [line] of LINES) expect(line).not.toMatch(/\b(safe|safer|safest|better|best|guarantee\w*|always|never|improves?|should)\b/i);
  });
});
describe('the undo announcement', () => {
  test('one decision: the phrase, then what the engine\'s diff says came back', () => {
    const ana = facts({ kind: 'away', name: 'Ana' }, diff([], ['HB-109'], -15));
    expect(undoLine(ana, 1, diff(['HB-109'], [], 15))).toBe('Undone: Ana leaves. HB-109 is back in.');
    expect(undoLine(ana, 1, diff(['HB-104', 'HB-106', 'HB-107', 'HB-116'], ['HB-105'], 34))).toBe(
      'Undone: Ana leaves. HB-104, HB-106, HB-107 and HB-116 are back in; HB-105 is out again.',
    );
    expect(undoLine(ana, 1, diff([], [], 0))).toBe('Undone: Ana leaves. No change in the cut.');
  });
  test('several decisions: the count, the first one removed, and the diff between the two nights', () => {
    const candle = facts({ kind: 'candle', weekday: 'Wed', time: '18:00' }, diff([], ['HB-105'], -11), 3);
    expect(undoLine(candle, 3, diff(['HB-105'], [], 11))).toBe('Undone 3 decisions, back to before "Freeze moved to Wed 18:00". HB-105 is back in.');
  });
  test('impossible, possible again, a load and a total say so', () => {
    const f = facts({ kind: 'reset' }, diff([], [], 0));
    expect(undoLine(f, 1, { kind: 'impossible', stillImpossible: false, needed: 15, available: 6 })).toBe('Undone: Reset. The freeze is now impossible: needs 15 points, 6 available.');
    expect(undoLine(f, 1, { kind: 'possible-again', kept: 12, savedCod: 167 })).toBe('Undone: Reset. The freeze is possible again.');
    expect(undoLine(f, 1, { kind: 'new-board' })).toBe('Undone: Reset. Your earlier night is back.');
    expect(undoLine(f, 1, { kind: 'totals', before: 1, after: 2 })).toBe('Undone: Reset. Saved cost of delay 1 \u2192 2.');
    expect(plainText(describeUndo(f, 1, { kind: 'new-board' }))).toBe('Undone: Reset. Your earlier night is back.');
  });
});
// ---- the certificate section -----------------------------------------------------------------------------------------------
function noteFor(decisions: Decisions | undefined, freezeAt = Date.UTC(2026, 10, 20, 17, 0)) {
  const r = nightFacts({ home: board, board, freeze: { now: SAMPLE_NOW, freezeAt, marginPct: 0 }, away: [], release: 'Q4', ...(decisions === undefined ? {} : { decisions }) });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}
describe('Decisions tonight', () => {
  const entries = [
    facts({ kind: 'candle', weekday: 'Wed', time: '18:00' }, diff([], ['HB-105', 'HB-113'], -25), 4),
    facts({ kind: 'away', name: 'Ana' }, diff(['HB-105'], ['HB-104'], -1), 5),
  ];
  test('without decisions the note has no such section: the MCP notes do not change', () => {
    const plain = deathCertificate(noteFor(undefined));
    expect(plain).not.toContain('Decisions tonight');
    expect(noteFor(undefined).decisions).toBeNull();
  });
  test('with none it says None.; with some it lists them oldest first, numbered', () => {
    const base = deathCertificate(noteFor(undefined));
    const none = deathCertificate(noteFor({ entries: [], dropped: 0 }));
    expect(none).toBe(`${base}\n## Decisions tonight\n\nNone.\n`);
    const some = deathCertificate(noteFor({ entries, dropped: 0 }));
    expect(some).toBe(`${base}\n## Decisions tonight\n\n- 4 \u00b7 Freeze moved to Wed 18:00 \u2192 HB-105, HB-113 out (\u221225)\n- 5 \u00b7 Ana leaves \u2192 HB-105 in; HB-104 out (\u22121)\n`);
  });
  test('says how many older decisions are not listed', () => {
    expect(deathCertificate(noteFor({ entries, dropped: 3 }))).toContain('## Decisions tonight\n\nThe 3 oldest decisions are not listed.\n\n- 4');
    expect(deathCertificate(noteFor({ entries, dropped: 1 }))).toContain('The oldest decision is not listed.');
  });
  test('the impossible-freeze note has it too, last', () => {
    const text = deathCertificate(noteFor({ entries, dropped: 0 }, Date.UTC(2026, 10, 16, 12, 0)));
    expect(text).toContain('The freeze is impossible');
    expect(text.endsWith('- 5 \u00b7 Ana leaves \u2192 HB-105 in; HB-104 out (\u22121)\n')).toBe(true);
    expect(text.indexOf('Nothing can be decided')).toBeLessThan(text.indexOf('Decisions tonight'));
  });
  test('the model feeds the screen too: it is a heading and a list in the note', () => {
    expect(deathCertificate(noteFor({ entries, dropped: 0 })).match(/^## /gm)).toHaveLength(8);
  });
});
// P24 extended: a certificate with any chronicle passes the guard.
const KEYS = board.tickets.map((t) => t.key);
const arbName: fc.Arbitrary<string> = fc.oneof(fc.constantFrom('Ana', 'O\'Brien', '*Dev*', 'a|b', '# 12', '<b>7</b>', '3 people', 'x_y_z', 'Zo\u00eb 42'), fc.string({ maxLength: 12 }));
const arbKeys: fc.Arbitrary<{ key: string; cod: number }[]> = fc.uniqueArray(fc.constantFrom(...KEYS), { maxLength: 6 }).map((ks) => ks.map((key) => ({ key, cod: 1 })));
const arbEffect: fc.Arbitrary<DecisionEffect> = fc.oneof(
  fc.record({ kind: fc.constant('diff' as const), raised: arbKeys, sunk: arbKeys, codDelta: fc.integer({ min: -500, max: 500 }) }),
  fc.record({ kind: fc.constant('impossible' as const), stillImpossible: fc.boolean(), needed: fc.nat(300), available: fc.nat(300) }),
  fc.record({ kind: fc.constant('possible-again' as const), kept: fc.nat(40), savedCod: fc.nat(1000) }),
  fc.record({ kind: fc.constant('totals' as const), before: fc.nat(1000), after: fc.nat(1000) }),
  fc.constant<DecisionEffect>({ kind: 'new-board' }),
);
const arbSubject: fc.Arbitrary<DecisionSubject> = fc.oneof(
  fc.record({ kind: fc.constant('candle' as const), weekday: fc.constantFrom('Mon', 'Tue', 'Wed', 'Thu', 'Fri'), time: fc.constantFrom('09:00', '13:00', '18:00') }),
  fc.record({ kind: fc.constant('reserve' as const), from: fc.constantFrom(0, 5, 10, 15, 20, 25, 30), to: fc.constantFrom(0, 5, 10, 15, 20, 25, 30) }),
  fc.record({ kind: fc.constantFrom('away' as const, 'back' as const), name: arbName }),
  fc.record({ kind: fc.constantFrom('exhume' as const, 'resurrect' as const, 'put-down' as const), key: fc.constantFrom(...KEYS) }),
  fc.constant<DecisionSubject>({ kind: 'reset' }),
  fc.record({ kind: fc.constant('load' as const), file: arbName, tickets: fc.nat(60), skipped: fc.nat(9) }),
  fc.record({ kind: fc.constant('sample' as const), tickets: fc.nat(60) }),
);
describe('the guard and the chronicle', () => {
  test('P24 a certificate with any chronicle passes the guard, with names that are digits, markup and Markdown', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ subject: arbSubject, effect: arbEffect }), { maxLength: 12 }), fc.nat(60), (list, dropped) => {
        const entries = list.map((e, i) => ({ no: dropped + i + 1, ...e }));
        const f = noteFor({ entries, dropped });
        const verdict = guardCertificate(f);
        expect(verdict.offending).toEqual([]);
        expect(verdict.ok).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
  test('a number that is not a fact is caught: the same text checked against facts without the chronicle is rejected', () => {
    const f = noteFor({ entries: [facts({ kind: 'reserve', from: 0, to: 25 }, diff(['HB-113'], [], 27), 71)], dropped: 0 });
    const markdown = deathCertificate(f);
    expect(markdown).toContain('- 71 \u00b7 Reserve 25 % \u2192 HB-113 in (+27)');
    const bare = { ...f, decisions: null };
    const verdict = checkNumbers(markdown, guardFacts([bare], { keys: f.keys }));
    expect(verdict.ok).toBe(false);
    expect(verdict.offending.map((o) => o.text)).toContain('71');
    expect(guardCertificate(f).ok).toBe(true);
  });  test('a sentence never has a digit of its own: all of them come from the facts', () => {
    const zero = facts({ kind: 'reserve', from: 0, to: 0 }, diff([], [], 0), 0);
    expect(decisionLine(zero)).toBe('Reserve 0 % \u2192 no change');
  });
});
