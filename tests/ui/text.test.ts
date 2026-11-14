import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { codParts, validateBoard } from '../../src/engine/index';
import type { Reason, ValidationError, ValidationErrorCode } from '../../src/engine/index';
import { CANDLE_STEPS } from '../../src/ui/candle-steps';
import { derive } from '../../src/ui/derive';
import { sampleBoard } from '../../src/ui/sample-board';
import { initialState, initialStateFor, reducer } from '../../src/ui/state';
import type { Action, AppState } from '../../src/ui/state';
import {
  announcementText,
  changeNote,
  count,
  describeValidationError,
  epitaphFor,
  formulaText,
  fogHeadline,
  fogImpossibleSentence,
  fogSentence,
  stripItemText,
  thousands,
  listOf,
  noteSentence,
  reasonText,
  hungerText,
  releasesText,
  waitingText,
  verdictSentences,
} from '../../src/ui/text';
import { arbMeaningfulAction, statesAfter } from './arbitraries';
import { integersInText, unexplained } from './provenance';

function run(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state);
}

const initial = initialState();
const tomb = (state: AppState, key: string) => {
  const t = derive(state).yard.find((x) => x.key === key);
  if (!t) throw new Error(`${key} is not buried`);
  return t;
};
const ticketOf = (state: AppState, key: string) => {
  const t = state.board.tickets.find((x) => x.key === key);
  if (!t) throw new Error(`${key} is not on the board`);
  return t;
};

