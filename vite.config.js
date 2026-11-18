import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// In local dev, serve /api/* with the same handler Vercel runs (server/api/handler.js).
function localApi() {
  return {
    name: 'editflow-local-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        try {
          const mod = await import(pathToFileURL(path.resolve(__dirname, 'server/api/handler.js')).href);
          await mod.default(req, res);
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        }
      });
    },
  };
}

export default defineConfig({
  root: 'client',
  envDir: '..',
  plugins: [react(), localApi()],
  resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  server: { port: 5173, fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 900 },
});
