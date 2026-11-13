import { describe, expect, test } from 'vitest';
import { CSP_DIRECTIVES, CSP_POLICY } from '../../build/csp';

// The app makes no network request at all: its fonts are bundled and its policy allows only its own origin (Requirements 13.2, 15.3, 15.4).

const raw = (glob: Record<string, string>): { name: string; text: string }[] =>
  Object.entries(glob).map(([path, text]) => ({ name: path.replace(/^.*\/(src|public)\//, '$1/').replace(/^\.\.\/\.\.\//, ''), text }));

const indexHtml = import.meta.glob('../../index.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const cssFiles = raw(import.meta.glob('../../src/ui/styles/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
const uiSources = raw(import.meta.glob(['../../src/ui/**/*.ts', '../../src/main.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
const licences = raw(import.meta.glob('../../public/licenses/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
const packageJson = Object.values(import.meta.glob('../../package.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const readme = Object.values(import.meta.glob('../../README.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';

/** Comments out of the way: block and line comments (a `//` right after `:` is part of a URL, not a comment). */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const hostsIn = (text: string): string[] => (text.replaceAll(SVG_NAMESPACE, '').match(/https?:\/\/[^\s'")]+/g) ?? []) as string[];

describe('the policy', () => {
  test('is exactly the policy of the design', () => {
    expect(CSP_POLICY).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'",
    );
  });

  test('allows only its own origin: no host, no data:, no blob:, no wildcard, no inline or eval escape hatch', () => {
    expect(CSP_POLICY).not.toMatch(/https?:|\/\/|\*|data:|blob:|unsafe-|nonce-|sha\d+-|wss?:/);
    expect(hostsIn(CSP_POLICY)).toEqual([]);
  });

  test('denies by default and forbids connections', () => {
    expect(CSP_DIRECTIVES).toContain("default-src 'none'");
    expect(CSP_DIRECTIVES).toContain("connect-src 'none'");
    const sources = CSP_DIRECTIVES.filter((d) => !d.startsWith('default-src') && !d.endsWith("'none'")).map((d) => d.split(' ').slice(1).join(' '));
    for (const s of sources) expect(s).toBe("'self'");
  });

  test('font-src and style-src are self only (the Google Fonts hosts are gone)', () => {
    expect(CSP_DIRECTIVES).toContain("font-src 'self'");
    expect(CSP_DIRECTIVES).toContain("style-src 'self'");
    expect(CSP_POLICY).not.toMatch(/google|gstatic/i);
  });
});

describe('index.html', () => {
  const html = Object.values(indexHtml)[0] ?? '';

  test('is found', () => {
    expect(html).toContain('<div id="app">');
  });

  test('has no link but the icon, no preconnect, no host and no other origin', () => {
    expect([...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])).toEqual([
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
    ]);
    expect(html).not.toMatch(/preconnect|dns-prefetch|prefetch|preload/i);
    expect(hostsIn(html)).toEqual([]);
    expect(html).not.toMatch(/google|gstatic|googleapis/i);
  });

  test('has only one script, a module with a src, and no inline script, no inline style, no style attribute', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
    expect(scripts).toEqual(['<script type="module" src="/src/main.ts">']);
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });
});

describe('no external URL anywhere in what ships', () => {
  test('CSS files have no host, no url() to another origin, and import only the font packages or their own files', () => {
    expect(cssFiles.length).toBeGreaterThanOrEqual(3);
    for (const f of cssFiles) {
      expect(f.text.length, `${f.name} was read as empty`).toBeGreaterThan(0);
      const body = code(f.text);
      expect(hostsIn(body), f.name).toEqual([]);
      for (const m of body.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/g)) {
        expect(m[1], f.name).toMatch(/^(@fontsource\/[a-z-]+\/latin-(400|600)\.css|\.\/[\w./-]+\.css)$/);
      }
      for (const m of body.matchAll(/url\(\s*['"]?([^'")\s]+)/g)) {
        expect(m[1], f.name).not.toMatch(/^(https?:|\/\/|data:)/);
      }
    }
  });

  test('UI sources have no host (the SVG namespace is the only URL) and no link to another origin', () => {
    for (const f of uiSources) expect(hostsIn(code(f.text)), f.name).toEqual([]);
  });

  test('fonts.css imports exactly the six font files the app uses, latin subset only', () => {
    const fonts = cssFiles.find((f) => f.name.endsWith('fonts.css'));
    expect(fonts).toBeDefined();
    const imports = [...code(fonts?.text ?? '').matchAll(/@import\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports).toEqual([
      '@fontsource/rubik-wet-paint/latin-400.css',
      '@fontsource/permanent-marker/latin-400.css',
      '@fontsource/ibm-plex-sans/latin-400.css',
      '@fontsource/ibm-plex-sans/latin-600.css',
      '@fontsource/ibm-plex-mono/latin-400.css',
      '@fontsource/ibm-plex-mono/latin-600.css',
    ]);
  });
});

describe('fonts: packages and licences', () => {
  const pkg = JSON.parse(packageJson) as { devDependencies: Record<string, string>; dependencies?: Record<string, string> };

  test('the four font packages are dev dependencies at exact versions, and nothing is a runtime dependency', () => {
    for (const name of ['rubik-wet-paint', 'permanent-marker', 'ibm-plex-sans', 'ibm-plex-mono']) {
      expect(pkg.devDependencies[`@fontsource/${name}`]).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });

  test('every dependency is pinned to an exact version', () => {
    for (const [name, version] of Object.entries(pkg.devDependencies)) expect(version, name).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('the licence texts ship with the build (public/licenses): OFL for three fonts, Apache for Permanent Marker', () => {
    const byName = new Map(licences.map((l) => [l.name.replace(/^.*licenses\//, ''), l.text] as const));
    expect([...byName.keys()].sort()).toEqual([
      'ibm-plex-mono-OFL-1.1.txt',
      'ibm-plex-sans-OFL-1.1.txt',
      'permanent-marker-Apache-2.0.txt',
      'rubik-wet-paint-OFL-1.1.txt',
    ]);
    for (const name of ['ibm-plex-mono-OFL-1.1.txt', 'ibm-plex-sans-OFL-1.1.txt', 'rubik-wet-paint-OFL-1.1.txt']) {
      expect(byName.get(name)).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/i);
    }
    expect(byName.get('permanent-marker-Apache-2.0.txt')).toMatch(/Apache License\s+Version 2\.0/);
  });

  test('the README names the fonts and their licences', () => {
    for (const name of ['Rubik Wet Paint', 'Permanent Marker', 'IBM Plex Sans', 'IBM Plex Mono']) expect(readme).toContain(name);
    expect(readme).toMatch(/SIL Open Font License 1\.1/);
    expect(readme).toMatch(/Apache License 2\.0/);
    expect(readme).toContain('licenses/');
  });
});
