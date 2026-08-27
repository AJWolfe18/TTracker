import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import netlifyPlugin from '@netlify/vite-plugin';
import { resolve } from 'path';

// The app's entire stylesheet is ~1.3KB; as a <link> it is one extra
// render-blocking round trip that delays first paint of the boot skeleton
// (ADO-568). Inline it into index.html and drop the link.
function inlineCss(): Plugin {
  return {
    name: 'tt-inline-css',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html;
      for (const [name, asset] of Object.entries(ctx.bundle)) {
        if (!name.endsWith('.css') || asset.type !== 'asset') continue;
        const link = new RegExp(`<link[^>]+href="[^"]*${asset.fileName.split('/').pop()}"[^>]*>`);
        if (!link.test(html)) continue;
        html = html.replace(link, `<style>${asset.source}</style>`);
        delete ctx.bundle[name];
      }
      return html;
    },
  };
}

export default defineConfig({
  plugins: [react(), netlifyPlugin(), inlineCss()],
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
