import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import * as engine from '../../src/engine/index';
import { atCapacity } from './fixtures';
import { arbSolveCase } from './generators';

// Every engine source file as text (no Node APIs needed).
const sources = import.meta.glob('../../src/engine/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.entries(sources).map(([path, text]) => ({ name: path.replace(/^.*src\/engine\//, ''), text }));

/** Source without comments, so a word in a comment does not count. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

describe('purity of src/engine', () => {
  test('the scan sees the engine sources', () => {
    const names = files.map((f) => f.name).sort();
    expect(names).toEqual(
      expect.arrayContaining(['capacity.ts', 'certificate.ts', 'chain.ts', 'cod.ts', 'csv.ts', 'diff.ts', 'facts.ts', 'fog.ts', 'guard.ts', 'hash.ts', 'index.ts', 'keys.ts', 'oracle.ts', 'solver.ts', 'types.ts', 'validate.ts', 'weights.ts']),
    );
  });

  const forbidden: [string, RegExp][] = [
    ['Date.now', /\bDate\s*\.\s*now\b/],
    ['new Date() with no arguments', /\bnew\s+Date\s*\(\s*\)/],
    ['Math.random', /\bMath\s*\.\s*random\b/],
    ['performance', /\bperformance\b/],
    ['window', /\bwindow\b/],
    ['document', /\bdocument\b/],
    ['navigator', /\bnavigator\b/],
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['fetch', /\bfetch\b/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['process', /\bprocess\b/],
    ['require', /\brequire\b/],
    ['crypto', /\bcrypto\b/],
    ['setTimeout / setInterval', /\bset(Timeout|Interval)\b/],
  ];

  test('no clock, randomness, DOM, network or Node globals appear in the code', () => {
    const hits: string[] = [];
    for (const f of files) {
      const body = code(f.text);
      for (const [label, pattern] of forbidden) if (pattern.test(body)) hits.push(`${f.name}: ${label}`);
    }
    expect(hits).toEqual([]);
  });

  test('the scanner itself works: it would catch a forbidden call and ignore comments', () => {
    expect(forbidden.some(([, p]) => p.test(code('const t = Date.now();')))).toBe(true);
    expect(forbidden.some(([, p]) => p.test(code('const t = new Date( );')))).toBe(true);
    expect(forbidden.some(([, p]) => p.test(code('// Date.now() is never used\nconst a = 1;')))).toBe(false);
    expect(forbidden.some(([, p]) => p.test(code('/* Math.random */ const a = 1;')))).toBe(false);
    expect(forbidden.some(([, p]) => p.test(code('const d = new Date(Date.UTC(2026, 0, 1));')))).toBe(false);
  });

  test('the engine imports only its own files (never ui, mcp, tests or packages)', () => {
    const own = new Set(files.map((f) => './' + f.name.replace(/\.ts$/, '')));
    const bad: string[] = [];
    for (const f of files) {
      const body = code(f.text);
      const specifiers = [...body.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string);
      for (const s of specifiers) if (!own.has(s)) bad.push(`${f.name} imports ${s}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('public API', () => {
  test('index.ts exports exactly the documented functions and constants, and not the oracle', () => {
    expect(Object.keys(engine).sort()).toEqual(
      [
        'ACCEPTED_HEADERS',
        'CSV_LIMITS',
        'DEFAULT_FOG_SEED',
        'DEFAULT_NEXT_RELEASE_WEEKS',
        'DEFAULT_TIME_ZONE',
        'DEFAULT_ZOMBIE_THRESHOLD',
        'EXPORT_HEADERS',
        'FOG_MAX_PCT',
        'FOG_MIN_PCT',
        'FOG_NIGHTS',
        'FOG_RESERVE_STEPS',
        'MAX_FOG_SEED',
        'SCALE',
        'burialCost',
        'capacityBetween',
        'certificateNote',
        'checkNumbers',
        'codParts',
        'columnLetter',
        'compareKeyLists',
        'compareKeys',
        'costOfDelay',
        'deathCertificate',
        'diffSolutions',
        'effectiveCapacity',
        'effectiveUrgency',
        'err',
        'escapeMarkdown',
        'exhume',
        'exportCsv',
        'extractTokens',
        'fogCurve',
        'fogFactor',
        'fogFromTable',
        'fogTable',
        'guardCell',
        'guardCertificate',
        'guardFacts',
        'importCsv',
        'nightFacts',
        'ok',
        'parseCsv',
        'plainText',
        'putDown',
        'renderCertificate',
        'renderNote',
        'resurrect',
        'serializeCsv',
        'simulateFog',
        'solveFreeze',
        'solveWithCapacity',
        'sortedKeys',
        'toWellFormed',
        'unguardCell',
        'validateBoard',
      ].sort(),
    );
    expect(Object.keys(engine)).not.toContain('oracleSolve');
  });

  test('the index source does not mention the oracle', () => {
    const index = files.find((f) => f.name === 'index.ts');
    expect(code(index?.text ?? '')).not.toMatch(/oracle/i);
  });
});

// ---- no mutation, and the same answer twice ------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

describe('no mutation', () => {
  test('every public function leaves a deep-frozen input untouched and returns the same answer twice', () => {
    fc.assert(
      fc.property(arbSolveCase({ maxTickets: 12, withWontDo: true, mustHaveRate: 5 }), fc.nat(), (c, pick) => {
        // threshold 1 so that any buried ticket can also be put down
        const { board, freeze } = atCapacity({ ...c.board, zombieThreshold: 1 }, c.capacity, c.marginPct);
        deepFreeze(board);
        deepFreeze(freeze);

        const twice = <T>(run: () => T): T => {
          const first = run();
          expect(run()).toEqual(first);
          return first;
        };

        const validated = twice(() => engine.validateBoard(board));
        expect(validated.ok).toBe(true);
        twice(() => engine.capacityBetween(board.people, board.timeZone, freeze.now, freeze.freezeAt));
        twice(() => engine.effectiveCapacity(c.capacity, c.marginPct));
        for (const t of board.tickets) twice(() => engine.codParts(t));

        const solved = twice(() => engine.solveFreeze(board, freeze));
        twice(() => engine.solveWithCapacity(board, c.capacity, c.marginPct));
        if (!solved.ok || solved.value.status !== 'ok') return;
        deepFreeze(solved.value);

        twice(() => engine.diffSolutions(solved.value, solved.value));
        const buried = solved.value.buried;
        if (buried.length === 0) return;
        const key = buried[pick % buried.length]?.key as string;
        twice(() => engine.exhume(board, freeze, key));
        twice(() => engine.putDown(board, freeze, key));
      }),
      { numRuns: 200 },
    );
  });
});
