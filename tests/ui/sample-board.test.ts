import { describe, expect, test } from 'vitest';
import { codParts, diffSolutions, exhume, fogCurve, putDown, solveFreeze, validateBoard } from '../../src/engine/index';
import type { Board, Diff, Solution, SolvedSolution, ValidBoard } from '../../src/engine/index';
import { CANDLE_STEPS, LAST_CANDLE_STEP } from '../../src/ui/candle-steps';
import { SAMPLE_NOW, PRODUCT_LINE, sampleBoard } from '../../src/ui/sample-board';

// These tests pin the facts of the design (section 3) so a change in the engine or in the sample data is noticed.

function valid(board: Board): ValidBoard {
  const r = validateBoard(board);
  if (!r.ok) throw new Error(`invalid sample: ${JSON.stringify(r.error)}`);
  return r.value;
}

function without(board: Board, ...names: string[]): ValidBoard {
  return valid({ ...board, people: board.people.filter((p) => !names.includes(p.name)) });
}

function solveAt(board: ValidBoard, step: number, marginPct = 0): Solution {
  const r = solveFreeze(board, { now: SAMPLE_NOW, freezeAt: CANDLE_STEPS[step]!.freezeAt, marginPct });
  if (!r.ok) throw new Error(`solver error: ${r.error.code}`);
  return r.value;
}

function solvedAt(board: ValidBoard, step: number, marginPct = 0): SolvedSolution {
  const s = solveAt(board, step, marginPct);
  if (s.status !== 'ok') throw new Error(`expected a solution at step ${step}`);
  return s;
}

function diff(before: Solution, after: Solution): Diff {
  const r = diffSolutions(before, after);
  if (!r.ok) throw new Error(`diff error: ${r.error.code}`);
  return r.value;
}

const keys = (list: readonly { key: string }[]): string[] => list.map((e) => e.key);
const FRIDAY = LAST_CANDLE_STEP;

describe('the sample board', () => {
  const raw = sampleBoard();
  const board = valid(raw);

  test('passes validation and has 19 tickets and 4 survivors', () => {
    expect(board.tickets).toHaveLength(19);
    expect(board.people.map((p) => p.name)).toEqual(['Ana', 'Bruno', 'Carla', 'Dev']);
    expect(board.tickets.map((t) => t.key)).toEqual(Array.from({ length: 19 }, (_, i) => `HB-${101 + i}`));
  });

  test('is a fresh copy every time', () => {
    const a = sampleBoard();
    const b = sampleBoard();
    expect(a).toEqual(b);
    expect(a.tickets).not.toBe(b.tickets);
    expect(a.tickets[0]).not.toBe(b.tickets[0]);
  });

  test('the clock is a constant: Monday 2026-11-16, 09:00 in Madrid', () => {
    expect(SAMPLE_NOW).toBe(Date.UTC(2026, 10, 16, 8, 0));
    expect(PRODUCT_LINE).toBe('Hollow Bank app 3.2 · release eve');
  });

  test('has no third-party trademark in any title', () => {
    const titles = board.tickets.map((t) => t.title).join('\n');
    expect(titles).not.toMatch(/apple|google|android|ios|iphone|samsung|paypal|visa|mastercard/i);
    expect(board.tickets.find((t) => t.key === 'HB-115')?.title).toBe('Phone wallet pass');
  });

  test('has three must-haves, a chain of three, one imported cost, and the two hungry tickets', () => {
    expect(board.tickets.filter((t) => t.mustHave).map((t) => t.key)).toEqual(['HB-101', 'HB-102', 'HB-103']);
    const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
    expect(byKey.get('HB-107')?.dependsOn).toEqual(['HB-106']);
    expect(byKey.get('HB-106')?.dependsOn).toEqual(['HB-104']);
    expect(byKey.get('HB-104')?.dependsOn).toEqual([]);
    expect(board.tickets.filter((t) => t.cost.kind === 'imported').map((t) => t.key)).toEqual(['HB-111']);
  });

  test('hunger: HB-105 urgency 1 to 5 (cod 7 to 11) and HB-113 urgency 3 to 8 (cod 9 to 14)', () => {
    const byKey = new Map(board.tickets.map((t) => [t.key, t] as const));
    const h105 = codParts(byKey.get('HB-105')!);
    expect(h105).toMatchObject({ urgency: 1, effectiveUrgency: 5, past: 3, cod: 11 });
    expect(codParts({ ...byKey.get('HB-105')!, past: 0 }).cod).toBe(7);
    const h113 = codParts(byKey.get('HB-113')!);
    expect(h113).toMatchObject({ urgency: 3, effectiveUrgency: 8, past: 2, cod: 14 });
    expect(codParts({ ...byKey.get('HB-113')!, past: 0 }).cod).toBe(9);
    expect(codParts(byKey.get('HB-111')!)).toMatchObject({ imported: true, cod: 14 });
  });

  test('total effort is 188 and total cod is 268', () => {
    expect(board.tickets.reduce((s, t) => s + t.effort, 0)).toBe(188);
    expect(board.tickets.reduce((s, t) => s + codParts(t).cod, 0)).toBe(268);
  });
});

