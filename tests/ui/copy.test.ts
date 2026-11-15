// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { deathCertificate, nightFacts } from '../../src/engine/index';
import { nightInputOf } from '../../src/ui/night';
import { sampleScript } from '../../src/ui/tour/sample-script';
import { simulateTour } from '../../src/ui/tour/simulate';
import { destroyMounted, drag, mountWith, region, release } from './harness';
import { byFocus } from './harness';
// "cod" is jargon: the full term is written in every sentence, and the short form is kept only in the two totals lines, with the full term in a title.
afterEach(() => {
  destroyMounted();
  document.body.replaceChildren();
});
const SHORT = /\bcod\b/i;
describe('the words "cost of delay"', () => {
  test('no sentence on the page uses the short form, except the totals of the safehouse and the yard, which explain it in a title', () => {
    const h = mountWith();
    const candle = h.root.querySelector<HTMLInputElement>('#candle-input')!;
    drag(candle, 6);
    h.frame.flush();
    release(candle);
    byFocus(h.root, 'survivor:Ana').click();
    byFocus(h.root, 'exhume:HB-108').click();
    byFocus(h.root, 'undo').click();
    h.frame.flush();
    const offenders: string[] = [];
    for (const node of h.root.querySelectorAll<HTMLElement>('main *, [data-region="announcer"], [data-region="alerter"]')) {
      if (node.closest('[data-region$="-summary"]') !== null) continue;
      const own = [...node.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent ?? '').join('');
      if (SHORT.test(own) || SHORT.test(node.getAttribute('title') ?? '') && !node.matches('[data-region$="-summary"]')) offenders.push(own.trim());
    }
    expect(offenders).toEqual([]);
    for (const name of ['safehouse-summary', 'yard-summary']) {
      const summary = region(h.root, name);
      expect(summary.textContent).toMatch(SHORT);
      expect(summary.getAttribute('title')).toContain('cost of delay');
    }
  });
  test('the chronicle help, the verdict sentences and the change note say it in full', () => {
    const h = mountWith();
    expect(region(h.root, 'chronicle').textContent).toContain('the change in saved cost of delay.');
    expect(region(h.root, 'sign').textContent).toContain('saved cost of delay 167');
    byFocus(h.root, 'survivor:Ana').click();
    expect(region(h.root, 'change').textContent).toContain('Saved cost of delay');
  });
  test('the tour\'s subtitles and the certificate do not use the short form either', () => {
    const h = mountWith();
    for (const scene of simulateTour(sampleScript, h.app.store.getState())) expect(scene.caption, scene.scene.id).not.toMatch(SHORT);
    const facts = nightFacts(nightInputOf(h.app.store.getState()));
    if (!facts.ok) throw new Error('facts');
    expect(deathCertificate(facts.value)).not.toMatch(SHORT);
  });
});
