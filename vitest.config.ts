import { defineConfig } from 'vitest/config';

// Unit tests cover the ported pure-logic modules (taste scoring, EQ parser, play-stats rules,
// cutoff guard, pre-arm manager). They need no DOM, so the default node environment is used.
// Browser-level behaviour is covered separately by the Playwright smoke tests in scripts/.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'scripts', '.fixtures'],
    reporters: ['default'],
  },
});
