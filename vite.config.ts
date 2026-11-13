import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { CSP_POLICY } from './build/csp.ts';

/** Writes the Content Security Policy into `index.html` in the production build only (the dev server needs inline code for hot reload). */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'deadline-seance-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP_POLICY }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  // Relative paths, so the build works from any folder of a static host (a GitHub Pages project site lives under /<repo>/).
  base: './',
  build: {
    // A font or image is never turned into a `data:` URL: the policy does not allow `data:` in `font-src` or `img-src`.
    assetsInlineLimit: 0,
  },
  plugins: [contentSecurityPolicy()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Vitest turns CSS files into empty strings unless told otherwise; the scan tests read the real text of the stylesheets.
    css: { include: [/.+/] },
    // Property tests run hundreds of cases; the default 5 s is too tight on a slow or busy machine.
    testTimeout: 30_000,
  },
});
