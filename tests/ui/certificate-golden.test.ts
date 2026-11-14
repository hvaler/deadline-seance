import { describe, expect, test } from 'vitest';
import { deathCertificate, guardCertificate, nightFacts } from '../../src/engine/index';
import type { NightFacts } from '../../src/engine/index';
import { nightInputOf } from '../../src/ui/night';
import { SAMPLE_RELEASE } from '../../src/ui/sample-board';
import type { AppState } from '../../src/ui/state';
import { formulaText } from '../../src/ui/text';
import { codParts } from '../../src/engine/index';
import { statesAfter } from './arbitraries';

// Two real certificates of the sample board, kept in `docs/examples/` and compared by file snapshot, so a change in a number, a word or the order is
// a visible change. To regenerate them after a change on purpose: `npx vitest run tests/ui/certificate-golden.test.ts -u`.

function factsOf(state: AppState): NightFacts {
  const r = nightFacts(nightInputOf(state, SAMPLE_RELEASE));
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

const friday = statesAfter([]).at(-1) as AppState;
/** The state the tour leaves after "Someone insists": Wed 18:00, Ana away, HB-112 put down, HB-108 exhumed. */
const tour = statesAfter([
  { type: 'board/reset' },
  { type: 'candle/set', step: 6 },
  { type: 'survivor/toggle', name: 'Ana' },
  { type: 'tombstone/put-down', key: 'HB-112' },
  { type: 'tombstone/exhume', key: 'HB-108' },
]).at(-1) as AppState;

describe('docs/examples', () => {
  test('the sample board at Friday 18:00', async () => {
    await expect(deathCertificate(factsOf(friday))).toMatchFileSnapshot('../../docs/examples/death-certificate-friday.md');
  });

  test('the sample board after the tour\'s actions: every section is filled', async () => {
    await expect(deathCertificate(factsOf(tour))).toMatchFileSnapshot('../../docs/examples/death-certificate-tour.md');
  });

  test('both pass the guard and say nothing that promises more reserve is safer', () => {
    for (const state of [friday, tour]) {
      const facts = factsOf(state);
      expect(guardCertificate(facts)).toEqual({ ok: true, offending: [] });
      expect(deathCertificate(facts)).not.toMatch(/\b(safe|safer|safest|better|best|guarantee\w*|always|never|improves?|raises?)\b/i);
    }
  });

  test('the facts of the Friday note are the ones the app shows (checked by hand against the engine)', () => {
    const f = factsOf(friday);
    expect(f.status === 'ok' && { kept: f.kept, outside: f.outsideTotals, fog: [f.fog.holds, f.fog.nights, f.fog.pct] }).toEqual({
      kept: { count: 12, effort: 59, cod: 167 },
      outside: { count: 7, effort: 129, cod: 101, waitingCost: 202 },
      fog: [0, 1000, 0],
    });
    expect(f.status === 'ok' && f.outside.map((o) => [o.key, o.cod, o.waitingCost])).toEqual([
      ['HB-119', 21, 42],
      ['HB-112', 16, 32],
      ['HB-117', 16, 32],
      ['HB-111', 14, 28],
      ['HB-110', 13, 26],
      ['HB-114', 11, 22],
      ['HB-108', 10, 20],
    ]);
    expect(f.status === 'ok' && f.outside.filter((o) => o.isZombie).map((o) => [o.key, o.costParts.effectiveUrgency, o.nextUrgency])).toEqual([
      ['HB-112', 8, 13],
      ['HB-110', 5, 8],
    ]);
  });

  test('the facts of the tour note: HB-108 pushes out HB-105 and HB-109, HB-114 cannot ship, Ana is away', () => {
    const f = factsOf(tour);
    if (f.status !== 'ok') throw new Error('impossible');
    expect(f.kept).toEqual({ count: 4, effort: 23, cod: 63 });
    expect(f.putDown).toEqual([{ key: 'HB-112', title: 'Multi-currency wallet', blocks: ['HB-114'] }]);
    expect(f.away).toEqual(['Ana']);
    expect(f.exhumed).toEqual([
      {
        key: 'HB-108',
        title: 'Transaction search',
        effort: 8,
        cod: 10,
        pushedOut: [
          { key: 'HB-105', cod: 11, together: false, with: [] },
          { key: 'HB-109', cod: 15, together: false, with: [] },
        ],
      },
    ]);
    expect([f.fog.holds, f.fog.pct]).toEqual([29, 2]);
  });

  test('the cost-of-delay wording is the one the screen uses, ticket by ticket', () => {
    const f = factsOf(friday);
    if (f.status !== 'ok') throw new Error('impossible');
    const md = deathCertificate(f);
    for (const o of f.outside) {
      const ticket = friday.board.tickets.find((t) => t.key === o.key)!;
      expect(md).toContain(`| ${formulaText(codParts(ticket))} |`);
    }
  });
});
