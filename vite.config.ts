import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import netlifyPlugin from '@netlify/vite-plugin';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react(), netlifyPlugin()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
