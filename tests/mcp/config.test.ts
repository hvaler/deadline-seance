import { describe, expect, test } from 'vitest';
import config from '../../.kiro/settings/mcp.json';
import { READ_ONLY, TOOLS, TOOL_NAMES } from '../../mcp/tools';

describe('MCP: the workspace config and the tool declarations', () => {
  const server = config.mcpServers['deadline-seance'];

  test('.kiro/settings/mcp.json starts the server with node and a relative path', () => {
    expect(Object.keys(config.mcpServers)).toEqual(['deadline-seance']);
    expect(server.command).toBe('node');
    expect(server.args).toEqual(['mcp/start.mjs']);
    expect(server.disabled).toBe(false);
  });

  test('the config has no secret, no environment and no absolute path', () => {
    const text = JSON.stringify(config);
    expect(text).not.toMatch(/"env"|token|secret|password|api[_-]?key/i);
    expect(text).not.toMatch(/[A-Za-z]:[\\/]|"\/[^"]|\\\\/);
    expect('cwd' in server).toBe(false);
  });

  test('only the three read-only tools are auto-approved', () => {
    expect([...server.autoApprove].sort()).toEqual([...TOOL_NAMES].sort());
  });

  test('there are three tools, each with a title, a description and the read-only, idempotent, closed-world annotations', () => {
    expect(TOOL_NAMES).toEqual(['solve_freeze', 'what_if', 'death_certificate']);
    for (const name of TOOL_NAMES) {
      expect(TOOLS[name].title.length).toBeGreaterThan(3);
      expect(TOOLS[name].description.length).toBeGreaterThan(40);
    }
    expect(READ_ONLY).toEqual({ readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false });
  });
});
