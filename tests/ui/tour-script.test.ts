import { describe, expect, test } from 'vitest';
import { initialState } from '../../src/ui/state';
import { INSISTED, ZOMBIE, sampleScript } from '../../src/ui/tour/sample-script';
import { renderTourScript } from '../../src/ui/tour/doc';
import { simulateTour, totalMs } from '../../src/ui/tour/simulate';
import { unexplained } from './provenance';

// The sample board's tour, run through the reducer with no page. What it says must be true, short enough to read while watching the screen,
// and made of numbers the engine returned.

const sim = simulateTour(sampleScript, initialState());
const seconds = (ms: number): number => ms / 1000;

describe('the script of the sample board', () => {
  test('has unique scene ids and at least the scenes of the story', () => {
    const ids = sampleScript.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['baseline', 'candle-burns', 'someone-away', 'zombie', 'put-down', 'someone-insists', 'fog-zero', 'fog-10', 'fog-15', 'fog-20', 'message', 'close']);
  });

  test('every action of every scene is accepted by the engine on the sample board', () => {
    expect(sim.filter((s) => !s.accepted).map((s) => s.scene.id)).toEqual([]);
  });

  test('every scene names where to look and has a whole number of milliseconds', () => {
    for (const s of sampleScript) {
      expect(Number.isInteger(s.durationMs), s.id).toBe(true);
      expect(s.durationMs, s.id).toBeGreaterThan(0);
      expect(['top', 'sign', 'fog', 'candle', 'survivors', 'safehouse', 'yard'], s.id).toContain(s.show);
    }
  });
});

describe('time', () => {
  test('the tour takes at most 60 seconds', () => {
    expect(totalMs(sampleScript)).toBeLessThanOrEqual(60_000);
    expect(seconds(totalMs(sampleScript))).toBe(57);
  });

  test('scenes follow each other with no gap, from 0 to the total', () => {
    expect(sim[0]?.startMs).toBe(0);
    for (let i = 1; i < sim.length; i++) expect(sim[i]?.startMs).toBe(sim[i - 1]?.endMs);
    expect(sim.at(-1)?.endMs).toBe(totalMs(sampleScript));
  });

  test('every subtitle can be read in its time while watching the screen: at most 15 characters per second', () => {
    for (const s of sim) {
      const cps = s.caption.length / seconds(s.scene.durationMs);
      expect(cps, `${s.scene.id}: ${s.caption.length} characters in ${seconds(s.scene.durationMs)} s`).toBeLessThanOrEqual(15);
    }
  });
});

