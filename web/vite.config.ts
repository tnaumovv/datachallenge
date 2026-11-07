import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const host = '127.0.0.1';
const proxy = { '/api': process.env.CQA_API_URL ?? 'http://127.0.0.1:3000' };

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __CQA_DEMO__: 'false' },
  server: { host, proxy },
  preview: { host, proxy },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
});
