import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