describe('the cut at the initial state (Friday 18:00, no reserve, everybody here)', () => {
  const board = valid(sampleBoard());
  const sol = solvedAt(board, FRIDAY);

  test('capacity 59 and the cut fills 59 of 59 points', () => {
    expect(sol.capacity).toBe(59);
    expect(sol.effectiveCapacity).toBe(59);
    expect(sol.keptEffort).toBe(59);
    expect(sol.savedCod).toBe(167);
  });

  test('kept and buried tickets', () => {
    expect(sol.kept).toEqual(['HB-101', 'HB-102', 'HB-103', 'HB-104', 'HB-105', 'HB-106', 'HB-107', 'HB-109', 'HB-113', 'HB-115', 'HB-116', 'HB-118']);
    expect(keys(sol.buried)).toEqual(['HB-108', 'HB-110', 'HB-111', 'HB-112', 'HB-114', 'HB-117', 'HB-119']);
    expect(sol.buriedEffort).toBe(129);
    expect(sol.buriedCod).toBe(101);
  });

  test('two zombies in the yard: HB-110 and HB-112', () => {
    expect(sol.zombies).toEqual(['HB-110', 'HB-112']);
  });

  test('one cascade: HB-114 follows HB-112', () => {
    expect(sol.buried.find((b) => b.key === 'HB-114')?.reason).toEqual({ kind: 'depends-on-buried', buriedDependencies: ['HB-112'] });
  });

  test('the other buried tickets have no room left', () => {
    for (const b of sol.buried.filter((x) => x.key !== 'HB-114')) expect(b.reason.kind).toBe('no-room');
  });
});

describe('the candle moving through the week', () => {
  const board = valid(sampleBoard());

  test('impossible at steps 0, 1 and 2: the must-haves need 15 points', () => {
    for (const [step, capacity] of [[0, 0], [1, 6], [2, 12]] as const) {
      expect(solveAt(board, step)).toMatchObject({ status: 'impossible', capacity, needed: 15 });
    }
  });

  test('possible from step 3 on, and the saved cod never drops as the candle moves right', () => {
    let previous = -1;
    for (let step = 3; step <= FRIDAY; step++) {
      const s = solvedAt(board, step);
      expect(s.savedCod).toBeGreaterThanOrEqual(previous);
      previous = s.savedCod;
    }
  });

  test('a jump: Wed 13:00 to Wed 18:00 raises three and sinks two (gain 13)', () => {
    const d = diff(solvedAt(board, 5), solvedAt(board, 6));
    expect(keys(d.raised)).toEqual(['HB-104', 'HB-106', 'HB-107']);
    expect(keys(d.sunk)).toEqual(['HB-105', 'HB-113']);
    expect(d).toMatchObject({ raisedCod: 38, sunkCod: 25, codDelta: 13 });
  });

  test('Fri 13:00 to Fri 18:00 raises HB-115 (gain 13)', () => {
    const d = diff(solvedAt(board, 9), solvedAt(board, 10));
    expect(keys(d.raised)).toEqual(['HB-115']);
    expect(d.sunk).toEqual([]);
    expect(d.codDelta).toBe(13);
  });
});

