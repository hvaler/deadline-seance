import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { checkNumbers, extractTokens, guardFacts } from '../../src/engine/guard';
import type { GuardFacts } from '../../src/engine/guard';

// The number guard: what counts as a number, which facts accept it, and that it names what it rejects.

const kinds = (text: string, keys: string[] = []): string[] => extractTokens(text, { keys }).map((t) => `${t.kind}:${t.text}`);
const facts = (source: unknown, keys: string[] = []): GuardFacts => guardFacts([source], { keys });
const offending = (text: string, f: GuardFacts, ignore: [number, number][] = []): string[] => checkNumbers(text, f, { ignore }).offending.map((o) => `${o.reason}:${o.text}`);

describe('what a token is (Requirement 2.2)', () => {
  test('a date is one token, not three numbers', () => {
    expect(kinds('on 2026-11-18 it')).toEqual(['date:2026-11-18']);
  });

  test('a time is one token', () => {
    expect(kinds('at 18:00 and 9:30')).toEqual(['time:18:00', 'time:9:30']);
  });

  test('a ticket key is one token, not a number and not a sign', () => {
    expect(kinds('HB-108 and CRYPT-12 and A-0')).toEqual(['key:HB-108', 'key:CRYPT-12', 'key:A-0']);
  });

  test('a known key of any shape leaves no stray number', () => {
    expect(kinds('A3 needs B7.', ['A3'])).toEqual(['key:A3', 'number:7']);
  });

  test('a known key is not cut out of a longer word or number', () => {
    expect(kinds('HB-1089', ['HB-108'])).toEqual(['key:HB-1089']);
  });

  test('a known key that is only the start of a longer key-shaped word is not that key ("T" in "T-7")', () => {
    expect(kinds('T-7 and T', ['T'])).toEqual(['key:T-7', 'key:T']);
    expect(offending('T-7', guardFacts([{ n: 7 }], { keys: ['T'] }))).toEqual(['unknown-key:T-7']);
  });

  test('a weekday is one token', () => {
    expect(kinds('Fri and Wednesday')).toEqual(['weekday:Fri', 'weekday:Wednesday']);
  });

  test('a decimal is one token', () => {
    expect(kinds('version 3.5 here')).toEqual(['decimal:3.5']);
  });

  test('"1,000" is the integer 1000, and a comma not followed by three digits ends the number', () => {
    expect(extractTokens('1,000 nights')[0]).toMatchObject({ kind: 'number', value: 1000 });
    expect(extractTokens('12,345,678')[0]).toMatchObject({ value: 12_345_678 });
    expect(extractTokens('3,5').map((t) => t.value)).toEqual([3, 5]);
    expect(extractTokens('1234,567').map((t) => t.value)).toEqual([1234, 567]);
  });

  test('"13 %" and "13%" are the number 13 with a percent unit, and the unit is part of the token text', () => {
    expect(extractTokens('13 % and 20%')).toMatchObject([
      { kind: 'number', value: 13, percent: true, text: '13 %' },
      { kind: 'number', value: 20, percent: true, text: '20%' },
    ]);
  });

  test('leading zeros read as the integer', () => {
    expect(extractTokens('007')[0]).toMatchObject({ value: 7 });
  });

  test('digits inside a word are numbers (a model could write "Q4")', () => {
    expect(kinds('Q4 plan')).toEqual(['number:4']);
  });

  test('number words are numbers; "twenty-one" is twenty and one', () => {
    expect(extractTokens('three tickets, Twelve, a dozen, twenty-one')).toMatchObject([
      { kind: 'word', value: 3 },
      { kind: 'word', value: 12 },
      { kind: 'word', value: 12 },
      { kind: 'word', value: 20 },
      { kind: 'word', value: 1 },
    ]);
  });

  test('a word that only contains a number word is not one', () => {
    expect(kinds('someone, none, onetime, tennis')).toEqual([]);
  });
});

