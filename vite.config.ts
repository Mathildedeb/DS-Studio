import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./app/client', import.meta.url)) },
  },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1' },
});
