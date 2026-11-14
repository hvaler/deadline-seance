import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { checkNumbers, guardFacts, nightFacts } from '../../src/engine/index';
import type { OutsideFact } from '../../src/engine/index';
import { derive } from '../../src/ui/derive';
import { nightInputOf } from '../../src/ui/night';
import type { AppState } from '../../src/ui/state';
import { reducer } from '../../src/ui/state';
import { epitaphFor } from '../../src/ui/text';
import { arbMeaningfulAction, statesAfter } from './arbitraries';

// P12: every epitaph the app shows says only numbers that are facts of its own ticket. The epitaph is a fixed template (`text.ts`); the guard is the
// same one the certificate passes (`src/engine/guard.ts`).

/** The keys an epitaph may name: the ticket itself and the tickets its reason names. */
function keysOf(entry: OutsideFact): string[] {
  const r = entry.reason;
  const named = r.kind === 'depends-on-buried' ? r.buriedDependencies : r.kind === 'blocked-by-put-down' ? [r.putDownKey] : r.kind === 'pushed-out-by-exhume' ? r.exhumed : [];
  return [entry.key, ...named];
}

/** The epitaphs of every tombstone of a state, each with the verdict of the guard against the facts of its own ticket. */
function verdicts(state: AppState): { key: string; epitaph: string; offending: string[] }[] {
  const facts = nightFacts(nightInputOf(state));
  if (!facts.ok || facts.value.status !== 'ok') return [];
  const outside = facts.value.outside;
  return derive(state).yard.map((tomb) => {
    const entry = outside.find((o) => o.key === tomb.key) as OutsideFact;
    const epitaph = epitaphFor(tomb);
    const result = checkNumbers(epitaph, guardFacts([entry], { keys: keysOf(entry) }));
    return { key: tomb.key, epitaph, offending: result.offending.map((o) => `${o.reason}:${o.text}`) };
  });
}

const run = (...actions: Parameters<typeof reducer>[1][]): AppState => statesAfter(actions).at(-1) as AppState;

describe('P12', () => {
  test('P12 every epitaph the app shows passes the guard against the facts of its ticket', () => {
    let epitaphs = 0;
    fc.assert(
      fc.property(fc.array(arbMeaningfulAction, { maxLength: 12 }), (actions) => {
        for (const state of statesAfter(actions)) {
          for (const v of verdicts(state)) {
            epitaphs++;
            expect(v.offending, `${v.key}: ${v.epitaph}`).toEqual([]);
          }
        }
      }),
      { numRuns: 120 },
    );
    expect(epitaphs).toBeGreaterThan(500);
  });

  test('the three templates, by example on the sample board', () => {
    const friday = verdicts(run());
    expect(friday.find((v) => v.key === 'HB-108')).toMatchObject({ epitaph: 'Here lies HB-108. It needed 8 points; the night had 0 left.', offending: [] });
    expect(friday.find((v) => v.key === 'HB-114')).toMatchObject({ epitaph: 'Here lies HB-114. It followed HB-112 into the ground.', offending: [] });
    const closed = verdicts(run({ type: 'tombstone/put-down', key: 'HB-112' }));
    expect(closed.find((v) => v.key === 'HB-114')).toMatchObject({ epitaph: "Here lies HB-114. HB-112 was closed as Won't Do, so it can never ship.", offending: [] });
  });

  test('the guard would reject an epitaph with a changed number or a wrong key', () => {
    const state = run();
    const facts = nightFacts(nightInputOf(state));
    if (!facts.ok || facts.value.status !== 'ok') throw new Error('no facts');
    const entry = facts.value.outside.find((o) => o.key === 'HB-108') as OutsideFact;
    const g = guardFacts([entry], { keys: keysOf(entry) });
    expect(checkNumbers('Here lies HB-108. It needed 9 points; the night had 0 left.', g).offending.map((o) => o.text)).toEqual(['9']);
    expect(checkNumbers('Here lies HB-109. It needed 8 points; the night had 0 left.', g).offending.map((o) => o.text)).toEqual(['HB-109']);
  });
});
