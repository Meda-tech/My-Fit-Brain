import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Server modules import 'server-only', which throws outside a React Server Components bundle; in tests it
// resolves to the package's empty module.
export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('../node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
