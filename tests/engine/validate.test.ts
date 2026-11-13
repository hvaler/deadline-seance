import { describe, expect, test } from 'vitest';
import { allClosures, allDependents, blockedBy, closureOf, findCycles, indexByKey } from '../../src/engine/chain';
import { validateBoard } from '../../src/engine/validate';
import type { Board, Ticket, ValidationError } from '../../src/engine/types';

function ticket(key: string, over: Partial<Ticket> = {}): Ticket {
  return {
    key,
    title: key,
    effort: 3,
    cost: { kind: 'formula', value: 3, urgency: 2, risk: 1 },
    mustHave: false,
    dependsOn: [],
    past: 0,
    ...over,
  };
}

function board(tickets: Ticket[], over: Partial<Board> = {}): Board {
  return {
    tickets,
    people: [{ name: 'Ana', pointsPerHalfDay: 2, daysOff: [] }],
    timeZone: 'Europe/Madrid',
    nextReleaseWeeks: 2,
    zombieThreshold: 3,
    wontDo: [],
    ...over,
  };
}

function errorsOf(b: Board): ValidationError[] {
  const r = validateBoard(b);
  if (r.ok) throw new Error('expected validation errors');
  return r.error;
}

function codes(b: Board): string[] {
  return errorsOf(b).map((e) => e.code);
}

describe('validateBoard', () => {
  test('a good board is returned as is', () => {
    const b = board([ticket('A-1'), ticket('A-2', { dependsOn: ['A-1'] })]);
    const r = validateBoard(b);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(b);
  });

  test('an empty board is valid', () => {
    expect(validateBoard(board([])).ok).toBe(true);
  });

  test('duplicate-key', () => {
    expect(errorsOf(board([ticket('A-1'), ticket('A-1')]))).toEqual([{ code: 'duplicate-key', subject: 'A-1' }]);
  });

  test('unknown-dependency names the ticket and the missing key', () => {
    expect(errorsOf(board([ticket('A-1', { dependsOn: ['Z-9'] })]))).toEqual([
      { code: 'unknown-dependency', subject: 'A-1', keys: ['Z-9'] },
    ]);
  });

  test('a dependency on a put-down key is valid, not unknown', () => {
    const b = board([ticket('A-1', { dependsOn: ['W-1'] })], { wontDo: ['W-1'] });
    expect(validateBoard(b).ok).toBe(true);
  });

  test('wont-do-key-in-tickets', () => {
    expect(codes(board([ticket('A-1')], { wontDo: ['A-1'] }))).toEqual(['wont-do-key-in-tickets']);
  });

  test('self-dependency', () => {
    expect(errorsOf(board([ticket('A-1', { dependsOn: ['A-1'] })]))).toEqual([{ code: 'self-dependency', subject: 'A-1' }]);
  });

  test('dependency-cycle lists the cycle starting at its smallest key', () => {
    const b = board([
      ticket('D-1', { dependsOn: ['B-1'] }),
      ticket('B-1', { dependsOn: ['C-1'] }),
      ticket('C-1', { dependsOn: ['D-1'] }),
    ]);
    expect(errorsOf(b)).toEqual([{ code: 'dependency-cycle', subject: 'B-1', keys: ['B-1', 'C-1', 'D-1'] }]);
  });

  test('not-integer and negative-number', () => {
    expect(errorsOf(board([ticket('A-1', { effort: 1.5 })]))).toEqual([
      { code: 'not-integer', subject: 'A-1', field: 'effort', value: '1.5' },
    ]);
    expect(errorsOf(board([ticket('A-1', { effort: -1 })]))).toEqual([
      { code: 'negative-number', subject: 'A-1', field: 'effort', value: -1 },
    ]);
    expect(codes(board([ticket('A-1', { past: -2 })]))).toEqual(['negative-number']);
    expect(codes(board([ticket('A-1')], { nextReleaseWeeks: -1 }))).toEqual(['negative-number']);
    expect(codes(board([ticket('A-1', { effort: Number.NaN })]))).toEqual(['not-integer']);
    expect(codes(board([], { people: [{ name: 'Ana', pointsPerHalfDay: -1, daysOff: [] }] }))).toEqual(['negative-number']);
  });

  test('urgency-off-scale applies to value, urgency and risk', () => {
    const bad = (cost: Ticket['cost']) => errorsOf(board([ticket('A-1', { cost })]));
    expect(bad({ kind: 'formula', value: 4, urgency: 2, risk: 1 })).toEqual([
      { code: 'urgency-off-scale', subject: 'A-1', field: 'value', value: 4 },
    ]);
    expect(bad({ kind: 'formula', value: 3, urgency: 21, risk: 1 })).toEqual([
      { code: 'urgency-off-scale', subject: 'A-1', field: 'urgency', value: 21 },
    ]);
    expect(bad({ kind: 'formula', value: 3, urgency: 2, risk: 0 })).toEqual([
      { code: 'urgency-off-scale', subject: 'A-1', field: 'risk', value: 0 },
    ]);
  });

  test('an imported cod must be a non-negative integer', () => {
    expect(validateBoard(board([ticket('A-1', { cost: { kind: 'imported', cod: 0 } })])).ok).toBe(true);
    expect(codes(board([ticket('A-1', { cost: { kind: 'imported', cod: -3 } })]))).toEqual(['negative-number']);
    expect(codes(board([ticket('A-1', { cost: { kind: 'imported', cod: 2.5 } })]))).toEqual(['not-integer']);
  });

  test('invalid-time-zone', () => {
    expect(errorsOf(board([], { timeZone: 'Mars/Olympus' }))).toEqual([
      { code: 'invalid-time-zone', subject: 'timeZone', value: 'Mars/Olympus' },
    ]);
  });

  test('invalid-threshold', () => {
    expect(codes(board([], { zombieThreshold: 0 }))).toEqual(['invalid-threshold']);
    expect(codes(board([], { zombieThreshold: 1.5 }))).toEqual(['invalid-threshold']);
    expect(validateBoard(board([], { zombieThreshold: 1 })).ok).toBe(true);
  });

  test('invalid-absence: bad format, impossible date, bad part', () => {
    const person = (date: string, part: string) => ({
      name: 'Ana',
      pointsPerHalfDay: 2,
      daysOff: [{ date, part: part as 'full' }],
    });
    expect(codes(board([], { people: [person('2026-13-01', 'full')] }))).toEqual(['invalid-absence']);
    expect(codes(board([], { people: [person('2026-02-30', 'full')] }))).toEqual(['invalid-absence']);
    expect(codes(board([], { people: [person('20/11/2026', 'full')] }))).toEqual(['invalid-absence']);
    expect(codes(board([], { people: [person('2026-11-20', 'evening')] }))).toEqual(['invalid-absence']);
    expect(validateBoard(board([], { people: [person('2028-02-29', 'morning')] })).ok).toBe(true);
  });

  test('board-too-large when exact integer arithmetic could not be guaranteed', () => {
    const tickets = Array.from({ length: 80 }, (_, i) => ticket(`T-${String(i).padStart(2, '0')}`, { effort: 1_000_000_000 }));
    expect(codes(board(tickets))).toEqual(['board-too-large']);
  });

  test('reports every error, sorted by code then subject', () => {
    const b = board([ticket('B-1', { effort: -1 }), ticket('A-1', { dependsOn: ['Z-9'] }), ticket('A-1')]);
    expect(codes(b)).toEqual(['duplicate-key', 'negative-number', 'unknown-dependency']);
  });

  test('the errors do not depend on the order of tickets or dependencies', () => {
    const tickets = [
      ticket('C-1', { dependsOn: ['A-1', 'B-1'] }),
      ticket('A-1', { dependsOn: ['B-1'] }),
      ticket('B-1', { dependsOn: ['C-1'], effort: -3 }),
      ticket('D-1', { dependsOn: ['Q-1', 'A-1'] }),
    ];
    const forward = errorsOf(board(tickets));
    const reversed = errorsOf(
      board([...tickets].reverse().map((t) => ({ ...t, dependsOn: [...t.dependsOn].reverse() }))),
    );
    expect(reversed).toEqual(forward);
  });

  test('does not mutate its input', () => {
    const b = board([ticket('A-1', { dependsOn: ['B-1'] }), ticket('B-1')]);
    const copy = JSON.parse(JSON.stringify(b)) as Board;
    validateBoard(b);
    expect(b).toEqual(copy);
  });
});