describe('actions on the sample board at the initial state', () => {
  const board = valid(sampleBoard());
  const freeze = { now: SAMPLE_NOW, freezeAt: CANDLE_STEPS[FRIDAY]!.freezeAt, marginPct: 0 };

  test('exhuming HB-119 is rejected: the must-haves with it need 63 points and there are 59', () => {
    const r = exhume(board, freeze, 'HB-119');
    expect(r.ok && r.value).toEqual({
      kind: 'rejected',
      impossible: { status: 'impossible', capacity: 59, effectiveCapacity: 59, marginPct: 0, needed: 63, blockedMustHaves: [] },
    });
  });

  test('exhuming HB-108 sinks HB-115 (loss 3); HB-110 sinks HB-113 and HB-115 (loss 14); HB-112 also sinks HB-118 (loss 27)', () => {
    const cases: [string, string[], string[], number][] = [
      ['HB-108', ['HB-108'], ['HB-115'], -3],
      ['HB-110', ['HB-110'], ['HB-113', 'HB-115'], -14],
      ['HB-112', ['HB-112'], ['HB-113', 'HB-115', 'HB-118'], -27],
    ];
    for (const [key, raised, sunk, delta] of cases) {
      const r = exhume(board, freeze, key);
      if (!r.ok || r.value.kind !== 'applied') throw new Error(`expected ${key} to be applied`);
      expect(keys(r.value.diff.raised)).toEqual(raised);
      expect(keys(r.value.diff.sunk)).toEqual(sunk);
      expect(r.value.diff.codDelta).toBe(delta);
    }
  });

  test('putting down HB-112 changes nothing in the cut, and HB-114 can never ship', () => {
    const r = putDown(board, freeze, 'HB-112');
    if (!r.ok) throw new Error(`putDown error: ${r.error.code}`);
    expect(r.value.diff).toEqual({ raised: [], sunk: [], raisedCod: 0, sunkCod: 0, codDelta: 0 });
    expect(r.value.board.wontDo).toEqual(['HB-112']);
    expect(r.value.after.buried.find((b) => b.key === 'HB-114')?.reason).toEqual({ kind: 'blocked-by-put-down', putDownKey: 'HB-112' });
  });

  test('putting down HB-110 changes nothing else', () => {
    const r = putDown(board, freeze, 'HB-110');
    expect(r.ok && r.value.diff.codDelta).toBe(0);
    expect(r.ok && keys(r.value.after.buried)).toEqual(['HB-108', 'HB-111', 'HB-112', 'HB-114', 'HB-117', 'HB-119']);
  });

  test('a ticket that is not a zombie cannot be put down', () => {
    expect(putDown(board, freeze, 'HB-108')).toEqual({ ok: false, error: { code: 'not-a-zombie', key: 'HB-108' } });
  });
});

