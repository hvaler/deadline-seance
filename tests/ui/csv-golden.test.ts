// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { ACCEPTED_HEADERS, CSV_LIMITS, exportCsv, importCsv } from '../../src/engine/index';
import { SAMPLE_RELEASE } from '../../src/ui/sample-board';
import { solveState } from '../../src/ui/solve';
import { initialState } from '../../src/ui/state';
import { byFocus, mountWith } from './harness';

// The sample board as a CSV, kept in `docs/examples/` and compared by file snapshot, so a change in the format is a visible change. To regenerate it
// after a change on purpose: `npx vitest run tests/ui/csv-golden.test.ts -u`.

afterEach(() => {
  document.body.replaceChildren();
});

const readme = (Object.values(import.meta.glob('../../README.md', { query: '?raw', import: 'default', eager: true }))[0] ?? '') as string;

function sampleCsv(): string {
  const state = initialState();
  const solution = solveState(state);
  return exportCsv({
    board: state.home,
    home: state.home,
    kept: solution.status === 'ok' ? new Set(solution.kept) : null,
    release: SAMPLE_RELEASE,
    nextRelease: 'Next release',
  });
}

describe('docs/examples/sample-board.csv', () => {
  test('is the sample board as the app exports it', async () => {
    await expect(sampleCsv()).toMatchFileSnapshot('../../docs/examples/sample-board.csv');
  });

  test('is what the "Download sample CSV" button saves', () => {
    const h = mountWith(undefined, {}, { release: SAMPLE_RELEASE });
    byFocus(h.root, 'csv-sample').click();
    expect(h.files.saved[0]?.text).toBe(sampleCsv());
    h.app.destroy();
  });

  test('imports back to the sample\'s tickets', () => {
    const sample = initialState().home;
    const r = importCsv(sampleCsv(), { people: sample.people, timeZone: sample.timeZone, nextReleaseWeeks: sample.nextReleaseWeeks, zombieThreshold: sample.zombieThreshold });
    expect(r.ok && r.value.board.tickets.map((t) => [t.key, t.title, t.effort, t.cost, t.mustHave, t.past, t.dependsOn])).toEqual(
      sample.tickets.map((t) => [t.key, t.title, t.effort, t.cost, t.mustHave, t.past, [...t.dependsOn].sort()]),
    );
  });

  test('has no byte order mark, a comma, CRLF, and starts with the header', () => {
    const text = sampleCsv();
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text.startsWith('Issue key,Summary,Story Points,Value,Urgency,Risk,Cost of Delay,Must Have,Depends On,Times Postponed,Fix Version/s,Resolution\r\n')).toBe(true);
  });
});

describe('the README says what the importer accepts', () => {
  test('every accepted header and every limit is in the README', () => {
    expect(readme.length).toBeGreaterThan(1000);
    const lower = readme.toLowerCase();
    for (const spec of ACCEPTED_HEADERS) for (const name of spec.names) expect(lower, `${spec.label}: ${name}`).toContain(`\`${name}\``);
    expect(readme).toContain(`**${CSV_LIMITS.tickets} open tickets**`);
    expect(readme).toContain('1 MiB');
    expect(readme).toContain('2,000 rows');
    expect(readme).toContain('300 columns');
    expect(readme).toContain('docs/examples/sample-board.csv');
  });
});
