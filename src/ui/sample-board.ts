import type { Board, Cost, Ticket } from '../engine/index';

/**
 * The built-in board: "Hollow Bank app 3.2", a fictional banking app on its release eve.
 *
 * `now` is a constant, never the system clock: Monday 2026-11-16, 09:00 in Europe/Madrid (CET, UTC+1).
 */
export const SAMPLE_NOW = Date.UTC(2026, 10, 16, 8, 0);

/** What the release is called, for the death certificate (the engine's board has no name). */
export const SAMPLE_RELEASE = 'Hollow Bank app 3.2';

export const PRODUCT_LINE = 'Hollow Bank app 3.2 · release eve';

/** Cost of delay from its three parts, each on the scale 1, 2, 3, 5, 8, 13, 20. */
function formula(value: number, urgency: number, risk: number): Cost {
  return { kind: 'formula', value, urgency, risk };
}

function ticket(
  key: string,
  title: string,
  effort: number,
  cost: Cost,
  extra: { mustHave?: true; dependsOn?: readonly string[]; past?: number } = {},
): Ticket {
  return {
    key,
    title,
    effort,
    cost,
    mustHave: extra.mustHave === true,
    dependsOn: extra.dependsOn ?? [],
    past: extra.past ?? 0,
  };
}

/** A fresh copy every call, so nothing can change the sample by accident. */
export function sampleBoard(): Board {
  return {
    tickets: [
      ticket('HB-101', 'Fix stale balance after a transfer', 5, formula(8, 5, 5), { mustHave: true }),
      ticket('HB-102', 'Strong-auth callback (PSD2)', 8, formula(8, 13, 8), { mustHave: true }),
      ticket('HB-103', 'Store listing and release notes', 2, formula(2, 3, 1), { mustHave: true }),
      ticket('HB-104', 'Biometric login fallback', 5, formula(5, 3, 3)),
      // Hungry: left out for 3 releases, urgency 1 climbs to 5 (cod 7 becomes 11).
      ticket('HB-105', 'Dark-mode statement PDF', 3, formula(3, 1, 3), { past: 3 }),
      ticket('HB-106', 'Card freeze toggle', 5, formula(8, 5, 3), { dependsOn: ['HB-104'] }),
      ticket('HB-107', 'Card freeze push alerts', 3, formula(5, 3, 3), { dependsOn: ['HB-106'] }),
      ticket('HB-108', 'Transaction search', 8, formula(5, 2, 3)),
      ticket('HB-109', 'Instant-transfer limits screen', 5, formula(5, 5, 5), { dependsOn: ['HB-102'] }),
      // A zombie when buried: left out for 2 releases, so 2 + 1 reaches the threshold of 3.
      ticket('HB-110', 'Spending insights widget', 13, formula(5, 2, 3), { past: 2 }),
      ticket('HB-111', 'Savings goals', 13, { kind: 'imported', cod: 14 }),
      ticket('HB-112', 'Multi-currency wallet', 21, formula(5, 2, 3), { past: 3 }),
      // Hungry: urgency 3 climbs to 8 (cod 9 becomes 14).
      ticket('HB-113', 'Accessibility audit fixes', 5, formula(3, 3, 3), { past: 2 }),
      ticket('HB-114', 'FX rate alerts', 5, formula(5, 3, 3), { dependsOn: ['HB-112'] }),
      ticket('HB-115', 'Phone wallet pass', 8, formula(5, 3, 5)),
      ticket('HB-116', 'Balance home-screen widget', 2, formula(3, 2, 2)),
      ticket('HB-117', 'Onboarding rewrite', 21, formula(8, 3, 5), { dependsOn: ['HB-104'] }),
      ticket('HB-118', 'Referral programme', 8, formula(5, 1, 3), { past: 4 }),
      // Too big to bring back: with the must-haves it needs more than the whole week.
      ticket('HB-119', 'Core ledger migration', 48, formula(8, 5, 8)),
    ],
    people: [
      { name: 'Ana', pointsPerHalfDay: 2, daysOff: [] },
      { name: 'Bruno', pointsPerHalfDay: 2, daysOff: [] },
      { name: 'Carla', pointsPerHalfDay: 1, daysOff: [] },
      { name: 'Dev', pointsPerHalfDay: 1, daysOff: [{ date: '2026-11-18', part: 'afternoon' }] },
    ],
    timeZone: 'Europe/Madrid',
    nextReleaseWeeks: 2,
    zombieThreshold: 3,
    wontDo: [],
    // Fixed before any chance was looked at (the date of `now`) and never changed to make a number look better.
    fogSeed: 20261116,
  };
}