describe('survivors and reserve on the sample board', () => {
  const raw = sampleBoard();
  const board = valid(raw);
  const full = solvedAt(board, FRIDAY);

  test('Ana away: capacity 39, sinks HB-113, HB-115 and HB-118 (loss 43)', () => {
    const after = solvedAt(without(raw, 'Ana'), FRIDAY);
    expect(after.capacity).toBe(39);
    const d = diff(full, after);
    expect(d.raised).toEqual([]);
    expect(keys(d.sunk)).toEqual(['HB-113', 'HB-115', 'HB-118']);
    expect(d.codDelta).toBe(-43);
  });

  test('Dev away: capacity 50, sinks HB-115 and HB-116 (loss 20)', () => {
    const after = solvedAt(without(raw, 'Dev'), FRIDAY);
    expect(after.capacity).toBe(50);
    const d = diff(full, after);
    expect(keys(d.sunk)).toEqual(['HB-115', 'HB-116']);
    expect(d.codDelta).toBe(-20);
  });

  test('everybody away: capacity 0 and the freeze is impossible', () => {
    expect(solveAt(without(raw, 'Ana', 'Bruno', 'Carla', 'Dev'), FRIDAY)).toMatchObject({ status: 'impossible', capacity: 0, needed: 15 });
  });

  test('reserve 15 %: effective capacity 50, sinks HB-115 and HB-116 (loss 20); reserve 30 %: effective 41, also sinks HB-118 (loss 36)', () => {
    const fifteen = solvedAt(board, FRIDAY, 15);
    expect(fifteen).toMatchObject({ capacity: 59, effectiveCapacity: 50 });
    expect(keys(diff(full, fifteen).sunk)).toEqual(['HB-115', 'HB-116']);
    expect(diff(full, fifteen).codDelta).toBe(-20);

    const thirty = solvedAt(board, FRIDAY, 30);
    expect(thirty).toMatchObject({ capacity: 59, effectiveCapacity: 41 });
    expect(keys(diff(full, thirty).sunk)).toEqual(['HB-115', 'HB-116', 'HB-118']);
    expect(diff(full, thirty).codDelta).toBe(-36);
  });
});

describe('the fog of the sample board', () => {
  // The real numbers of the engine for the sample board, seed 20261116, with the candle on Friday 18:00. Nobody picked them: the seed was fixed
  // before they were computed. The prototype's 0 / 20 / 81 / 100 came from a fake board and are not a target. If the hash, the seed or the
  // sample board change, this test changes on purpose, and so do the demo message in product.md and docs/rule.md.
  const CURVE = [
    { marginPct: 0, effectiveCapacity: 59, keptCount: 12, keptEffort: 59, holds: 0, pct: 0 },
    { marginPct: 5, effectiveCapacity: 56, keptCount: 11, keptEffort: 56, holds: 6, pct: 0 }, // a few nights hold, and the floor says 0 %
    { marginPct: 10, effectiveCapacity: 53, keptCount: 11, keptEffort: 51, holds: 134, pct: 13 },
    { marginPct: 15, effectiveCapacity: 50, keptCount: 10, keptEffort: 49, holds: 347, pct: 34 },
    { marginPct: 20, effectiveCapacity: 47, keptCount: 10, keptEffort: 46, holds: 707, pct: 70 },
    { marginPct: 25, effectiveCapacity: 44, keptCount: 10, keptEffort: 43, holds: 959, pct: 95 },
    { marginPct: 30, effectiveCapacity: 41, keptCount: 9, keptEffort: 41, holds: 996, pct: 99 },
  ];

  test('the chance at Friday 18:00 for every reserve step, with the raw count of nights', () => {
    expect(sampleBoard().fogSeed).toBe(20261116);
    const r = fogCurve(valid(sampleBoard()), { now: SAMPLE_NOW, freezeAt: CANDLE_STEPS[LAST_CANDLE_STEP]!.freezeAt });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const shown = r.value.map((p) =>
      p.status === 'ok'
        ? { marginPct: p.marginPct, effectiveCapacity: p.effectiveCapacity, keptCount: p.keptCount, keptEffort: p.keptEffort, holds: p.fog.holds, pct: p.fog.pct }
        : { marginPct: p.marginPct, impossible: true },
    );
    expect(shown).toEqual(CURVE);
    expect(r.value.every((p) => p.status === 'ok' && p.capacity === 59)).toBe(true);
  });

  test('the percentage is floored: at 5 % reserve 6 nights hold and it reads 0 %', () => {
    const five = CURVE[1]!;
    expect(five.holds).toBeGreaterThan(0);
    expect(five.pct).toBe(0);
    expect(Math.floor((100 * five.holds) / 1000)).toBe(five.pct);
  });

  test('the first three candle positions leave no cut to test at any reserve', () => {
    for (const step of [0, 1, 2]) {
      const r = fogCurve(valid(sampleBoard()), { now: SAMPLE_NOW, freezeAt: CANDLE_STEPS[step]!.freezeAt });
      expect(r.ok && r.value.every((p) => p.status === 'impossible' && p.fog === null)).toBe(true);
    }
  });
});