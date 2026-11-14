import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The server as one file: the SDK, zod and the engine are bundled into dist-mcp/server.mjs, so it runs with no node_modules.
// This config is separate from the web app's `vite.config.ts` on purpose: nothing here can reach `dist/`.
const root = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  root,
  publicDir: false,
  define: { __SERVER_VERSION__: JSON.stringify(pkg.version) },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: 'mcp/server.ts',
    outDir: 'dist-mcp',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'server.mjs' } },
  },
});
