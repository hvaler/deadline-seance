import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { capacityBetween, effectiveCapacity } from '../../src/engine/capacity';
import type { Absence, Person } from '../../src/engine/types';
import { arbAbsences, arbCapacityCase } from './generators';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Unwraps a capacity result; a failure fails the test. */
function cap(people: readonly Person[], timeZone: string, from: number, to: number): number {
  const r = capacityBetween(people, timeZone, from, to);
  if (!r.ok) throw new Error(`capacity error: ${r.error.code}`);
  return r.value;
}

function person(name: string, pointsPerHalfDay: number, daysOff: Absence[] = []): Person {
  return { name, pointsPerHalfDay, daysOff };
}

// Europe/Madrid in November 2026 is CET (UTC+1). Monday 2026-11-16.
const MADRID = 'Europe/Madrid';
const MON_0900 = Date.UTC(2026, 10, 16, 8, 0); // 09:00 CET
const FRI_1800 = Date.UTC(2026, 10, 20, 17, 0); // 18:00 CET
const FRI_1200 = Date.UTC(2026, 10, 20, 11, 0); // 12:00 CET
const MON_1200 = Date.UTC(2026, 10, 16, 11, 0); // 12:00 CET
const ana = person('Ana', 2);

describe('capacityBetween (examples)', () => {
  test('a full week, one person at 2 points per half day: 10 slots x 2 = 20', () => {
    expect(cap([ana], MADRID, MON_0900, FRI_1800)).toBe(20);
  });

  test('two people add up', () => {
    expect(cap([ana, person('Ben', 3)], MADRID, MON_0900, FRI_1800)).toBe(50);
  });

  test('a freeze at 12:00 keeps the morning (midpoint 11:00 is before 12:00)', () => {
    expect(cap([ana], MADRID, MON_0900, FRI_1200)).toBe(18);
  });

  test('a start at 12:00 drops the morning (midpoint 11:00 is before the start)', () => {
    expect(cap([ana], MADRID, MON_1200, FRI_1800)).toBe(18);
  });

  test('the midpoint itself: included at the start, excluded at the end (half-open)', () => {
    const mon1100 = Date.UTC(2026, 10, 16, 10, 0);
    expect(cap([ana], MADRID, mon1100, mon1100 + 1 * MIN)).toBe(2);
    expect(cap([ana], MADRID, mon1100 + MIN, mon1100 + 2 * MIN)).toBe(0);
    expect(cap([ana], MADRID, mon1100 - MIN, mon1100)).toBe(0);
  });

  test('afternoon midpoint is 16:00', () => {
    const mon1600 = Date.UTC(2026, 10, 16, 15, 0);
    expect(cap([ana], MADRID, mon1600, mon1600 + MIN)).toBe(2);
    expect(cap([ana], MADRID, mon1600 - HOUR, mon1600)).toBe(0);
  });

  test('weekends do not count', () => {
    const sat = Date.UTC(2026, 10, 21, 0, 0);
    const monNext = Date.UTC(2026, 10, 23, 0, 0);
    expect(cap([ana], MADRID, sat, monNext)).toBe(0);
  });

  test('a full week plus the weekend plus the next Monday morning', () => {
    const nextMon1200 = Date.UTC(2026, 10, 23, 11, 0);
    expect(cap([ana], MADRID, MON_0900, nextMon1200)).toBe(22);
  });

  test('empty range, reversed range and no people give 0', () => {
    expect(cap([ana], MADRID, MON_0900, MON_0900)).toBe(0);
    expect(cap([ana], MADRID, FRI_1800, MON_0900)).toBe(0);
    expect(cap([], MADRID, MON_0900, FRI_1800)).toBe(0);
    expect(cap([person('Zero', 0)], MADRID, MON_0900, FRI_1800)).toBe(0);
  });

  test('a full-day absence removes two slots; a morning absence removes one', () => {
    const wed = '2026-11-18';
    expect(cap([person('Ana', 2, [{ date: wed, part: 'full' }])], MADRID, MON_0900, FRI_1800)).toBe(16);
    expect(cap([person('Ana', 2, [{ date: wed, part: 'morning' }])], MADRID, MON_0900, FRI_1800)).toBe(18);
    expect(cap([person('Ana', 2, [{ date: wed, part: 'afternoon' }])], MADRID, MON_0900, FRI_1800)).toBe(18);
  });

  test('overlapping absences are not subtracted twice', () => {
    const wed = '2026-11-18';
    const p = person('Ana', 2, [
      { date: wed, part: 'full' },
      { date: wed, part: 'morning' },
      { date: wed, part: 'full' },
    ]);
    expect(cap([p], MADRID, MON_0900, FRI_1800)).toBe(16);
  });

  test('an absence only affects that person', () => {
    const wed = '2026-11-18';
    const away = person('Ana', 2, [{ date: wed, part: 'full' }]);
    expect(cap([away, person('Ben', 3)], MADRID, MON_0900, FRI_1800)).toBe(16 + 30);
  });

  test('an absence on a weekend or outside the range changes nothing', () => {
    const p = person('Ana', 2, [
      { date: '2026-11-21', part: 'full' },
      { date: '2027-01-01', part: 'full' },
    ]);
    expect(cap([p], MADRID, MON_0900, FRI_1800)).toBe(20);
  });
});

