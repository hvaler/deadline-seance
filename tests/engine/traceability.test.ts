import { describe, expect, test } from 'vitest';


/**
 * Keeps `.kiro/specs/rule-engine/requirements.md` (the traceability table) honest: every property in scope has its own
 * test named with its number, in the file the table names, and nothing in the tests is skipped or focused.
 *
 * Out of scope: P13 (CSV round trip), P25 (undo) and P26 (CSV import). They belong to later specs. P19-P21 (the fog) joined in with the fog spec (tests in fog.test.ts);
 * P12 (epitaph guard, in tests/ui/epitaph-guard.test.ts) and P24 (certificate, in certificate.test.ts) joined in with the death-certificate spec.

 */

const tests = import.meta.glob(['./*.test.ts', '../ui/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.entries(tests)
  .map(([path, text]) => ({ name: path.replace(/^\.\.\//, '').replace(/^\.\//, ''), text }))
  .filter((f) => f.name !== 'traceability.test.ts');

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

/** Property number -> the test file the traceability table names. */
const TABLE: Readonly<Record<number, string>> = {
  1: 'solver.test.ts',
  2: 'solver.test.ts',
  3: 'solver.test.ts',
  4: 'solver.test.ts',
  5: 'solver.test.ts',
  6: 'solver.test.ts',
  7: 'solver.test.ts',
  8: 'solver.test.ts',
  9: 'impossible.test.ts',
  10: 'exhume.test.ts',
  11: 'capacity.test.ts',
  12: 'ui/epitaph-guard.test.ts',
  14: 'capacity.test.ts',
  15: 'diff.test.ts',
  16: 'cod.test.ts',
  17: 'zombie.test.ts',
  18: 'zombie.test.ts',
  19: 'fog.test.ts',
  20: 'fog.test.ts',
  21: 'fog.test.ts',
  22: 'solver.test.ts',
  23: 'cod.test.ts',
  24: 'certificate.test.ts',
  27: 'solver.test.ts',
};

/** Names of the tests that start with "P<number> ". */
function propertyTests(): { property: number; file: string; title: string }[] {
  const found: { property: number; file: string; title: string }[] = [];
  for (const f of files) {
    for (const m of code(f.text).matchAll(/\btest\(\s*(['"`])P(\d+)\s([^\n]*?)\1\s*,/g)) {
      found.push({ property: Number(m[2]), file: f.name, title: `P${m[2]} ${m[3]}` });
    }
  }
  return found;
}

describe('traceability', () => {
  test('the scan sees the test files', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  test('every in-scope property has a test named with its number, in the file the table names', () => {
    const found = propertyTests();
    const missing: string[] = [];
    for (const [number, file] of Object.entries(TABLE)) {
      const there = found.some((t) => t.property === Number(number) && t.file === file);
      if (!there) missing.push(`P${number} in ${file}`);
    }
    expect(missing).toEqual([]);
  });

  test('no test claims a property that is out of scope', () => {
    const inScope = new Set(Object.keys(TABLE).map(Number));
    const stray = propertyTests().filter((t) => !inScope.has(t.property));
    expect(stray).toEqual([]);
  });

  test('nothing is skipped, focused, todo or expected to fail', () => {
    const hits: string[] = [];
    for (const f of files) {
      const body = code(f.text);
      for (const m of body.matchAll(/\b(?:test|it|describe)\s*\.\s*(skip|only|todo|fails|skipIf|runIf)\b/g)) hits.push(`${f.name}: ${m[0]}`);
      for (const m of body.matchAll(/\b(xtest|xit|xdescribe|fit|fdescribe)\s*\(/g)) hits.push(`${f.name}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });

  test('the scanner itself works', () => {
    const sample = "test('P99 something', () => {});\n// test('P98 commented out', () => {});";
    const names = [...code(sample).matchAll(/\btest\(\s*(['"`])P(\d+)\s([^\n]*?)\1\s*,/g)].map((m) => m[2]);
    expect(names).toEqual(['99']);
    expect(/\b(?:test|it|describe)\s*\.\s*(skip|only|todo)\b/.test(code("test.skip('x', () => {});"))).toBe(true);
  });
});
