import { describe, expect, test } from 'vitest';
import { capacityBetween } from '../../src/engine/index';
import { CANDLE_STEPS, LAST_CANDLE_STEP } from '../../src/ui/candle-steps';
import { SAMPLE_FREEZE_AT, SAMPLE_NOW, sampleBoard } from '../../src/ui/sample-board';

/** "Mon 13:00": weekday and time in Europe/Madrid, formatted by the platform (not by the table's author). */
function madridLabel(instant: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('weekday')} ${pick('hour')}:${pick('minute')}`;
}

describe('candle steps', () => {
  test('there are eleven steps, and the last one is Friday 18:00', () => {
    expect(CANDLE_STEPS).toHaveLength(11);
    expect(LAST_CANDLE_STEP).toBe(10);
    expect(CANDLE_STEPS[LAST_CANDLE_STEP]?.label).toBe('Fri 18:00');
  });

  test('step 0 is now', () => {
    expect(CANDLE_STEPS[0]?.freezeAt).toBe(SAMPLE_NOW);
  });

  test('every label is the Madrid local time of its instant', () => {
    for (const step of CANDLE_STEPS) expect(madridLabel(step.freezeAt)).toBe(step.label);
  });

  test('instants strictly increase, every step is the end of a half day (13:00 or 18:00) after step 0', () => {
    for (let i = 1; i < CANDLE_STEPS.length; i++) {
      expect(CANDLE_STEPS[i]!.freezeAt).toBeGreaterThan(CANDLE_STEPS[i - 1]!.freezeAt);
      expect(CANDLE_STEPS[i]!.label).toMatch(/(13|18):00$/);
    }
  });

  test('instants are whole minutes and integers', () => {
    for (const step of CANDLE_STEPS) {
      expect(Number.isSafeInteger(step.freezeAt)).toBe(true);
      expect(step.freezeAt % 60_000).toBe(0);
    }
  });

  test('the capacity at each step does not decrease, and matches the numbers of the design', () => {
    const board = sampleBoard();
    const capacities = CANDLE_STEPS.map((step) => {
      const r = capacityBetween(board.people, board.timeZone, SAMPLE_NOW, step.freezeAt);
      if (!r.ok) throw new Error(`capacity error: ${r.error.code}`);
      return r.value;
    });
    expect(capacities).toEqual([0, 6, 12, 18, 24, 30, 35, 41, 47, 53, 59]);
    for (let i = 1; i < capacities.length; i++) expect(capacities[i]!).toBeGreaterThanOrEqual(capacities[i - 1]!);
  });

  test('the five days are Monday to Friday and each day has a 13:00 and an 18:00 step', () => {
    const days = CANDLE_STEPS.slice(1).map((s) => s.label.slice(0, 3));
    expect(days).toEqual(['Mon', 'Mon', 'Tue', 'Tue', 'Wed', 'Wed', 'Thu', 'Thu', 'Fri', 'Fri']);
  });
});

test('the engine sample freeze (used by the MCP server) is the last candle step, Friday 18:00 in Madrid', () => {
  expect(SAMPLE_FREEZE_AT).toBe(CANDLE_STEPS[LAST_CANDLE_STEP]?.freezeAt);
  expect(CANDLE_STEPS[LAST_CANDLE_STEP]?.label).toBe('Fri 18:00');
});
