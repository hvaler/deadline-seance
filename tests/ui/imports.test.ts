import { describe, expect, test } from 'vitest';

// Scans of the UI sources. They keep three promises of the spec: the UI talks to the engine only through its public entry (Requirement
// 14.4), board text never becomes markup (15.1), and nothing reads the clock, randomness or the network (1.2, 15.4).

const sources = import.meta.glob(['../../src/ui/**/*.ts', '../../src/main.ts'], { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;
const files = Object.entries(sources).map(([path, text]) => ({ name: path.replace(/^.*\/src\//, ''), text }));

/** Source without comments, so a word in a comment does not count. A `//` right after `:` (as in `https://`) is not a comment. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

/** Every module specifier in the code: `import ... from 'x'`, `import 'x'`, `export ... from 'x'`, `import('x')`. */
function specifiers(text: string): string[] {
  const body = code(text);
  const found: string[] = [];
  for (const re of [/\bimport\s*(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]/g, /\bexport\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\(\s*['"]([^'"]+)['"]/g]) {
    for (const m of body.matchAll(re)) found.push(m[1] as string);
  }
  return found;
}

describe('the scan sees the UI sources', () => {
  test('the main modules are all there', () => {
    const names = files.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(['main.ts', 'ui/app.ts', 'ui/derive.ts', 'ui/dom.ts', 'ui/model.ts', 'ui/solve.ts', 'ui/state.ts', 'ui/store.ts', 'ui/text.ts']),
    );
  });

  test('the specifier scanner finds every kind of import', () => {
    const sample = `
      import { a } from '../engine/index';
      import type { B } from "../engine/solver";
      import './styles/base.css';
      export { c } from '../engine/chain';
      const d = await import('../engine/oracle');
      import {
        e,
        f,
      } from '../engine/diff';
      // import { g } from '../engine/commented';
    `;
    expect(specifiers(sample)).toEqual([
      '../engine/index',
      '../engine/solver',
      './styles/base.css',
      '../engine/diff',
      '../engine/chain',
      '../engine/oracle',
    ]);
  });
});

describe('imports', () => {
  test('the UI reaches the engine only through its public entry (engine/index)', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const s of specifiers(f.text)) {
        if (!/(^|\/)engine(\/|$)/.test(s)) continue;
        if (!/(^|\/)engine(\/index)?$/.test(s)) bad.push(`${f.name} imports ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('the UI imports nothing from tests, build, mcp, test tools, or any package', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const s of specifiers(f.text)) {
        const relative = s.startsWith('./') || s.startsWith('../');
        if (!relative) bad.push(`${f.name} imports the package or URL ${s}`);
        else if (/(^|\/)(tests|build|mcp)(\/|$)/.test(s)) bad.push(`${f.name} imports ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('the engine never imports the UI (the dependency points one way)', () => {
    const engine = import.meta.glob('../../src/engine/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const bad = Object.entries(engine).filter(([, text]) => specifiers(text).some((s) => /(^|\/)ui(\/|$)/.test(s)));
    expect(bad.map(([name]) => name)).toEqual([]);
  });
});

const banned: [string, RegExp][] = [
  // Board text must never be parsed as markup.
  ['innerHTML', /\binnerHTML\b/],
  ['outerHTML', /\bouterHTML\b/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['document.write', /\bdocument\s*\.\s*write(ln)?\b/],
  ['DOMParser', /\bDOMParser\b/],
  ['createContextualFragment', /\bcreateContextualFragment\b/],
  ['eval', /\beval\s*\(/],
  ['new Function', /\bnew\s+Function\b/],
  ['setAttribute("style")', /setAttribute\(\s*['"]style['"]/],
  ['srcdoc', /\bsrcdoc\b/],
  ['javascript: URL', /javascript:/i],
  // The rule's clock is a constant; randomness is never used.
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['new Date() with no arguments', /\bnew\s+Date\s*\(\s*\)/],
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['crypto', /\bcrypto\b/],
  // No network, no storage: the app makes no request and keeps nothing between visits.
  ['fetch', /\bfetch\s*\(/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['Worker', /\b(Shared)?Worker\s*\(/],
  ['import() of a URL', /\bimport\(\s*['"]https?:/],
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['indexedDB', /\bindexedDB\b/],
  ['document.cookie', /\bdocument\s*\.\s*cookie\b/],
];

/** The one place that may name the attributes it refuses to write: the guard in `dom.ts` that throws on them. */
const allowedIn: Record<string, readonly string[]> = {
  srcdoc: ['ui/dom.ts'],
  'javascript: URL': ['ui/dom.ts'],
};

describe('banned APIs', () => {
  test('none of them appears in the code of src/ui or src/main.ts', () => {
    const hits: string[] = [];
    for (const f of files) {
      const body = code(f.text);
      for (const [label, pattern] of banned) {
        if (pattern.test(body) && !(allowedIn[label] ?? []).includes(f.name)) hits.push(`${f.name}: ${label}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test('the dom.ts guard really refuses what it names', () => {
    const dom = files.find((f) => f.name === 'ui/dom.ts');
    expect(code(dom?.text ?? '')).toMatch(/throw new Error\([^)]*srcdoc/);
    expect(code(dom?.text ?? '')).toMatch(/javascript:/);
  });

  test('performance is read only by the decoration (the timecode and the fog), never by the logic', () => {
    const hits = files.filter((f) => /\bperformance\b/.test(code(f.text)) && !f.name.startsWith('ui/atmosphere/')).map((f) => f.name);
    expect(hits).toEqual([]);
  });

  test('no UI file mentions a system-clock time zone or date parsing of the rule', () => {
    const hits = files.filter((f) => /\bnew\s+Date\s*\(\s*[^)\s]/.test(code(f.text)) && !/Date\.UTC/.test(code(f.text))).map((f) => f.name);
    expect(hits).toEqual([]);
  });

  test('the scanner itself works: it catches each kind of call and ignores comments and look-alikes', () => {
    const hits = (text: string): string[] => banned.filter(([, p]) => p.test(code(text))).map(([label]) => label);
    expect(hits('el.innerHTML = x;')).toEqual(['innerHTML']);
    expect(hits('const t = Date.now();')).toEqual(['Date.now']);
    expect(hits('const t = new Date( );')).toEqual(['new Date() with no arguments']);
    expect(hits('x = Math.random();')).toEqual(['Math.random']);
    expect(hits('fetch("/x")')).toEqual(['fetch']);
    expect(hits('node.setAttribute("style", "x")')).toEqual(['setAttribute("style")']);
    expect(hits('// el.innerHTML = x; Date.now()\nconst a = 1;')).toEqual([]);
    expect(hits('/* Math.random */ const a = 1;')).toEqual([]);
    expect(hits('const d = new Date(Date.UTC(2026, 0, 1));')).toEqual([]);
    expect(hits('el.textContent = "innerHTML";')).toEqual(['innerHTML']); // a word in a string still counts: nobody needs it
    expect(hits('const prefetch = 1; fetchSomething();')).toEqual([]);
  });
});
