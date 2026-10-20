import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
