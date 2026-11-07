import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) } },
  test: {
    setupFiles: ['web/tests/browser-env.ts'],
    // Local backups and experiments may contain copied tests; only discover application tests.
    include: ['{server,web,qa}/**/*.{test,spec}.{ts,tsx}'],
  },
});
