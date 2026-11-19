import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsDir: 'assets',
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