describe('capacityBetween (time zones and daylight saving)', () => {
  test('Madrid, autumn change on Sunday 2026-10-25: Monday 11:00 is CET (10:00Z), not CEST', () => {
    const fri0900 = Date.UTC(2026, 9, 23, 7, 0); // 09:00 CEST
    const monMid = Date.UTC(2026, 9, 26, 10, 0); // 11:00 CET
    expect(cap([ana], MADRID, fri0900, monMid)).toBe(4); // Friday only
    expect(cap([ana], MADRID, fri0900, monMid + MIN)).toBe(6); // plus Monday morning
  });

  test('Madrid, spring change on Sunday 2026-03-29: Monday 11:00 is CEST (09:00Z)', () => {
    const fri0900 = Date.UTC(2026, 2, 27, 8, 0); // 09:00 CET
    const monMid = Date.UTC(2026, 2, 30, 9, 0); // 11:00 CEST
    expect(cap([ana], MADRID, fri0900, monMid)).toBe(4);
    expect(cap([ana], MADRID, fri0900, monMid + MIN)).toBe(6);
  });

  test('a week with the autumn change in it still has 10 slots', () => {
    const mon0900 = Date.UTC(2026, 9, 19, 7, 0); // 09:00 CEST
    const fri1800 = Date.UTC(2026, 9, 23, 16, 0);
    expect(cap([ana], MADRID, mon0900, fri1800)).toBe(20);
    const nextFri1800 = Date.UTC(2026, 9, 30, 17, 0); // CET
    expect(cap([ana], MADRID, mon0900, nextFri1800)).toBe(40);
  });

  test('Kolkata (UTC+5:30): the 11:00 midpoint is 05:30Z', () => {
    const mid = Date.UTC(2026, 10, 16, 5, 30);
    expect(cap([ana], 'Asia/Kolkata', mid, mid + MIN)).toBe(2);
    expect(cap([ana], 'Asia/Kolkata', mid + MIN, mid + 2 * MIN)).toBe(0);
  });

  test('New York after the autumn change (EST, UTC-5): 11:00 is 16:00Z', () => {
    const mid = Date.UTC(2026, 10, 2, 16, 0);
    expect(cap([ana], 'America/New_York', mid, mid + MIN)).toBe(2);
    expect(cap([ana], 'America/New_York', mid + MIN, mid + 2 * MIN)).toBe(0);
  });

  test('the same instants give different capacities in different zones', () => {
    const from = Date.UTC(2026, 10, 16, 12, 0);
    const to = Date.UTC(2026, 10, 16, 18, 0);
    expect(cap([ana], 'UTC', from, to)).toBe(2); // 16:00 UTC
    expect(cap([ana], 'Asia/Kolkata', from, to)).toBe(0); // 11:00 and 16:00 IST were at 05:30Z and 10:30Z
    expect(cap([ana], MADRID, from, to)).toBe(2); // 16:00 CET is 15:00Z
  });
});