describe('signs (Requirement 2.3)', () => {
  test('a sign right before a digit and not after a letter, a digit or a dot belongs to the number', () => {
    expect(extractTokens('(-15) −8 +3 –2')).toMatchObject([
      { kind: 'signed', sign: '-', value: 15 },
      { kind: 'signed', sign: '-', value: 8 },
      { kind: 'signed', sign: '+', value: 3 },
      { kind: 'signed', sign: '-', value: 2 },
    ]);
  });

  test('there is no sign in a key, a date, a range or a weekday range', () => {
    expect(kinds('HB-108')).toEqual(['key:HB-108']);
    expect(kinds('2026-11-18')).toEqual(['date:2026-11-18']);
    expect(kinds('80-150')).toEqual(['number:80', 'number:150']);
    expect(kinds('Mon-Fri')).toEqual(['weekday:Mon', 'weekday:Fri']);
    expect(kinds('x-5')).toEqual(['number:5']);
    expect(kinds('1.5-2')).toEqual(['decimal:1.5', 'number:2']);
  });

  test('a hyphen followed by a space is not a sign', () => {
    expect(kinds('59 - 5')).toEqual(['number:59', 'number:5']);
  });

  test('an unsigned number is accepted by the fact or by its negative ("Loss: 16" for -16)', () => {
    expect(offending('Loss: 16.', facts({ delta: -16 }))).toEqual([]);
  });

  test('a negative number needs the negative fact', () => {
    expect(offending('−15', facts({ delta: -15 }))).toEqual([]);
    expect(offending('−15', facts({ delta: 15 }))).toEqual(['wrong-sign:−15']);
    expect(offending('-15', facts({ other: 9 }))).toEqual(['not-in-facts:-15']);
  });

  test('a plus sign needs the positive fact', () => {
    expect(offending('+8', facts({ gain: 8 }))).toEqual([]);
    expect(offending('+8', facts({ gain: -8 }))).toEqual(['wrong-sign:+8']);
  });
});

describe('the check', () => {
  const f = guardFacts([{ capacity: 59, nights: 1000, pct: 13, when: { weekday: 'Fri', date: '2026-11-20', time: '18:00' } }], { keys: ['HB-108'] });

  test('accepts a text made only of facts', () => {
    expect(checkNumbers('Fri 2026-11-20 18:00: HB-108 has 59 points, 13 % of 1,000 nights.', f)).toEqual({ ok: true, offending: [] });
  });

  test('names each offending token, with its place, in order', () => {
    const r = checkNumbers('60 points, HB-109, 2026-11-21, 17:00, Sat, 3.5, three', f);
    expect(r.ok).toBe(false);
    expect(r.offending.map((o) => [o.text, o.reason])).toEqual([
      ['60', 'not-in-facts'],
      ['HB-109', 'unknown-key'],
      ['2026-11-21', 'unknown-date'],
      ['17:00', 'unknown-time'],
      ['Sat', 'unknown-weekday'],
      ['3.5', 'decimal'],
      ['three', 'not-in-facts'],
    ]);
    expect(r.offending.map((o) => o.at)).toEqual([0, 11, 19, 31, 38, 43, 48]);
  });

  test('a key-shaped token that is not a key of the facts is offending, a known one is not', () => {
    expect(offending('HB-108 and HB-1080', f)).toEqual(['unknown-key:HB-1080']);
  });

  test('a number word is checked like an integer', () => {
    expect(offending('fifty-nine', f)).toEqual(['not-in-facts:fifty', 'not-in-facts:nine']);
    expect(offending('thirteen', f)).toEqual([]);
  });

  test('a huge digit run is offending, not a crash', () => {
    expect(offending('9'.repeat(40), f)).toEqual([`not-in-facts:${'9'.repeat(40)}`]);
  });

  test('ok is true exactly when there is nothing offending', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (text) => {
        const r = checkNumbers(text, f);
        expect(r.ok).toBe(r.offending.length === 0);
      }),
      { numRuns: 200 },
    );
  });
});