describe('what it says', () => {
  test('every subtitle is one sentence', () => {
    for (const s of sim) {
      expect(s.caption.trim(), s.scene.id).toBe(s.caption);
      expect(s.caption.endsWith('.'), s.scene.id).toBe(true);
      expect(s.caption.match(/[.!?](\s|$)/g)?.length, `${s.scene.id}: ${s.caption}`).toBe(1);
    }
  });

  test('every integer in every subtitle is a number the engine returned in the facts it was built from ("1,000" is 1000)', () => {
    for (const s of sim) {
      expect(unexplained(s.caption, s.facts.first, s.facts.before, s.facts.after), `${s.scene.id}: ${s.caption}`).toEqual([]);
    }
  });

  test('no subtitle promises that more reserve helps, ranks, or decides for the user', () => {
    const promise =
      /\b(safe|safer|safest|risky|good|bad|better|best|worse|worst|recommend\w*|guarantee\w*|always|raises?|improves?|increases?|boosts?|highest|lowest|ideal|optimal|sweet spot|(more|bigger|larger|higher) (reserve|margin|buffer))\b/i;
    const decides = /\b(you (must|should|need to)|the best|do this|should)\b/i;
    for (const s of sim) {
      expect(s.caption, s.scene.id).not.toMatch(promise);
      expect(s.caption, s.scene.id).not.toMatch(decides);
    }
  });

  test('the message "you have to cut more than the arithmetic says" is true on the board: filling the capacity holds on fewer nights than the reserve the fog scenes ended on', () => {
    const message = sim.find((s) => s.scene.id === 'message')!;
    const fog = message.facts.after.view.fog!;
    const first = fog.points[0]!;
    const last = fog.points[fog.currentIndex ?? -1]!;
    expect(first.status === 'ok' && last.status === 'ok').toBe(true);
    if (first.status === 'ok' && last.status === 'ok') {
      expect(first.fog.holds).toBe(0);
      expect(last.fog.holds).toBeGreaterThan(first.fog.holds);
    }
  });

  test('every key a subtitle names is a ticket of the board, and the keys of the actions are the constants of the script', () => {
    const board = sim[0]!.facts.first.state.home.tickets.map((t) => t.key);
    for (const s of sim) for (const key of s.caption.match(/HB-\d+/g) ?? []) expect(board, `${s.scene.id}: ${key}`).toContain(key);
    const actionKeys = sampleScript.flatMap((s) => s.actions).flatMap((a) => ('key' in a ? [a.key] : []));
    expect(actionKeys).toEqual([ZOMBIE, INSISTED]);
  });

  test('the subtitles are always the same for the same night (the script is deterministic)', () => {
    const again = simulateTour(sampleScript, initialState());
    expect(again.map((s) => s.caption)).toEqual(sim.map((s) => s.caption));
  });

  test('the real subtitles, scene by scene', () => {
    expect(sim.map((s) => s.caption)).toEqual([
      'Mon 09:00, freeze Fri 18:00: 59 points, and 7 tickets stay outside.',
      'The candle burns down to Wed 18:00: 35 points, and saved cost of delay falls from 167 to 113.',
      'Ana is away: 23 points left, and saved cost of delay falls to 79.',
      'HB-112, left out 3 releases, climbs from urgency 8 to 13.',
      'Put down: HB-114 can never ship, and the yard has 13 tickets left.',
      'Someone insists on HB-108: it comes in, and saved cost of delay falls to 63.',
      '0 % reserve: the cut holds on 0 of 1,000 nights.',
      '10 % reserve: it holds on 134 of 1,000 nights.',
      '15 % reserve: it holds on 347 of 1,000 nights.',
      '20 % reserve: it holds on 707 of 1,000 nights.',
      'You have to cut more than the arithmetic says.',
      'The rule decides, not the loudest voice: now play your own night.',
    ]);
  });
});

describe('the state the story leaves behind', () => {
  test('after each scene the app is where the story says it is', () => {
    const after = (id: string) => sim.find((s) => s.scene.id === id)!.facts.after.state;
    expect(after('baseline')).toMatchObject({ candle: 10, marginPct: 0, away: [] });
    expect(after('candle-burns')).toMatchObject({ candle: 6 });
    expect(after('someone-away')).toMatchObject({ candle: 6, away: ['Ana'] });
    expect(after('put-down').board.wontDo).toEqual([ZOMBIE]);
    expect(after('someone-insists').board.tickets.find((t) => t.key === INSISTED)?.mustHave).toBe(true);
    expect(after('fog-zero')).toMatchObject({ candle: 10, marginPct: 0, away: [] });
    expect(after('fog-zero').board.wontDo).toEqual([]);
    expect([10, 15, 20].map((pct) => after(`fog-${pct}`).marginPct)).toEqual([10, 15, 20]);
    expect(after('close').marginPct).toBe(20);
  });
});

describe('docs/video-tour-script.md', () => {
  test('is the script as the app plays it: this test fails when the file and the app disagree (regenerate with -u)', async () => {
    await expect(renderTourScript(sim)).toMatchFileSnapshot('../../docs/video-tour-script.md');
  });

  test('says each subtitle, its seconds and the real fog numbers', () => {
    const doc = renderTourScript(sim);
    for (const s of sim) expect(doc).toContain(s.caption);
    expect(doc).toContain('| 0 % | 12 | 59 of 59 | 0 of 1,000 | 0 % |');
    expect(doc).toContain('| 5 % | 11 | 56 of 59 | 6 of 1,000 | 0 % |');
    expect(doc).toContain('| 20 % | 10 | 46 of 59 | 707 of 1,000 | 70 % |');
    expect(doc).toContain('57.0 seconds');
  });
});