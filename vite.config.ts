import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Vitest turns CSS files into empty strings unless told otherwise; the scan tests read the real text of the stylesheets.
    // Vitest turns CSS files into empty strings unless told otherwise; the scan tests read the real text of the stylesheets.
    css: { include: [/.+/] },
    // Property tests run hundreds of cases; the default 5 s is too tight on a slow or busy machine.
    testTimeout: 30_000,
  },
});
