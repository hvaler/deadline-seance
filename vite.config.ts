import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Property tests run hundreds of cases; the default 5 s is too tight on a slow or busy machine.
    testTimeout: 30_000,
  },
});
