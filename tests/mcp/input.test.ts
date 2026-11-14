import { describe, expect, test } from 'vitest';
import { parseInstant } from '../../mcp/time';
import { solveFreezeTool } from '../../mcp/solve-freeze';
import { SAMPLE_REQUEST, answer, failures } from './helpers';

const value = (v: unknown) => {
  const r = parseInstant('now', v);
  return r.ok ? r.value : r.errors[0]?.code;
};

describe('MCP: time inputs', () => {
  test('ISO 8601 with Z or an offset, with or without seconds and milliseconds, and epoch milliseconds', () => {
    const expected = Date.UTC(2026, 10, 20, 17, 0);
    expect(value('2026-11-20T18:00+01:00')).toBe(expected);
    expect(value('2026-11-20T18:00:00+01:00')).toBe(expected);
    expect(value('2026-11-20T17:00:00Z')).toBe(expected);
    expect(value('2026-11-20T17:00:00.5Z')).toBe(expected + 500);
    expect(value('2026-11-20T23:30:00-05:30')).toBe(expected + 12 * 3_600_000 + 0);
    expect(value(expected)).toBe(expected);
    expect(value(0)).toBe(0);
  });

  test('a time with no zone, an impossible date, a bad offset, a fraction or the wrong type is bad-time', () => {
    for (const bad of ['2026-11-20T18:00', '2026-11-20', '2026-02-30T10:00:00Z', '2026-13-01T10:00:00Z', '2026-11-20T24:00:00Z', '2026-11-20T18:00:00+24:00', '2026-11-20T18:00:00+01:60', 'tomorrow', '', 1.5, Number.NaN, 8.64e15 + 2, null, {}, true]) {
      expect(value(bad), String(bad)).toBe('bad-time');
    }
  });

  test('a leap day is real in a leap year and not otherwise', () => {
    expect(value('2028-02-29T00:00:00Z')).toBe(Date.UTC(2028, 1, 29));
    expect(value('2026-02-29T00:00:00Z')).toBe('bad-time');
  });

  test('the sentence for a missing zone says what to add and quotes the value', () => {
    const r = parseInstant('freezeAt', '2026-11-20T18:00');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0]?.message).toContain('add Z or an offset');
      expect(r.errors[0]?.message).toContain('2026-11-20T18:00');
    }
  });

  test('freezeAt before now is bad-time; csv and json need both times', () => {
    const e = failures(solveFreezeTool({ ...SAMPLE_REQUEST, now: '2026-11-20T18:00:00+01:00', freezeAt: '2026-11-16T09:00:00+01:00' }));
    expect(e.map((x) => x.code)).toEqual(['bad-time']);
    const missing = failures(solveFreezeTool({ board: { source: 'json', board: { tickets: [], people: [] } } }));
    expect(missing.map((x) => x.code)).toEqual(['bad-time', 'bad-time']);
  });
});

describe('MCP: margin and people', () => {
  test('a margin the engine refuses is margin-invalid with the value', () => {
    for (const marginPct of [7, -5, 35, 2.5]) {
      const e = failures(solveFreezeTool({ ...SAMPLE_REQUEST, marginPct }));
      expect(e.map((x) => x.code), String(marginPct)).toEqual(['margin-invalid']);
    }
    expect(answer(solveFreezeTool({ ...SAMPLE_REQUEST, marginPct: 30 })).structured.marginPct).toBe(30);
  });

  test('an unknown person is unknown-person and lists the team', () => {
    const [e] = failures(solveFreezeTool({ ...SAMPLE_REQUEST, away: [{ person: 'Zoe' }] }));
    expect(e?.code).toBe('unknown-person');
    expect(e?.message).toBe('Zoe is not on the team. The team is Ana, Bruno, Carla and Dev.');
  });

  test('a part without a date is a bad-request; a bad date is the engine\'s invalid-absence', () => {
    expect(failures(solveFreezeTool({ ...SAMPLE_REQUEST, away: [{ person: 'Ana', part: 'morning' }] })).map((x) => x.code)).toEqual(['bad-request']);
    expect(failures(solveFreezeTool({ ...SAMPLE_REQUEST, away: [{ person: 'Ana', date: '2026-13-45' }] })).map((x) => x.code)).toEqual(['invalid-absence']);
  });

  test('a morning absence takes one half-day; a full day takes two', () => {
    const base = answer(solveFreezeTool(SAMPLE_REQUEST)).structured.capacity;
    const morning = answer(solveFreezeTool({ ...SAMPLE_REQUEST, away: [{ person: 'Ana', date: '2026-11-20', part: 'morning' }] })).structured.capacity;
    const full = answer(solveFreezeTool({ ...SAMPLE_REQUEST, away: [{ person: 'Ana', date: '2026-11-20' }] })).structured.capacity;
    expect(base - morning).toBe(2);
    expect(base - full).toBe(4);
  });
});
