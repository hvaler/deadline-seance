import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { errorText } from './errors';
import type { HandlerResult } from './errors';
import { INSTRUCTIONS, READ_ONLY, TOOLS } from './tools';

/** Filled in by the build from `package.json`. Running this file without a build gives a plain placeholder. */
declare const __SERVER_VERSION__: string | undefined;
const VERSION = typeof __SERVER_VERSION__ === 'string' ? __SERVER_VERSION__ : '0.0.0';

/** The most array elements and object members one call may carry: far above the largest legal request (60 tickets, a few hundred keys). */
export const MAX_TOOL_INPUT_ELEMENTS = 20_000;

/** A handler's answer as the SDK wants it. A failure is a tool error (`isError`), never a protocol error. */
export function toToolResult(result: HandlerResult<unknown>): {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: true;
} {
  if (result.ok) return { content: [{ type: 'text', text: result.text }], structuredContent: result.structured as Record<string, unknown> };
  return { content: [{ type: 'text', text: errorText(result.errors) }], structuredContent: { errors: result.errors }, isError: true };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'deadline-seance', version: VERSION }, { instructions: INSTRUCTIONS, maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS });
  server.registerTool(
    'solve_freeze',
    { title: TOOLS.solve_freeze.title, description: TOOLS.solve_freeze.description, inputSchema: TOOLS.solve_freeze.inputSchema, outputSchema: TOOLS.solve_freeze.outputSchema, annotations: READ_ONLY },
    (args) => toToolResult(TOOLS.solve_freeze.handler(args)),
  );
  server.registerTool(
    'what_if',
    { title: TOOLS.what_if.title, description: TOOLS.what_if.description, inputSchema: TOOLS.what_if.inputSchema, outputSchema: TOOLS.what_if.outputSchema, annotations: READ_ONLY },
    (args) => toToolResult(TOOLS.what_if.handler(args)),
  );
  server.registerTool(
    'death_certificate',
    {
      title: TOOLS.death_certificate.title,
      description: TOOLS.death_certificate.description,
      inputSchema: TOOLS.death_certificate.inputSchema,
      outputSchema: TOOLS.death_certificate.outputSchema,
      annotations: READ_ONLY,
    },
    (args) => toToolResult(TOOLS.death_certificate.handler(args)),
  );
  return server;
}

// stdout is the protocol channel: everything we say goes to stderr.
serveStdio(createServer);
console.error('deadline-seance MCP ready on stdio');