describe('small helpers', () => {
  test('count and listOf', () => {
    expect(count(1, 'ticket')).toBe('1 ticket');
    expect(count(0, 'ticket')).toBe('0 tickets');
    expect(count(2, 'week')).toBe('2 weeks');
    expect(count(1, 'release')).toBe('1 release');
    expect(listOf([])).toBe('');
    expect(listOf(['A'])).toBe('A');
    expect(listOf(['A', 'B'])).toBe('A and B');
    expect(listOf(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('cost of delay in words', () => {
  test('a formula ticket without hunger', () => {
    expect(formulaText(codParts(ticketOf(initial, 'HB-104')))).toBe('value 5 + urgency 3 + risk 3 = 11');
  });

  test('a hungry ticket shows the climb: urgency 1 → 5, and how long it has been left out', () => {
    const cost = codParts(ticketOf(initial, 'HB-105'));
    expect(formulaText(cost)).toBe('value 3 + urgency 1 → 5 + risk 3 = 11');
    expect(releasesText(cost)).toBe('left out 3 releases');
  });

  test('HB-113: urgency 3 → 8 after 2 releases', () => {
    const cost = codParts(ticketOf(initial, 'HB-113'));
    expect(formulaText(cost)).toBe('value 3 + urgency 3 → 8 + risk 3 = 14');
    expect(releasesText(cost)).toBe('left out 2 releases');
  });

  test('an imported cost says so', () => {
    expect(formulaText(codParts(ticketOf(initial, 'HB-111')))).toBe('imported cost of delay 14');
  });

  test('releases: singular, none, and a ticket already at the top of the scale shows no climb', () => {
    expect(releasesText({ ...codParts(ticketOf(initial, 'HB-104')), past: 1 })).toBe('left out 1 release');
    expect(releasesText(codParts(ticketOf(initial, 'HB-104')))).toBeNull();
    const top = codParts({ ...ticketOf(initial, 'HB-104'), cost: { kind: 'formula', value: 5, urgency: 20, risk: 3 }, past: 4 });
    expect(formulaText(top)).toBe('value 5 + urgency 20 + risk 3 = 28');
    expect(releasesText(top)).toBe('left out 4 releases');
  });
});

describe('reasons and epitaphs', () => {
  test('the three reasons', () => {
    const noRoom: Reason = { kind: 'no-room', needed: 8, left: 0 };
    expect(reasonText(noRoom)).toBe('Needs 8 points, 0 left.');
    expect(reasonText({ kind: 'no-room', needed: 1, left: 0 })).toBe('Needs 1 point, 0 left.');
    expect(reasonText({ kind: 'depends-on-buried', buriedDependencies: ['HB-112'] })).toBe('Depends on HB-112, which is buried.');
    expect(reasonText({ kind: 'depends-on-buried', buriedDependencies: ['HB-1', 'HB-2'] })).toBe('Depends on HB-1 and HB-2, which are buried.');
    expect(reasonText({ kind: 'blocked-by-put-down', putDownKey: 'HB-112' })).toBe('Depends on HB-112, which was put down.');
  });

  test('epitaph, no room: one line of mood and the cause', () => {
    expect(epitaphFor(tomb(initial, 'HB-108'))).toBe('Here lies HB-108. It needed 8 points; the night had 0 left.');
  });
  test('epitaph, cascade', () => {
    expect(epitaphFor(tomb(initial, 'HB-114'))).toBe('Here lies HB-114. It followed HB-112 into the ground.');
  });
  test('epitaph, a zombie says the same kind of thing: how long it has been out is not in it', () => {
    expect(epitaphFor(tomb(initial, 'HB-112'))).toBe('Here lies HB-112. It needed 21 points; the night had 0 left.');
    expect(epitaphFor(tomb(initial, 'HB-110'))).toBe('Here lies HB-110. It needed 13 points; the night had 0 left.');
  });
  test('epitaph, blocked by a put down', () => {
    const closed = reducer(initial, { type: 'tombstone/put-down', key: 'HB-112' });
    expect(epitaphFor(tomb(closed, 'HB-114'))).toBe("Here lies HB-114. HB-112 was closed as Won't Do, so it can never ship.");
  });
  test('the epitaph carries no waiting cost and no release count, and does not depend on them', () => {
    for (const t of derive(initial).yard) {
      const text = epitaphFor(t);
      expect(text).not.toMatch(/Waiting|costs|left out|in a row/);
      const changed = { ...t, burialCost: t.burialCost + 7, cost: { ...t.cost, past: t.cost.past + 3, cod: t.cost.cod + 1 }, isZombie: !t.isZombie };
      expect(epitaphFor(changed)).toBe(text);
    }
  });
  test('the facts the epitaph used to carry are in the detail block and the hunger line', () => {
    const zombie = tomb(initial, 'HB-112');
    expect(waitingText(zombie.burialCost, 2)).toBe('32 over 2 weeks');
    expect(releasesText(zombie.cost)).toBe('left out 3 releases');
    expect(hungerText(zombie)).toBe('Hungrier next release: urgency 8 → 13');
    expect(waitingText(tomb(initial, 'HB-108').burialCost, 1)).toBe('20 over 1 week');
  });
  test('epitaphs are deterministic', () => {
    expect(epitaphFor(tomb(initial, 'HB-117'))).toBe(epitaphFor(tomb(initial, 'HB-117')));
  });
});describe('the verdict', () => {
  test('a solved cut: what is inside, what is left outside', () => {
    expect(verdictSentences(derive(initial))).toEqual([
      'Inside the safehouse: 12 tickets, 59 of 59 points, saved cod 167. Left outside: 7 tickets, cod 101.',
    ]);
  });

  test('with a reserve it says how the capacity was cut', () => {
    expect(verdictSentences(derive(run(initial, { type: 'reserve/set', pct: 15 })))).toEqual([
      'Inside the safehouse: 10 tickets, 49 of 50 points, saved cod 147. Left outside: 9 tickets, cod 121.',
      'Capacity 59, 15 % reserve.',
    ]);
  });

  test('one ticket is singular', () => {
    const lone = initialStateFor(
      (() => {
        const r = validateBoard({ ...sampleBoard(), tickets: sampleBoard().tickets.slice(0, 1) });
        if (!r.ok) throw new Error('invalid');
        return r.value;
      })(),
    );
    expect(verdictSentences(derive(lone))[0]).toBe('Inside the safehouse: 1 ticket, 5 of 59 points, saved cod 18. Left outside: 0 tickets, cod 0.');
  });

  test('an impossible freeze: the numbers and what to do', () => {
    const view = derive(run(initial, { type: 'candle/set', step: 2 }));
    expect(verdictSentences(view)).toEqual([
      'The must-haves need 15 points; there are 12 (12 after the 0 % reserve).',
      'Move the candle later, or drop a must-have.',
    ]);
  });

  test('the reserve is part of the impossible numbers', () => {
    const view = derive(run(initial, { type: 'candle/set', step: 3 }, { type: 'reserve/set', pct: 30 }));
    expect(verdictSentences(view)[0]).toBe('The must-haves need 15 points; there are 18 (12 after the 30 % reserve).');
  });

  test('a must-have that can never ship is named with the key it depends on', () => {
    const board = sampleBoard();
    const broken = validateBoard({
      ...board,
      tickets: [...board.tickets, { key: 'HB-120', title: 'Needs the dead', effort: 1, cost: { kind: 'imported', cod: 1 }, mustHave: true, dependsOn: ['HB-999'], past: 0 }],
      wontDo: ['HB-999'],
    });
    if (!broken.ok) throw new Error('invalid');
    expect(verdictSentences(derive(initialStateFor(broken.value)))).toEqual([
      'The must-haves need 16 points; there are 59 (59 after the 0 % reserve).',
      'HB-120 can never ship: it depends on HB-999, which was put down.',
      'Move the candle later, or drop a must-have.',
    ]);
  });
});

describe('the change note', () => {
  test('before anything moves', () => {
    expect(changeNote(initial.change)).toEqual({ kind: 'none', headline: 'Nothing has moved yet.', lines: [], alert: false });
  });

  test('a candle move that only sinks one ticket', () => {
    const note = changeNote(reducer(initial, { type: 'candle/set', step: 9 }).change);
    expect(note).toEqual({
      kind: 'done',
      headline: 'Candle moved to Fri 13:00.',
      lines: ['Sinks: HB-115 (13).', 'Loss: 13.', 'Saved cod 167 → 154.'],
      alert: false,
    });
  });

  test('a jump: three rise, two sink, with the cod of each side and the gain', () => {
    const note = changeNote(run(initial, { type: 'candle/set', step: 5 }, { type: 'candle/set', step: 6 }).change);
    expect(note.headline).toBe('Candle moved to Wed 18:00.');
    expect(note.lines).toEqual([
      'Rises: HB-104 (11), HB-106 (16), HB-107 (11); together 38.',
      'Sinks: HB-105 (11), HB-113 (14); together 25.',
      'Gain: 13.',
      'Saved cod 100 → 113.',
    ]);
  });

  test('reserve, and survivors going and coming back', () => {
    expect(changeNote(reducer(initial, { type: 'reserve/set', pct: 15 }).change)).toMatchObject({
      headline: 'Reserve set to 15 %.',
      lines: ['Sinks: HB-115 (13), HB-116 (7); together 20.', 'Loss: 20.', 'Saved cod 167 → 147.'],
    });
    const away = reducer(initial, { type: 'survivor/toggle', name: 'Ana' });
    expect(changeNote(away.change)).toMatchObject({
      headline: 'Ana sent away.',
      lines: ['Sinks: HB-113 (14), HB-115 (13), HB-118 (16); together 43.', 'Loss: 43.', 'Saved cod 167 → 124.'],
    });
    expect(changeNote(reducer(away, { type: 'survivor/toggle', name: 'Ana' }).change)).toMatchObject({
      headline: 'Ana is back.',
      lines: ['Rises: HB-113 (14), HB-115 (13), HB-118 (16); together 43.', 'Gain: 43.', 'Saved cod 124 → 167.'],
    });
  });

  test('exhume and resurrect say what comes back and what is buried in exchange', () => {
    const lines = ['Rises: HB-110 (13).', 'Sinks: HB-113 (14), HB-115 (13); together 27.', 'Loss: 14.', 'Saved cod 167 → 153.'];
    expect(changeNote(reducer(initial, { type: 'tombstone/exhume', key: 'HB-110' }).change)).toMatchObject({ headline: 'HB-110 exhumed.', lines });
    expect(changeNote(reducer(initial, { type: 'tombstone/resurrect', key: 'HB-110' }).change)).toMatchObject({ headline: 'HB-110 resurrected.', lines });
  });

  test('a rejected exhume is an alert with the numbers', () => {
    const note = changeNote(reducer(initial, { type: 'tombstone/exhume', key: 'HB-119' }).change);
    expect(note).toEqual({
      kind: 'rejected',
      headline: 'HB-119 stays in the ground.',
      lines: ['The must-haves with HB-119 need 63 points; there are 59 (59 after the 0 % reserve).', 'Move the candle later, or drop a must-have.'],
      alert: true,
    });
  });

  test('a rejected exhume that hits a put-down key names it', () => {
    const board = sampleBoard();
    const r = validateBoard({
      ...board,
      tickets: board.tickets.map((t) => (t.key === 'HB-108' ? { ...t, dependsOn: ['HB-999'] } : t)),
      wontDo: ['HB-999'],
    });
    if (!r.ok) throw new Error('invalid');
    const note = changeNote(reducer(initialStateFor(r.value), { type: 'tombstone/exhume', key: 'HB-108' }).change);
    expect(note.kind).toBe('rejected');
    expect(note.lines).toContain('HB-108 can never ship: it depends on HB-999, which was put down.');
  });

  test('a put down: what can never ship, and that the cut does not change', () => {
    expect(changeNote(reducer(initial, { type: 'tombstone/put-down', key: 'HB-112' }).change)).toEqual({
      kind: 'done',
      headline: "HB-112 closed as Won't Do.",
      lines: ['HB-114 can never ship.', 'No change in the cut.'],
      alert: false,
    });
    expect(changeNote(reducer(initial, { type: 'tombstone/put-down', key: 'HB-110' }).change).lines).toEqual(['No change in the cut.']);
  });

  test('refused actions are alerts too', () => {
    expect(changeNote(reducer(initial, { type: 'tombstone/put-down', key: 'HB-108' }).change)).toEqual({
      kind: 'refused',
      headline: 'Nothing was done.',
      lines: ['HB-108 is not a zombie, so it cannot be put down.'],
      alert: true,
    });
    expect(changeNote(reducer(initial, { type: 'tombstone/exhume', key: 'HB-999' }).change).lines).toEqual(['HB-999 is not on the board.']);
    const impossible = run(initial, { type: 'candle/set', step: 1 }, { type: 'tombstone/put-down', key: 'HB-110' });
    expect(changeNote(impossible.change).lines).toEqual(['The freeze is impossible, so there is no cut to change.']);
  });

  test('no comparison when the freeze is impossible on either side', () => {
    const into = changeNote(reducer(initial, { type: 'candle/set', step: 2 }).change);
    expect(into.lines).toEqual(['No comparison: the freeze is impossible (needs 15 points; 12 available).']);
    const out = changeNote(run(initial, { type: 'candle/set', step: 1 }, { type: 'candle/set', step: 4 }).change);
    expect(out.lines).toEqual(['No comparison: the freeze is impossible (needs 15 points; 6 available).']);
  });

  test('a reset says so, and when nothing changed it says that too', () => {
    expect(changeNote(reducer(initial, { type: 'board/reset' }).change)).toEqual({
      kind: 'done',
      headline: 'Back to the sample board.',
      lines: ['Nothing rises and nothing sinks.', 'No change in saved cod.', 'Saved cod 167 → 167.'],
      alert: false,
    });
    const messy = run(initial, { type: 'tombstone/exhume', key: 'HB-110' });
    expect(changeNote(reducer(messy, { type: 'board/reset' }).change).lines).toEqual([
      'Rises: HB-113 (14), HB-115 (13); together 27.',
      'Sinks: HB-110 (13).',
      'Gain: 14.',
      'Saved cod 153 → 167.',
    ]);
  });

  test('a reset that brings a closed ticket back compares only the totals', () => {
    const closed = run(initial, { type: 'candle/set', step: 4 }, { type: 'tombstone/put-down', key: 'HB-113' });
    expect(changeNote(reducer(closed, { type: 'board/reset' }).change).lines).toEqual([
      'Saved cod 79 → 167.',
      'The board changed, so there is no ticket-by-ticket comparison.',
    ]);
  });

  test('the announcement is the change, then the verdict, in one text', () => {
    const state = reducer(initial, { type: 'candle/set', step: 9 });
    expect(announcementText(state.change, derive(state))).toBe(
      'Candle moved to Fri 13:00. Sinks: HB-115 (13). Loss: 13. Saved cod 167 → 154. ' +
        'Inside the safehouse: 11 tickets, 51 of 53 points, saved cod 154. Left outside: 8 tickets, cod 114.',
    );
    expect(noteSentence(changeNote(state.change))).toBe('Candle moved to Fri 13:00. Sinks: HB-115 (13). Loss: 13. Saved cod 167 → 154.');
  });
});

describe('boards that fail validation', () => {
  const samples: Record<ValidationErrorCode, ValidationError> = {
    'duplicate-key': { code: 'duplicate-key', subject: 'HB-5' },
    'unknown-dependency': { code: 'unknown-dependency', subject: 'HB-5', keys: ['HB-9'] },
    'self-dependency': { code: 'self-dependency', subject: 'HB-5' },
    'dependency-cycle': { code: 'dependency-cycle', subject: 'HB-1', keys: ['HB-1', 'HB-2', 'HB-3'] },
    'not-integer': { code: 'not-integer', subject: 'HB-5', field: 'effort', value: '1.5' },
    'negative-number': { code: 'negative-number', subject: 'Ana', field: 'pointsPerHalfDay', value: -2 },
    'urgency-off-scale': { code: 'urgency-off-scale', subject: 'HB-5', field: 'urgency', value: 4 },
    'invalid-time-zone': { code: 'invalid-time-zone', subject: 'timeZone', value: 'Mars/Olympus' },
    'invalid-threshold': { code: 'invalid-threshold', subject: 'board', field: 'zombieThreshold', value: '0' },
    'wont-do-key-in-tickets': { code: 'wont-do-key-in-tickets', subject: 'HB-7' },
    'invalid-absence': { code: 'invalid-absence', subject: 'Ana', value: '2026-02-30 full' },
    'board-too-large': { code: 'board-too-large', subject: 'board' },
    'seed-out-of-range': { code: 'seed-out-of-range', subject: 'board', field: 'fogSeed', value: 4294967296 },
  };

  const expected: Record<ValidationErrorCode, string> = {
    'duplicate-key': 'Duplicate key HB-5: two tickets use it.',
    'unknown-dependency': 'HB-5 depends on HB-9, which is not on the board.',
    'self-dependency': 'HB-5 depends on itself.',
    'dependency-cycle': 'Dependency cycle: HB-1 → HB-2 → HB-3 → HB-1.',
    'not-integer': 'HB-5: effort must be a whole number (got 1.5).',
    'negative-number': 'Ana: pointsPerHalfDay cannot be negative (got -2).',
    'urgency-off-scale': 'HB-5: urgency must be 1, 2, 3, 5, 8, 13 or 20 (got 4).',
    'invalid-time-zone': 'Unknown time zone "Mars/Olympus".',
    'invalid-threshold': 'The zombie threshold must be a whole number of 1 or more (got 0).',
    'wont-do-key-in-tickets': 'HB-7 is both a ticket and a put-down key.',
    'invalid-absence': 'Ana has an invalid day off: 2026-02-30 full.',
    'board-too-large': 'The board is too large to solve exactly.',
    'seed-out-of-range': 'The fog seed must be a whole number from 0 to 4,294,967,295 (got 4294967296).',
  };

  test('every error code has its own sentence (the type makes a new code fail to compile here)', () => {
    for (const code of Object.keys(samples) as ValidationErrorCode[]) {
      expect(describeValidationError(samples[code])).toBe(expected[code]);
    }
  });

  test('a duplicate put-down key reads differently from a duplicate ticket', () => {
    expect(describeValidationError({ code: 'duplicate-key', subject: 'HB-9', field: 'wontDo' })).toBe('The put-down key HB-9 is listed twice.');
  });

  test('a missing value does not print "undefined"', () => {
    expect(describeValidationError({ code: 'not-integer', subject: 'HB-5', field: 'effort' })).toBe('HB-5: effort must be a whole number (got nothing).');
  });

  test('the sentences match what the engine actually reports for broken boards', () => {
    const board = sampleBoard();
    const broken = validateBoard({
      ...board,
      tickets: board.tickets.map((t) => (t.key === 'HB-101' ? { ...t, dependsOn: ['HB-102'] } : t.key === 'HB-102' ? { ...t, dependsOn: ['HB-101'] } : t)),
    });
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error.map(describeValidationError)).toEqual(['Dependency cycle: HB-101 → HB-102 → HB-101.']);
  });
});

describe('number provenance', () => {
  test('the checker finds a number that is not a fact, and accepts the absolute value of a loss', () => {
    expect(unexplained('Loss: 44.', { codDelta: -43 })).toEqual([44]);
    expect(unexplained('Loss: 43.', { codDelta: -43 })).toEqual([]);
    expect(unexplained('Rises: HB-112 (13). Candle moved to Wed 18:00.', { cod: 13 })).toEqual([]);
    expect(unexplained('Saved cod 100 → 113.', { a: 100 })).toEqual([113]);
  });

  test('on the initial state every integer in every sentence is a fact', () => {
    const view = derive(initial);
    expect(unexplained(verdictSentences(view).join(' '), view.solution, view.totals)).toEqual([]);
    for (const t of view.yard) {
      expect(unexplained(reasonText(t.reason), t.reason)).toEqual([]);
      expect(unexplained(epitaphFor(t), t)).toEqual([]);
    }
    for (const c of [...view.safehouse, ...view.yard]) {
      expect(unexplained(formulaText(c.cost), c.cost)).toEqual([]);
      expect(unexplained(releasesText(c.cost) ?? '', c.cost)).toEqual([]);
    }
  });

  test('after any sequence of actions, every integer the screen says is a fact it was given', () => {
    fc.assert(
      fc.property(fc.array(arbMeaningfulAction, { maxLength: 12 }), (actions) => {
        for (const state of statesAfter(actions)) {
          const view = derive(state);
          const weeks = state.board.nextReleaseWeeks;

          expect(unexplained(verdictSentences(view).join(' '), view.solution, view.totals)).toEqual([]);
          expect(unexplained(noteSentence(changeNote(state.change)), state.change)).toEqual([]);
          expect(unexplained(announcementText(state.change, view), state.change, view.solution, view.totals)).toEqual([]);
          for (const t of view.yard) {
            expect(unexplained(reasonText(t.reason), t.reason)).toEqual([]);
            expect(unexplained(epitaphFor(t), t)).toEqual([]);
            expect(unexplained(waitingText(t.burialCost, weeks), t, weeks)).toEqual([]);
            expect(unexplained(hungerText(t) ?? '', t)).toEqual([]);
          }
          for (const c of [...view.safehouse, ...view.yard]) {
            expect(unexplained(formulaText(c.cost), c.cost)).toEqual([]);
            expect(unexplained(releasesText(c.cost) ?? '', c.cost)).toEqual([]);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  test('the sentences are not vacuous: the sequences reach changes with numbers in them', () => {
    const sample = fc.sample(fc.array(arbMeaningfulAction, { minLength: 4, maxLength: 12 }), { numRuns: 100, seed: 5 });
    let withNumbers = 0;
    const kinds = new Set<string>();
    for (const actions of sample) {
      for (const state of statesAfter(actions)) {
        kinds.add(state.change.kind);
        if (integersInText(noteSentence(changeNote(state.change))).length >= 3) withNumbers++;
      }
    }
    expect(withNumbers).toBeGreaterThan(100);
    expect([...kinds].sort()).toEqual(['done', 'none', 'refused', 'rejected']);
  });

  test('the headline names the step label, which is not a number', () => {
    const note = changeNote(reducer(initial, { type: 'candle/set', step: 3 }).change);
    expect(note.headline).toBe(`Candle moved to ${CANDLE_STEPS[3]?.label}.`);
    expect(integersInText(note.headline)).toEqual([]);
  });
});

describe('the fog in words', () => {
  const at = (marginPct: number, step = 10) => {
    const state = reducer(reducer(initialState(), { type: 'candle/set', step }), { type: 'reserve/set', pct: marginPct });
    const view = derive(state);
    const point = view.fog?.points[view.fog.currentIndex ?? -1];
    if (point === undefined) throw new Error('no point');
    return { view, point };
  };
  const ok = (marginPct: number) => {
    const { point } = at(marginPct);
    if (point.status !== 'ok') throw new Error('expected a solved point');
    return point;
  };

  test('thousands puts the comma in', () => {
    expect([0, 7, 999, 1000, 12345, 4294967295].map(thousands)).toEqual(['0', '7', '999', '1,000', '12,345', '4,294,967,295']);
  });

  test('the headline is "Holds in", the floored percentage and the nights', () => {
    expect(fogHeadline(ok(0))).toEqual({ lead: 'Holds in', figure: '0 %', tail: 'of 1,000 nights' });
    expect(fogHeadline(ok(20))).toEqual({ lead: 'Holds in', figure: '70 %', tail: 'of 1,000 nights' });
  });

  test('the sentence gives what the inside needs, what the team has, the range of estimates and the raw count of nights', () => {
    expect(fogSentence(ok(0))).toBe('Inside needs 59 points on paper; the team has 59; estimates land between 80 % and 150 %. It held on 0 of 1,000 nights.');
    expect(fogSentence(ok(15))).toBe('Inside needs 49 points on paper; the team has 59; estimates land between 80 % and 150 %. It held on 347 of 1,000 nights.');
  });

  test('a floored 0 % still tells how many nights held', () => {
    const point = ok(5);
    expect(point.fog.pct).toBe(0);
    expect(point.fog.holds).toBe(6);
    expect(fogHeadline(point).figure).toBe('0 %');
    expect(fogSentence(point)).toBe('Inside needs 56 points on paper; the team has 59; estimates land between 80 % and 150 %. It held on 6 of 1,000 nights.');
    expect(stripItemText(point, true)).toBe('5 % reserve (current): holds in 0 % of 1,000 nights (6 nights)');
    expect(stripItemText(point, false)).toBe('5 % reserve: holds in 0 % of 1,000 nights (6 nights)');
  });

  test('one night is "1 night"', () => {
    const point = { ...ok(5), fog: { nights: 1000, holds: 1, pct: 0 } };
    expect(stripItemText(point, false)).toBe('5 % reserve: holds in 0 % of 1,000 nights (1 night)');
  });

  test('when there is no cut the sentence says why, with the engine numbers, and the strip item says impossible', () => {
    const { point, view } = at(0, 2);
    expect(point.status).toBe('impossible');
    if (point.status !== 'impossible') return;
    expect(fogImpossibleSentence(point)).toBe('No cut to test: the must-haves need 15 points; 12 are available after the 0 % reserve.');
    expect(stripItemText(point, true)).toBe('0 % reserve (current): impossible freeze');
    expect(view.solution.status).toBe('impossible');
  });

  test('every integer in the fog texts is a fact the engine returned (1,000 is read as the integer 1000)', () => {
    fc.assert(
      fc.property(fc.array(arbMeaningfulAction, { maxLength: 8 }), (actions) => {
        for (const state of statesAfter(actions)) {
          const view = derive(state);
          for (const point of view.fog?.points ?? []) {
            const facts = [point, 1000, 80, 150];
            if (point.status === 'ok') {
              expect(unexplained(fogHeadline(point).figure, point)).toEqual([]);
              expect(unexplained(fogHeadline(point).tail, ...facts)).toEqual([]);
              expect(unexplained(fogSentence(point), ...facts)).toEqual([]);
            } else {
              expect(unexplained(fogImpossibleSentence(point), point)).toEqual([]);
            }
            expect(unexplained(stripItemText(point, false), ...facts)).toEqual([]);
          }
        }
      }),
      { numRuns: 25 },
    );
  });

  test('no text promises that more reserve helps: nothing says safe, better, best, recommend, always, raises, improves, more reserve ...', () => {
    const forbidden =
      /\b(safe|safer|safest|risky|good|bad|better|best|worse|worst|recommend\w*|guarantee\w*|always|never|raises?|improves?|increases?|boosts?|highest|lowest|ideal|optimal|sweet spot|(more|bigger|larger|higher) (reserve|margin|buffer))\b/i;
    const seen: string[] = [];
    for (let step = 0; step <= 10; step++) {
      for (const pct of [0, 5, 10, 15, 20, 25, 30]) {
        const { view, point } = at(pct, step);
        const texts: string[] = [];
        if (point.status === 'ok') {
          const h = fogHeadline(point);
          texts.push(`${h.lead} ${h.figure} ${h.tail}`, fogSentence(point));
        } else {
          texts.push(fogImpossibleSentence(point));
        }
        (view.fog?.points ?? []).forEach((p, i) => texts.push(stripItemText(p, i === view.fog?.currentIndex)));
        for (const text of texts) {
          expect(text, `${step}/${pct}: ${text}`).not.toMatch(forbidden);
          seen.push(text);
        }
      }
    }
    expect(seen.length).toBeGreaterThan(500);
  });
});