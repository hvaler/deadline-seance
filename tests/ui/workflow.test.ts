import { describe, expect, test } from 'vitest';

// The Pages workflow, checked as text (no YAML parser is a dependency; the file was also parsed once with a real one). What matters:
// every action is pinned to a full commit, the default permission is read-only, and write access is given to the deploy job alone.

const files = import.meta.glob('../../.github/workflows/*.yml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const workflow = Object.entries(files).find(([path]) => path.endsWith('pages.yml'))?.[1] ?? '';
const lines = workflow.split('\n');

/** The lines of one top-level key (`jobs:`) or of one job under it, by indentation. */
function blockOf(start: number, indent: number): string[] {
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === '' || line.trim().startsWith('#')) {
      block.push(line);
      continue;
    }
    if (line.length - line.trimStart().length <= indent) break;
    block.push(line);
  }
  return block;
}
const at = (pattern: RegExp): number => lines.findIndex((l) => pattern.test(l));

describe('.github/workflows/pages.yml', () => {
  test('exists', () => {
    expect(workflow).not.toBe('');
  });

  test('runs on a push to main and by hand, never on a pull request from a fork', () => {
    const on = blockOf(at(/^on:/), 0).join('\n');
    expect(on).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(on).toContain('workflow_dispatch');
    expect(workflow).not.toMatch(/pull_request/);
  });

  test('every action is pinned to a full 40-character commit, with its release in a comment', () => {
    const uses = lines.filter((l) => /^\s*(?:- )?uses:/.test(l));
    expect(uses.length).toBeGreaterThanOrEqual(4);
    for (const line of uses) expect(line, line).toMatch(/uses: actions\/[a-z-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
  });

  test('the default permission is read-only', () => {
    expect(blockOf(at(/^permissions:/), 0).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'))).toEqual(['contents: read']);
  });

  test('write access (pages and id-token) is on the deploy job only', () => {
    const jobs = blockOf(at(/^jobs:/), 0);
    const jobStarts = jobs.map((l, i) => ({ l, i })).filter(({ l }) => /^ {2}[a-z-]+:\s*$/.test(l));
    expect(jobStarts.map(({ l }) => l.trim())).toEqual(['build:', 'deploy:']);
    const body = (n: number): string => jobs.slice((jobStarts[n] as { i: number }).i, jobStarts[n + 1]?.i ?? jobs.length).join('\n');
    expect(body(0)).not.toMatch(/permissions:|pages: write|id-token/);
    expect(body(1)).toMatch(/permissions:\s*\n\s*pages: write[^\n]*\n\s*id-token: write/);
    expect(body(1)).toContain('needs: build');
    expect(body(1)).toMatch(/environment:\s*\n\s*name: github-pages/);
    expect(workflow.match(/pages: write/g)).toHaveLength(1);
    expect(workflow.match(/id-token: write/g)).toHaveLength(1);
  });

  test('the build job installs from the lock file, then type-checks, tests and builds, and uploads dist', () => {
    const runs = lines.filter((l) => /^\s*run:/.test(l)).map((l) => l.replace(/^\s*run:\s*/, ''));
    expect(runs).toEqual(['npm ci', 'npm run typecheck', 'npm test', 'npm run build']);
    expect(workflow).toMatch(/upload-pages-artifact@[0-9a-f]{40} # v\d+\.\d+\.\d+\s*\n\s*with:\s*\n\s*path: dist/);
  });

  test('deploys one at a time and never cancels a deploy half way', () => {
    const block = blockOf(at(/^concurrency:/), 0).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
    expect(block).toEqual(['group: pages', 'cancel-in-progress: false']);
  });

  test('uses no secret and no token of its own', () => {
    expect(workflow).not.toMatch(/secrets\.|GITHUB_TOKEN|env:/);
  });
});
