// Starts the MCP server: builds dist-mcp/server.mjs when a source is newer than it, then runs it.
// stdout is the protocol channel, so everything this script and the build say goes to stderr.
//   node mcp/start.mjs               build if stale, then serve over stdio
//   node mcp/start.mjs --build-only  build if stale, then stop (npm run mcp:build)
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-mcp', 'server.mjs');

/** The newest modification time (ms) among the sources the bundle is made of. */
function newestSource() {
  let newest = statSync(join(root, 'package.json')).mtimeMs;
  for (const dir of ['mcp', join('src', 'engine')]) {
    for (const entry of readdirSync(join(root, dir), { recursive: true })) {
      const name = String(entry);
      if (/\.(ts|mjs)$/.test(name)) newest = Math.max(newest, statSync(join(root, dir, name)).mtimeMs);
    }
  }
  return newest;
}

async function buildIfStale() {
  if (existsSync(out) && statSync(out).mtimeMs >= newestSource()) return false;
  const write = process.stdout.write;
  const log = console.log;
  // Nothing of the build may reach stdout.
  process.stdout.write = (...args) => process.stderr.write(...args);
  console.log = console.error;
  try {
    const { build } = await import('vite');
    await build({ root, configFile: join(root, 'mcp', 'vite.config.ts'), logLevel: 'silent' });
  } finally {
    process.stdout.write = write;
    console.log = log;
  }
  return true;
}

try {
  const built = await buildIfStale();
  if (built) console.error('deadline-seance MCP: built dist-mcp/server.mjs');
  if (process.argv.includes('--build-only')) process.exit(0);
  await import(pathToFileURL(out).href);
} catch (error) {
  console.error(`deadline-seance MCP: could not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