describe('data text is ignored by position (Requirement 2.8)', () => {
  const f = guardFacts([{ points: 5 }]);

  test('a number inside an ignored span is not checked, the same number outside it is', () => {
    const text = 'Title 99 costs 98';
    expect(offending(text, f, [[6, 8]])).toEqual(['not-in-facts:98']);
  });

  test('a title that is "5" does not hide a wrong 5 elsewhere', () => {
    const only5 = guardFacts([{ points: 6 }]);
    const text = '| 5 | needs 5 points |';
    expect(offending(text, only5, [[2, 3]])).toEqual(['not-in-facts:5']);
  });

  test('a span cuts a token in two: what is left outside is still read', () => {
    expect(extractTokens('ab12cd', { ignore: [[2, 4]] })).toEqual([]);
  });
});

describe('the facts', () => {
  test('numbers, dates, times and weekdays are found anywhere in the values, and property names are never read', () => {
    const g = guardFacts([{ deep: [{ a: 7, b: { 'HB-1': 8, c: ['Fri', '18:00', '2026-11-20', 'not a word', -3] } }] }, 12]);
    expect([...g.numbers].sort((x, y) => x - y)).toEqual([-3, 7, 8, 12]);
    expect([...g.words].sort()).toEqual(['18:00', '2026-11-20', 'Fri']);
    expect(g.keys).toEqual([]);
  });

  test('keys are only the ones given', () => {
    expect(guardFacts([{ key: 'HB-1' }], { keys: ['HB-2', 'HB-2'] }).keys).toEqual(['HB-2']);
  });

  test('a circular structure does not loop', () => {
    const a: Record<string, unknown> = { n: 4 };
    a.self = a;
    expect([...guardFacts([a]).numbers]).toEqual([4]);
  });

  test('non-finite numbers are not facts', () => {
    expect(guardFacts([[Number.NaN, Number.POSITIVE_INFINITY, 2]]).numbers.size).toBe(1);
  });
});

describe('never throws, same answer twice (Requirement 2.9)', () => {
  const f = guardFacts([{ n: 1, w: 'Mon' }], { keys: ['A-1'] });

  test('on any string', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary', maxLength: 80 }), fc.string({ unit: 'grapheme', maxLength: 60 }), fc.stringMatching(/^[0-9,.:%+\-−– A-Za-z\\|]{0,60}$/)), (text) => {
        const first = checkNumbers(text, f);
        expect(checkNumbers(text, f)).toEqual(first);
        const offsets = first.offending.map((o) => o.at);
        expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
        for (const o of first.offending) expect(text.slice(o.at, o.at + o.text.length)).toBe(o.text);
      }),
      { numRuns: 400 },
    );
  });
});

describe('bites: a fixed note with one wrong thing in it is rejected, and the test names the token (Requirement 5.4)', () => {
  const g = guardFacts([{ when: { weekday: 'Fri', date: '2026-11-20', time: '18:00' }, kept: 12, outside: 7, cod: 101, waiting: 202, nights: 1000, holds: 134, pct: 13, delta: -16 }], {
    keys: ['HB-119', 'HB-112'],
  });
  const note = (s: string): string => `Freeze: ${s}`;

  test('the right note passes', () => {
    expect(offending(note('Fri 2026-11-20 18:00, HB-119, 7 tickets, cod 101, waiting 202, 134 of 1,000 nights (13 %), loss 16.'), g)).toEqual([]);
  });

  test('one changed digit', () => {
    expect(offending(note('cod 102'), g)).toEqual(['not-in-facts:102']);
  });

  test('an invented percentage', () => {
    expect(offending(note('holds in 47 % of nights'), g)).toEqual(['not-in-facts:47 %']);
  });

  test('a wrong key', () => {
    expect(offending(note('HB-190 stays outside'), g)).toEqual(['unknown-key:HB-190']);
  });

  test('a wrong sign', () => {
    expect(offending(note('change +16'), g)).toEqual(['wrong-sign:+16']);
  });

  test('a wrong date, time and weekday', () => {
    expect(offending(note('Thu 2026-11-19 17:00'), g)).toEqual(['unknown-weekday:Thu', 'unknown-date:2026-11-19', 'unknown-time:17:00']);
  });

  test('a decimal and a spelled-out number', () => {
    expect(offending(note('1.5 times, nineteen tickets'), g)).toEqual(['decimal:1.5', 'not-in-facts:nineteen']);
  });
});
