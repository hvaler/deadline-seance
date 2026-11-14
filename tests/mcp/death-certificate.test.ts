import { describe, expect, test } from 'vitest';
import { deathCertificate, exhume, guardCertificate, nightFacts, putDown, SAMPLE_RELEASE } from '../../src/engine/index';
import { deathCertificateTool } from '../../mcp/certificate';
import { initialState } from '../../src/ui/model';
import { nightInputOf } from '../../src/ui/night';
import { GOLDEN, SAMPLE, SAMPLE_REQUEST, answer, failures } from './helpers';

describe('MCP: death_certificate', () => {
  test('the sample night: the markdown is the engine\'s note and the guard says ok', () => {
    const { structured, text } = answer(deathCertificateTool(SAMPLE_REQUEST));
    const facts = nightFacts({ home: SAMPLE, board: SAMPLE, freeze: GOLDEN, away: [], release: SAMPLE_RELEASE });
    if (!facts.ok) throw new Error('facts');
    expect(structured.markdown).toBe(deathCertificate(facts.value));
    expect(structured.guard).toEqual({ ok: guardCertificate(facts.value).ok, offending: [] });
    expect(structured.guard.ok).toBe(true);
    expect(text).toBe(structured.markdown);
    expect(structured.markdown).toContain(SAMPLE_RELEASE);
  });

  test('the markdown equals what the web app\'s certificate view is made from for the same state', () => {
    const web = nightFacts(nightInputOf(initialState()));
    if (!web.ok) throw new Error('facts');
    expect(answer(deathCertificateTool(SAMPLE_REQUEST)).structured.markdown).toBe(deathCertificate(web.value));
  });

  test('exhumed and put_down are applied first, in the order given', () => {
    const { structured } = answer(deathCertificateTool({ ...SAMPLE_REQUEST, exhumed: ['HB-117'], put_down: ['HB-110'] }));
    const ex = exhume(SAMPLE, GOLDEN, 'HB-117');
    if (!ex.ok || ex.value.kind !== 'applied') throw new Error('exhume');
    const pd = putDown(ex.value.board, GOLDEN, 'HB-110');
    if (!pd.ok) throw new Error('putDown');
    const facts = nightFacts({ home: SAMPLE, board: pd.value.board, freeze: GOLDEN, away: [], release: SAMPLE_RELEASE });
    if (!facts.ok) throw new Error('facts');
    expect(structured.markdown).toBe(deathCertificate(facts.value));
    expect(structured.markdown).toContain('HB-117');
    expect(structured.guard.ok).toBe(true);
  });

  test('a release name is used; people away appear in the note', () => {
    const { structured } = answer(deathCertificateTool({ ...SAMPLE_REQUEST, release: 'Night 7', away: [{ person: 'Carla' }] }));
    expect(structured.markdown).toContain('Night 7');
    expect(structured.markdown).toContain('Carla');
  });

  test('an exhume that makes the freeze impossible is a tool error with the numbers; a bad put-down names its code', () => {
    const e = failures(deathCertificateTool({ ...SAMPLE_REQUEST, exhumed: ['HB-119'] }));
    expect(e[0]?.code).toBe('solution-impossible');
    expect(e[0]?.message).toMatch(/would need \d+ points and the capacity is 59/);
    expect(failures(deathCertificateTool({ ...SAMPLE_REQUEST, put_down: ['HB-108'] })).map((x) => x.code)).toEqual(['not-a-zombie']);
  });

  test('an impossible night gives the short certificate, not an error', () => {
    const board = {
      tickets: [{ key: 'T-1', title: 'Big', effort: 99, cost: { kind: 'imported', cod: 9 }, mustHave: true }],
      people: [{ name: 'Ana', pointsPerHalfDay: 1, daysOff: [] }],
    };
    const { structured } = answer(
      deathCertificateTool({ board: { source: 'json', board }, now: '2026-11-16T09:00:00+01:00', freezeAt: '2026-11-16T18:00:00+01:00' }),
    );
    expect(structured.markdown).toContain('99');
    expect(structured.guard.ok).toBe(true);
  });
});
