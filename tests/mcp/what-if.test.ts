import { describe, expect, test } from 'vitest';
import { diffSolutions, exhume, putDown, sampleBoard, simulateFog, solveFreeze } from '../../src/engine/index';
import { whatIfTool } from '../../mcp/what-if';
import { GOLDEN, SAMPLE, SAMPLE_REQUEST, SMALL_JSON, SMALL_TIMES, answer, failures, valid } from './helpers';

const solved = (board = SAMPLE, freeze = GOLDEN) => {
  const r = solveFreeze(board, freeze);
  if (!r.ok || r.value.status !== 'ok') throw new Error('solve');
  return r.value;
};

describe('MCP: what_if', () => {
  test('exhume HB-117 on the sample: the numbers are the engine\'s exhume', () => {
    const { structured } = answer(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'exhume', key: 'HB-117' } }));
    const direct = exhume(SAMPLE, GOLDEN, 'HB-117');
    if (!direct.ok || direct.value.kind !== 'applied') throw new Error('exhume');
    const o = direct.value;
    expect(structured.rejected).toBe(false);
    expect(structured.comes_in.map((r) => [r.key, r.cod])).toEqual(o.diff.raised.map((e) => [e.key, e.cod]));
    expect(structured.goes_out.map((r) => [r.key, r.cod])).toEqual(o.diff.sunk.map((e) => [e.key, e.cod]));
    expect(structured.cod_delta).toBe(o.diff.codDelta);
    expect(structured.before).toMatchObject({ status: 'ok', tickets: 12, points: 59, cod: 167 });
    expect(structured.after).toMatchObject({ status: 'ok', tickets: o.after.kept.length, points: o.after.keptEffort, cod: o.after.savedCod });
    const fog = simulateFog(o.board, o.after.kept, o.after.capacity);
    expect(fog.ok && structured.after.fog?.holds === fog.value.holds).toBe(true);
    expect(structured.comes_in.map((r) => r.key)).toEqual(['HB-117']);
  });

  test('an exhume the freeze cannot take is a result "rejected" with the numbers of the impossible freeze', () => {
    const { structured, text } = answer(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'exhume', key: 'HB-119' } }));
    const direct = exhume(SAMPLE, GOLDEN, 'HB-119');
    if (!direct.ok || direct.value.kind !== 'rejected') throw new Error('exhume must be rejected');
    expect(structured.rejected).toBe(true);
    expect(structured.after.status).toBe('impossible');
    expect(structured.after.needed).toBe(direct.value.impossible.needed);
    expect(structured.after.capacity).toBe(direct.value.impossible.capacity);
    expect(structured.cod_delta).toBeNull();
    expect(structured.comes_in).toEqual([]);
    expect(text).toContain(`need ${direct.value.impossible.needed} points`);
  });

  test('put_down of a zombie equals the engine\'s putDown; of anything else is not-a-zombie; an unknown key is unknown-key', () => {
    const { structured } = answer(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'put_down', key: 'HB-110' } }));
    const direct = putDown(SAMPLE, GOLDEN, 'HB-110');
    if (!direct.ok) throw new Error('putDown');
    expect(structured.cod_delta).toBe(direct.value.diff.codDelta);
    expect(structured.after.tickets).toBe(direct.value.after.kept.length);
    const notZombie = failures(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'put_down', key: 'HB-108' } }));
    expect(notZombie.map((e) => [e.code, e.subject])).toEqual([['not-a-zombie', 'HB-108']]);
    const unknown = failures(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'exhume', key: 'ZZ-1' } }));
    expect(unknown.map((e) => [e.code, e.subject])).toEqual([['unknown-key', 'ZZ-1']]);
  });

  test('"Ana away on Friday" equals a direct re-solve with that absence', () => {
    const { structured } = answer(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'away', person: 'Ana', date: '2026-11-20' } }));
    const sample = sampleBoard();
    const after = solved(valid({ ...sample, people: sample.people.map((p) => (p.name === 'Ana' ? { ...p, daysOff: [{ date: '2026-11-20', part: 'full' as const }] } : p)) }));
    const before = solved();
    const diff = diffSolutions(before, after);
    if (!diff.ok) throw new Error('diff');
    expect(structured.after.capacity).toBe(after.capacity);
    expect(structured.goes_out.map((r) => r.key)).toEqual(diff.value.sunk.map((e) => e.key));
    expect(structured.comes_in.map((r) => r.key)).toEqual(diff.value.raised.map((e) => e.key));
    expect(structured.cod_delta).toBe(diff.value.codDelta);
    expect(structured.goes_out.map((r) => r.key)).toEqual(['HB-115']);
  });

  test('away for the night then back is the same as no change; back without an away is a bad-request', () => {
    const body = { ...SAMPLE_REQUEST, away: [{ person: 'Bruno' }] };
    const { structured } = answer(whatIfTool({ ...body, change: { kind: 'back', person: 'Bruno' } }));
    expect(structured.before.status).toBe('ok');
    expect(structured.after.capacity).toBeGreaterThan(structured.before.capacity);
    const direct = answer(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'margin', marginPct: 0 } }));
    expect(structured.after).toEqual(direct.structured.after);
    const none = failures(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'back', person: 'Bruno' } }));
    expect(none.map((e) => e.code)).toEqual(['bad-request']);
  });

  test('move_freeze and margin equal a direct re-solve', () => {
    const moved = answer(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'move_freeze', freezeAt: '2026-11-19T18:00:00+01:00' } }));
    const direct = solved(SAMPLE, { ...GOLDEN, freezeAt: Date.UTC(2026, 10, 19, 17, 0) });
    expect(moved.structured.after).toMatchObject({ capacity: direct.capacity, tickets: direct.kept.length, cod: direct.savedCod });
    const margin = answer(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'margin', marginPct: 10 } }));
    const d2 = solved(SAMPLE, { ...GOLDEN, marginPct: 10 });
    expect(margin.structured.after).toMatchObject({ effectiveCapacity: d2.effectiveCapacity, tickets: d2.kept.length, points: d2.keptEffort, cod: d2.savedCod });
  });

  test('a change that makes the freeze impossible says so with the numbers', () => {
    const board = {
      ...SMALL_JSON,
      tickets: [{ key: 'T-1', title: 'Big', effort: 4, cost: { kind: 'imported', cod: 9 }, mustHave: true }],
    };
    const { structured, text } = answer(
      whatIfTool({ board: { source: 'json', board }, ...SMALL_TIMES, freezeAt: '2026-11-16T18:00:00+01:00', change: { kind: 'away', person: 'Ana' } }),
    );
    expect(structured.rejected).toBe(true);
    expect(structured.after).toMatchObject({ status: 'impossible', needed: 4, capacity: 0 });
    expect(text).toContain('impossible');
  });

  test('a change that changes nothing returns empty lists and a delta of 0', () => {
    const { structured } = answer(whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'move_freeze', freezeAt: GOLDEN.freezeAt } }));
    expect(structured.comes_in).toEqual([]);
    expect(structured.goes_out).toEqual([]);
    expect(structured.cod_delta).toBe(0);
    expect(structured.after).toEqual(structured.before);
  });

  test('two identical calls give identical answers', () => {
    const call = () => whatIfTool({ ...SAMPLE_REQUEST, change: { kind: 'exhume', key: 'HB-117' } });
    expect(call()).toEqual(call());
  });
});
