import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { CSP_POLICY } from '../../build/csp';

// The real production build, into a temporary folder: what ships is what these tests read. (The dev server is not checked here: the policy
// is written in the build only.)

let out = '';
const read = (path: string): string => readFileSync(join(out, path), 'utf8');
const list = (path: string): string[] => readdirSync(join(out, path));

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'deadline-seance-build-'));
  await build({ logLevel: 'silent', build: { outDir: out, emptyOutDir: true, reportCompressedSize: false } });
}, 120_000);

afterAll(() => {
  if (out !== '') rmSync(out, { recursive: true, force: true });
});

describe('dist/index.html', () => {
  test('carries the Content Security Policy of build/csp.ts, first in the head', () => {
    const html = read('index.html');
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
    expect(meta).not.toBeNull();
    expect((meta?.[1] ?? '').replace(/&#39;/g, "'")).toBe(CSP_POLICY);
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<meta charset'));
    expect(html.indexOf('<meta charset')).toBeLessThan(1024); // the charset must come early
  });

  test('uses relative paths, so it works from any folder of a static host', () => {
    const html = read('index.html');
    const urls = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1] as string);
    expect(urls.length).toBeGreaterThanOrEqual(3);
    for (const url of urls) expect(url, url).toMatch(/^\.\//);
  });

  test('has no inline script, no inline style and no style attribute, and exactly one script', () => {
    const html = read('index.html');
    expect([...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])).toHaveLength(1);
    expect(html).toMatch(/<script type="module" crossorigin src="\.\/assets\/[^"]+\.js"><\/script>/);
    expect(html).not.toMatch(/<script\b[^>]*>\s*[^<\s]/); // a script with a body
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });
});

describe('dist assets', () => {
  const files = (): string[] => list('assets');

  test('the fonts are separate files, none of them inlined as a data: URL', () => {
    const fonts = files().filter((f) => /\.woff2?$/.test(f));
    expect(fonts.length).toBe(12);
    const css = files().filter((f) => f.endsWith('.css'));
    expect(css).toHaveLength(1);
    const text = read(`assets/${css[0]}`);
    expect(text).not.toMatch(/url\(\s*["']?data:/);
    expect(text).toMatch(/url\(\.\/[a-z0-9-]+\.woff2?\)/i);
    for (const name of [...text.matchAll(/url\(\.\/([^)]+\.woff2?)\)/g)].map((m) => m[1] as string)) expect(fonts, name).toContain(name);
  });

  test('nothing in the build is a data: URL or points to another origin (the SVG namespace is the only URL)', () => {
    for (const name of files().filter((f) => /\.(js|css)$/.test(f))) {
      const text = read(`assets/${name}`);
      expect(text, name).not.toMatch(/url\(\s*["']?data:/);
      expect(text, name).not.toMatch(/["'`]data:/);
      const hosts = [...text.matchAll(/https?:\/\/[^\s"'`)]+/g)].map((m) => m[0]).filter((u) => u !== 'http://www.w3.org/2000/svg');
      expect(hosts, name).toEqual([]);
    }
    expect(read('index.html')).not.toMatch(/https?:\/\//);
    expect(read('favicon.svg')).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
  });

  test('the four font licences ship with the build', () => {
    expect(list('licenses').sort()).toEqual([
      'ibm-plex-mono-OFL-1.1.txt',
      'ibm-plex-sans-OFL-1.1.txt',
      'permanent-marker-Apache-2.0.txt',
      'rubik-wet-paint-OFL-1.1.txt',
    ]);
  });

  test('the favicon ships next to the page', () => {
    expect(list('.')).toContain('favicon.svg');
  });

  test('the script and the stylesheet together stay under the 60 kB budget, gzipped', () => {
    const gz = (name: string): number => gzipSync(readFileSync(join(out, 'assets', name))).length;
    const js = files().filter((f) => f.endsWith('.js'));
    const css = files().filter((f) => f.endsWith('.css'));
    expect(js).toHaveLength(1);
    const total = [...js, ...css].map(gz).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(60 * 1000);
  });
});
