import { describe, expect, test } from 'vitest';

// Every file of mcp/ and of the engine, the UI and the entry point, as text. Same method as tests/engine/purity.test.ts.
const mcp = import.meta.glob(['../../mcp/**/*.ts', '../../mcp/**/*.mjs'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const others = import.meta.glob(['../../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const files = Object.entries(mcp).map(([path, text]) => ({ name: path.replace(/^.*\/mcp\//, ''), text }));

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}
function specifiers(text: string): string[] {
  const found: string[] = [];
  for (const m of code(text).matchAll(/(?:^|[\s;])(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]/gm)) {
    found.push((m[1] ?? m[2] ?? m[3]) as string);
  }
  return found;
}
const named = (name: string) => files.find((f) => f.name === name);

describe('MCP: dependency direction and purity', () => {
  test('the scan sees every file of mcp/', () => {
    expect(files.map((f) => f.name).sort()).toEqual(
      ['certificate.ts', 'errors.ts', 'render.ts', 'request.ts', 'run.ts', 'schemas.ts', 'server.ts', 'solve-freeze.ts', 'start.mjs', 'time.ts', 'tools.ts', 'vite.config.ts', 'what-if.ts'].sort(),
    );
  });

  test('the specifier scanner finds every kind of import', () => {
    const text = "import a from './a';\nimport type { B } from '../b';\nexport { c } from './c';\nimport './d';\nconst e = await import('./e');\nimport {\n  f,\n} from './f';\n";
    expect(specifiers(text)).toEqual(['./a', '../b', './c', './d', './e', './f']);
  });

  test('mcp/ reaches the repository only through src/engine/index', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const s of specifiers(f.text)) {
        if (!s.startsWith('.')) continue;
        if (/^\.\/[a-z-]+$/.test(s)) continue; // a sibling
        if (s === '../src/engine/index') continue;
        if (f.name === 'vite.config.ts' && s === '..') continue;
        bad.push(`${f.name} imports ${s}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('mcp/ never imports ui, tests, build or main', () => {
    for (const f of files) for (const s of specifiers(f.text)) expect(s, f.name).not.toMatch(/(^|\/)(ui|tests|build|main)(\/|$)/);
  });

  test('nothing under src/ imports mcp/ (engine, ui and main point one way)', () => {
    const bad = Object.entries(others).filter(([, text]) => specifiers(text).some((s) => /(^|\/)mcp(\/|$)/.test(s))).map(([p]) => p);
    expect(bad).toEqual([]);
  });

  test('the SDK is imported only by server.ts, and zod only by schemas.ts', () => {
    for (const f of files) {
      const s = specifiers(f.text);
      const sdk = s.some((x) => x.startsWith('@modelcontextprotocol/'));
      const zod = s.some((x) => x === 'zod' || x.startsWith('zod/'));
      expect(sdk, `${f.name} sdk`).toBe(f.name === 'server.ts');
      expect(zod, `${f.name} zod`).toBe(f.name === 'schemas.ts');
    }
    expect(specifiers(named('server.ts')?.text ?? '').filter((x) => x.startsWith('@')).sort()).toEqual(['@modelcontextprotocol/server', '@modelcontextprotocol/server/stdio']);
  });

  test('only start.mjs and vite.config.ts import node modules or vite', () => {
    for (const f of files) {
      const hasNode = specifiers(f.text).some((x) => x.startsWith('node:') || x === 'vite');
      expect(hasNode, f.name).toBe(f.name === 'start.mjs' || f.name === 'vite.config.ts');
    }
  });

  const forbidden: [string, RegExp][] = [
    ['Date.now', /\bDate\s*\.\s*now\b/],
    ['new Date() with no arguments', /\bnew\s+Date\s*\(\s*\)/],
    ['Date.parse', /\bDate\s*\.\s*parse\b/],
    ['Math.random', /\bMath\s*\.\s*random\b/],
    ['performance', /\bperformance\b/],
    ['fetch', /\bfetch\b/],
    ['process', /\bprocess\b/],
    ['require', /\brequire\b/],
    ['crypto', /\bcrypto\b/],
    ['setTimeout / setInterval', /\bset(Timeout|Interval)\b/],
    ['file system', /\b(readFile|writeFile|readdir|createReadStream|fs\.)/],
    ['network or child process', /\b(WebSocket|XMLHttpRequest|child_process|spawn|execSync|execFile|createConnection|listen\s*\()/],
  ];
  const handlers = () => files.filter((f) => f.name.endsWith('.ts') && f.name !== 'vite.config.ts');
  for (const [label, pattern] of forbidden) {
    test(`no handler file uses ${label}`, () => {
      // server.ts may name `createServer` for the factory it hands to the SDK, so the network pattern is checked on the others only.
      for (const f of handlers()) {
        expect(pattern.test(code(f.text)), f.name).toBe(false);
      }
    });
  }

  test('server.ts writes to stderr only (no console.log, no stdout)', () => {
    const text = code(named('server.ts')?.text ?? '');
    expect(text).not.toMatch(/console\s*\.\s*(log|info|debug)\b|stdout/);
    expect(text).toMatch(/console\.error/);
  });
});
