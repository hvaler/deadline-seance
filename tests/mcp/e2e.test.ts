import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { deathCertificateTool } from '../../mcp/certificate';
import { solveFreezeTool } from '../../mcp/solve-freeze';
import { whatIfTool } from '../../mcp/what-if';
import { SAMPLE_REQUEST } from './helpers';

// The real server, started the way Kiro starts it (`node mcp/start.mjs`), from a folder that is not the repository, and spoken to with the SDK's own client.
const START = fileURLToPath(new URL('../../mcp/start.mjs', import.meta.url));
let client: Client;

beforeAll(async () => {
  client = new Client({ name: 'deadline-seance-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [START], cwd: tmpdir(), stderr: 'pipe' }));
}, 60_000);

afterAll(async () => {
  await client.close();
});

/** What crosses the wire is JSON: compare with a handler's answer after the same trip. */
const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('MCP: the real server over stdio', () => {
  test('it names itself, says what it is for, and lists the three tools with schemas and annotations', async () => {
    expect(client.getServerVersion()?.name).toBe('deadline-seance');
    expect(client.getInstructions()).toContain('solve_freeze');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['death_certificate', 'solve_freeze', 'what_if']);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.outputSchema?.type).toBe('object');
      expect(t.annotations).toMatchObject({ readOnlyHint: true, idempotentHint: true, openWorldHint: false });
      expect((t.description ?? '').length).toBeGreaterThan(40);
    }
  });

  test('solve_freeze, what_if and death_certificate answer what the handlers answer', async () => {
    const solve = await client.callTool({ name: 'solve_freeze', arguments: SAMPLE_REQUEST });
    const direct = solveFreezeTool(SAMPLE_REQUEST);
    if (!direct.ok) throw new Error('handler');
    expect(solve.isError).toBeFalsy();
    expect(solve.structuredContent).toEqual(wire(direct.structured));
    expect(solve.content).toEqual([{ type: 'text', text: direct.text }]);
    expect(solve.structuredContent).toMatchObject({ totals: { tickets: 12, points: 59, cod: 167 }, fog: { holds: 0, nights: 1000 } });

    const change = { kind: 'exhume', key: 'HB-117' };
    const what = await client.callTool({ name: 'what_if', arguments: { ...SAMPLE_REQUEST, change } });
    const w = whatIfTool({ ...SAMPLE_REQUEST, change });
    if (!w.ok) throw new Error('handler');
    expect(what.structuredContent).toEqual(wire(w.structured));

    const cert = await client.callTool({ name: 'death_certificate', arguments: SAMPLE_REQUEST });
    const c = deathCertificateTool(SAMPLE_REQUEST);
    if (!c.ok) throw new Error('handler');
    expect(cert.structuredContent).toEqual(wire(c.structured));
  });

  test('a mistake is a tool error with a code, and the server keeps answering', async () => {
    const bad = await client.callTool({ name: 'what_if', arguments: { ...SAMPLE_REQUEST, change: { kind: 'put_down', key: 'HB-101' } } });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent).toMatchObject({ errors: [{ code: 'not-a-zombie', subject: 'HB-101' }] });
    const noZone = await client.callTool({ name: 'solve_freeze', arguments: { ...SAMPLE_REQUEST, freezeAt: '2026-11-20T18:00' } });
    expect(noZone.isError).toBe(true);
    expect(noZone.structuredContent).toMatchObject({ errors: [{ code: 'bad-time' }] });
    const schema = await client.callTool({ name: 'solve_freeze', arguments: { board: { source: 'nowhere' } } });
    expect(schema.isError).toBe(true);
    const after = await client.callTool({ name: 'solve_freeze', arguments: SAMPLE_REQUEST });
    expect(after.isError).toBeFalsy();
  });
});
