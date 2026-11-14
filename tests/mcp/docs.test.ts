import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import config from '../../.kiro/settings/mcp.json';
import docs from '../../docs/mcp.md?raw';
import rule from '../../docs/rule.md?raw';
import type { HandlerResult } from '../../mcp/errors';
import { deathCertificateTool } from '../../mcp/certificate';
import { solveFreezeTool } from '../../mcp/solve-freeze';
import { whatIfTool } from '../../mcp/what-if';
import { answer } from './helpers';

// docs/mcp.md has blocks between markers that this test writes from real handler calls, so a number in the docs can never drift from the engine.
// `UPDATE_MCP_DOCS=1 npx vitest run tests/mcp/docs.test.ts` rewrites the file; without it the test fails when the file differs.
const FILE = fileURLToPath(new URL('../../docs/mcp.md', import.meta.url));

const fence = (lang: string, body: string): string => `\`\`\`${lang}\n${body.trimEnd()}\n\`\`\``;

function example(tool: (raw: unknown) => HandlerResult<unknown>, name: string, args: object): string {
  const { text } = answer(tool(args));
  return [`Call \`${name}\` with:`, '', fence('json', JSON.stringify(args, null, 2)), '', 'Answer (the text block; `structuredContent` carries the same values as JSON):', '', fence('text', text)].join('\n');
}

const sample = { board: { source: 'sample' } };
const blocks: Record<string, string> = {
  config: fence('json', JSON.stringify(config, null, 2)),
  solve_freeze: example(solveFreezeTool, 'solve_freeze', sample),
  what_if: example(whatIfTool, 'what_if', { ...sample, change: { kind: 'away', person: 'Ana', date: '2026-11-20' } }),
  what_if_exhume: example(whatIfTool, 'what_if', { ...sample, change: { kind: 'exhume', key: 'HB-117' } }),
  death_certificate: example(deathCertificateTool, 'death_certificate', sample),
};

function fill(text: string): string {
  let out = text;
  for (const [name, body] of Object.entries(blocks)) {
    const re = new RegExp(`(<!-- generated:${name}:start -->)[\\s\\S]*?(<!-- generated:${name}:end -->)`);
    if (!re.test(out)) throw new Error(`docs/mcp.md has no block "${name}"`);
    out = out.replace(re, (_m, a: string, b: string) => `${a}\n${body}\n${b}`);
  }
  return out;
}

describe('MCP: docs/mcp.md', () => {
  test('the generated blocks equal what the handlers answer now', () => {
    const wanted = fill(docs);
    if (process.env.UPDATE_MCP_DOCS === '1' && wanted !== docs) writeFileSync(FILE, wanted);
    else expect(docs.replace(/\r\n/g, '\n')).toBe(wanted.replace(/\r\n/g, '\n'));
  });

  test('every tool and the config appear, and the golden numbers are in the page', () => {
    for (const name of Object.keys(blocks)) expect(docs).toContain(`<!-- generated:${name}:start -->`);
    expect(docs).toContain('Kept 12 tickets, 59 points, cost of delay 167.');
    expect(docs).toContain('The night holds on 0 of 1000 simulated nights');
  });

  test('it says the server is read-only, offline and clock-free, and which documentation the design read', () => {
    expect(docs).toMatch(/read-only/i);
    expect(docs).toMatch(/offline|no network/i);
    expect(docs).toMatch(/clock/i);
    expect(docs).toContain('context7');
  });


  test('docs/rule.md has the dated section of the server, and it says the server adds no rule', () => {
    expect(rule).toContain('## 2026-11-14 — Servidor MCP (spec `mcp-server`)');
    expect(rule).toContain('no añade ninguna regla');
  });
});