describe('capacityBetween (errors)', () => {
  test('unknown time zone', () => {
    expect(capacityBetween([ana], 'Mars/Olympus', MON_0900, FRI_1800)).toEqual({
      ok: false,
      error: { code: 'invalid-time-zone', value: 'Mars/Olympus' },
    });
  });

  test('non-integer instants', () => {
    const r = capacityBetween([ana], MADRID, MON_0900 + 0.5, FRI_1800);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-integer');
    expect(capacityBetween([ana], MADRID, MON_0900, Number.NaN).ok).toBe(false);
  });

  test('range longer than 366 days', () => {
    const r = capacityBetween([ana], MADRID, MON_0900, MON_0900 + 400 * 24 * HOUR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('range-too-long');
  });

  test('a range of exactly 366 days is allowed', () => {
    const start = Date.UTC(2026, 0, 1, 0, 0);
    expect(capacityBetween([ana], 'UTC', start, start + 366 * 24 * HOUR).ok).toBe(true);
  });
});

describe('effectiveCapacity', () => {
  test('floor(capacity x (100 - margin) / 100)', () => {
    expect(effectiveCapacity(41, 0)).toEqual({ ok: true, value: 41 });
    expect(effectiveCapacity(41, 15)).toEqual({ ok: true, value: 34 }); // 34.85
    expect(effectiveCapacity(59, 30)).toEqual({ ok: true, value: 41 }); // 41.3
    expect(effectiveCapacity(0, 30)).toEqual({ ok: true, value: 0 });
    expect(effectiveCapacity(1, 5)).toEqual({ ok: true, value: 0 });
  });

  test('only 0, 5, ..., 30 are accepted', () => {
    for (const bad of [-5, 1, 7, 35, 100, 2.5, Number.NaN]) {
      const r = effectiveCapacity(10, bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('margin-invalid');
    }
  });

  test('a non-integer or negative capacity is refused', () => {
    expect(effectiveCapacity(1.5, 0).ok).toBe(false);
    expect(effectiveCapacity(-1, 0).ok).toBe(false);
  });
});

describe('capacity properties', () => {
  test('P14 slots: capacity of an interval is the sum of the two parts at any split point', () => {
    fc.assert(
      fc.property(arbCapacityCase, ({ window, people, instants }) => {
        const [t0, t1, t2, t3] = instants;
        for (const [from, split, to] of [
          [t0, t1, t3],
          [t0, t2, t3],
          [t0, t0, t3],
          [t0, t3, t3],
          [t1, t2, t3],
        ] as const) {
          expect(cap(people, window.timeZone, from, to)).toBe(
            cap(people, window.timeZone, from, split) + cap(people, window.timeZone, split, to),
          );
        }
      }),
      { numRuns: 500 },
    );
  });

  test('P11 capacity never grows: later now, earlier freeze, fewer people, more absences', () => {
    fc.assert(
      fc.property(
        arbCapacityCase.chain((c) => fc.tuple(fc.constant(c), fc.nat(), arbAbsences(c.window))),
        ([{ window, people, instants }, pick, extra]) => {
          const [t0, t1, t2, t3] = instants;
          const zone = window.timeZone;
          const base = cap(people, zone, t0, t3);

          // Moving `now` later.
          expect(cap(people, zone, t1, t3)).toBeLessThanOrEqual(base);
          expect(cap(people, zone, t2, t3)).toBeLessThanOrEqual(cap(people, zone, t1, t3));
          // Moving the freeze earlier.
          expect(cap(people, zone, t0, t2)).toBeLessThanOrEqual(base);
          expect(cap(people, zone, t0, t1)).toBeLessThanOrEqual(cap(people, zone, t0, t2));

          if (people.length > 0) {
            // Removing one person.
            const at = pick % people.length;
            expect(cap(people.filter((_, i) => i !== at), zone, t0, t3)).toBeLessThanOrEqual(base);

            // Adding absences to one person.
            const target = people[at] as Person;
            const more: Person[] = people.map((p, i) => (i === at ? { ...p, daysOff: [...target.daysOff, ...extra] } : p));
            expect(cap(more, zone, t0, t3)).toBeLessThanOrEqual(base);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  test('capacity is a non-negative integer and does not depend on the order of people', () => {
    fc.assert(
      fc.property(arbCapacityCase, ({ window, people, instants }) => {
        const c = cap(people, window.timeZone, instants[0], instants[3]);
        expect(Number.isSafeInteger(c) && c >= 0).toBe(true);
        expect(cap([...people].reverse(), window.timeZone, instants[0], instants[3])).toBe(c);
      }),
      { numRuns: 200 },
    );
  });
});