describe('chain', () => {
  const tickets = [
    ticket('A-1'),
    ticket('B-1', { dependsOn: ['A-1'] }),
    ticket('C-1', { dependsOn: ['B-1', 'W-1'] }),
    ticket('D-1'),
  ];

  test('closureOf includes the ticket and its whole chain, and ignores put-down keys', () => {
    expect([...closureOf('C-1', indexByKey(tickets))].sort()).toEqual(['A-1', 'B-1', 'C-1']);
    expect([...closureOf('D-1', indexByKey(tickets))]).toEqual(['D-1']);
    expect(closureOf('Z-9', indexByKey(tickets)).size).toBe(0);
  });

  test('allClosures and allDependents agree', () => {
    const closures = allClosures(tickets);
    const dependents = allDependents(tickets);
    expect([...(dependents.get('A-1') as Set<string>)].sort()).toEqual(['B-1', 'C-1']);
    expect([...(dependents.get('C-1') as Set<string>)]).toEqual([]);
    for (const [key, closure] of closures) {
      for (const member of closure) {
        if (member !== key) expect(dependents.get(member)?.has(key)).toBe(true);
      }
    }
  });

  test('blockedBy marks tickets whose chain reaches a put-down key, with the smallest key', () => {
    const t = [
      ticket('A-1', { dependsOn: ['W-2', 'W-1'] }),
      ticket('B-1', { dependsOn: ['A-1'] }),
      ticket('C-1'),
    ];
    const blocked = blockedBy(t, ['W-1', 'W-2']);
    expect(blocked.get('A-1')).toBe('W-1');
    expect(blocked.get('B-1')).toBe('W-1');
    expect(blocked.has('C-1')).toBe(false);
  });

  test('findCycles reports each cycle once, and handles two cycles', () => {
    const t = [
      ticket('B-1', { dependsOn: ['A-1'] }),
      ticket('A-1', { dependsOn: ['B-1'] }),
      ticket('X-1', { dependsOn: ['Y-1'] }),
      ticket('Y-1', { dependsOn: ['X-1'] }),
    ];
    expect(findCycles(t)).toEqual([
      ['A-1', 'B-1'],
      ['X-1', 'Y-1'],
    ]);
    expect(findCycles(tickets)).toEqual([]);
  });

  test('a long chain does not overflow the stack', () => {
    const n = 20_000;
    const t = Array.from({ length: n }, (_, i) =>
      ticket(`K-${String(i).padStart(6, '0')}`, i === 0 ? {} : { dependsOn: [`K-${String(i - 1).padStart(6, '0')}`] }),
    );
    expect(closureOf(`K-${String(n - 1).padStart(6, '0')}`, indexByKey(t)).size).toBe(n);
    expect(findCycles(t)).toEqual([]);
  });
});
