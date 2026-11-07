import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Local backups and experiments may contain copied tests; only discover application tests.
    include: ['{server,web,qa}/**/*.{test,spec}.{ts,tsx}'],
  },
});
