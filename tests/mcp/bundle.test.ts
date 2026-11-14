import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const temp: string[] = [];
function scratch(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `deadline-seance-${name}-`));
  temp.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temp) rmSync(dir, { recursive: true, force: true });
});

function filesOf(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map((f) => join(dir, String(f))).filter((f) => statSync(f).isFile());
}

/** Sends JSON-RPC lines to a server and returns every line it wrote to stdout, until it has answered `answers` requests. */
function talk(command: string, args: string[], cwd: string, requests: object[], answers: number): Promise<{ stdout: string[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    const lines: string[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no answer in time; stderr: ${stderr}`));
    }, 60_000);
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.stdout.on('data', (d: Buffer) => {
      buffer += d.toString();
      let at = buffer.indexOf('\n');
      while (at >= 0) {
        const line = buffer.slice(0, at).replace(/\r$/, '');
        buffer = buffer.slice(at + 1);
        if (line !== '') lines.push(line);
        at = buffer.indexOf('\n');
      }
      if (lines.filter((l) => l.includes('"id"')).length >= answers) {
        clearTimeout(timer);
        child.kill();
        resolve({ stdout: lines, stderr });
      }
    });
    child.on('error', reject);
    for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
  });
}

const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'bundle-test', version: '1' } } };
const CALL = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'solve_freeze', arguments: { board: { source: 'sample' } } } };

describe('MCP: the web bundle does not change', () => {
  let out = '';
  beforeAll(async () => {
    out = scratch('web');
    await build({ root: ROOT, logLevel: 'silent', build: { outDir: out, emptyOutDir: true, reportCompressedSize: false } });
  }, 120_000);

  test('dist/ holds no MCP code: no SDK, no zod, no tool name, no server text', () => {
    const text = filesOf(out).filter((f) => /\.(js|css|html)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const needle of ['modelcontextprotocol', 'registerTool', 'serveStdio', 'solve_freeze', 'what_if', 'death_certificate', 'ZodError', 'deadline-seance MCP', 'maxToolInputElements']) {
      expect(text.includes(needle), needle).toBe(false);
    }
  });

  test('the JavaScript and CSS stay inside the budget of the tech steering (60 kB gzip), and the JavaScript at today\'s 37 kB', () => {
    const size = (re: RegExp) => filesOf(out).filter((f) => re.test(f)).reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0);
    const js = size(/\.js$/);
    const css = size(/\.css$/);
    expect(js).toBeLessThan(37_500);
    expect(js + css).toBeLessThan(60_000);
  });
});

describe('MCP: the server bundle', () => {
  let bundle = '';
  beforeAll(async () => {
    const dir = scratch('server');
    await build({ root: ROOT, configFile: join(ROOT, 'mcp', 'vite.config.ts'), logLevel: 'silent', build: { outDir: dir, emptyOutDir: true } });
    bundle = join(dir, 'server.mjs');
  }, 120_000);

  test('it is one file that imports only Node built-ins', () => {
    const text = readFileSync(bundle, 'utf8');
    const bare = [...text.matchAll(/(?:^|\n)\s*import\b[^'"\n]*?from\s*["']([^"']+)["']/g)].map((m) => m[1] as string);
    expect(bare.length).toBeGreaterThan(0);
    for (const s of bare) expect(s, s).toMatch(/^node:/);
    expect(readdirSync(join(bundle, '..')).filter((f) => f.endsWith('.mjs'))).toEqual(['server.mjs']);
  });

  test('it runs from an empty folder with no node_modules, answers over stdio, and stdout carries only JSON-RPC', async () => {
    const empty = scratch('empty');
    const copy = join(empty, 'server.mjs');
    cpSync(bundle, copy);
    const { stdout, stderr } = await talk(process.execPath, [copy], empty, [INIT, CALL], 2);
    for (const line of stdout) expect(() => JSON.parse(line), line.slice(0, 80)).not.toThrow();
    const answer = stdout.map((l) => JSON.parse(l) as { id?: number; result?: { structuredContent?: { totals?: { points: number } } } }).find((m) => m.id === 2);
    expect(answer?.result?.structuredContent?.totals?.points).toBe(59);
    expect(stderr).toContain('deadline-seance MCP ready');
  }, 90_000);
});

describe('MCP: start.mjs', () => {
  let work = '';
  let started = 0;
  beforeAll(() => {
    // A copy of what the build reads, so touching a source here cannot disturb the real dist-mcp/ that other tests start.
    work = scratch('start');
    for (const dir of ['mcp', join('src', 'engine')]) {
      mkdirSync(join(work, dir), { recursive: true });
      cpSync(join(ROOT, dir), join(work, dir), { recursive: true });
    }
    cpSync(join(ROOT, 'package.json'), join(work, 'package.json'));
    symlinkSync(join(ROOT, 'node_modules'), join(work, 'node_modules'), 'junction');
    started = Date.now();
  });
  const out = () => join(work, 'dist-mcp', 'server.mjs');
  const buildOnly = () => spawnSync(process.execPath, [join(work, 'mcp', 'start.mjs'), '--build-only'], { cwd: tmpdir(), encoding: 'utf8' });

  test('a cold start builds the bundle, and nothing the build says reaches stdout', () => {
    expect(existsSync(out())).toBe(false);
    const r = buildOnly();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('built dist-mcp/server.mjs');
    expect(existsSync(out())).toBe(true);
    expect(started).toBeGreaterThan(0);
  }, 90_000);

  test('a warm start does not rebuild when no source is newer than the bundle', () => {
    const before = statSync(out()).mtimeMs;
    const r = buildOnly();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toContain('built');
    expect(statSync(out()).mtimeMs).toBe(before);
  }, 90_000);

  test('a newer file in mcp/ or in src/engine rebuilds it', () => {
    for (const file of [join(work, 'mcp', 'time.ts'), join(work, 'src', 'engine', 'cod.ts')]) {
      const before = statSync(out()).mtimeMs;
      const later = new Date(before + 1);
      utimesSync(file, later, later);
      const r = buildOnly();
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr, file).toContain('built dist-mcp/server.mjs');
      expect(statSync(out()).mtimeMs).toBeGreaterThan(before);
    }
  }, 90_000);

  test('a source outside mcp/ and src/engine (the UI) does not rebuild it', () => {
    mkdirSync(join(work, 'src', 'ui'), { recursive: true });
    const file = join(work, 'src', 'ui', 'x.ts');
    cpSync(join(work, 'mcp', 'time.ts'), file);
    const later = new Date(Date.now() + 60_000);
    utimesSync(file, later, later);
    const r = buildOnly();
    expect(r.stderr).not.toContain('built');
  }, 90_000);
});
