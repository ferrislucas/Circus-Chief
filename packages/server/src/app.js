import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createProxyMiddleware } from 'http-proxy-middleware';
import apiRouter from './api/index.js';
import { MAX_JSON_SIZE, DEFAULT_WEB_PORT } from '@claudetools/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Store vite proxy for WebSocket upgrade handling
let viteProxy = null;

export function getViteProxy() {
  return viteProxy;
}

/**
 * Create Express application
 * @param {Object} options
 * @param {boolean} options.production - Enable production mode
 * @returns {express.Application}
 */
export function createApp(options = {}) {
  const app = express();

  // CORS (allow all in dev)
  app.use(cors());

  // Request logging (dev only)
  if (!options.production) {
    app.use((req, _res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  // Body parsing ONLY for API routes (JSON with 50MB limit for base64 images)
  app.use('/api', express.json({ limit: MAX_JSON_SIZE }));
  app.use('/api', express.urlencoded({ extended: true, limit: MAX_JSON_SIZE }));

  // API routes
  app.use('/api', apiRouter);

  // Static files and SPA fallback (production)
  if (options.production) {
    const staticPath = join(__dirname, '../../web/dist');
    app.use(express.static(staticPath));

    // SPA fallback for client-side routing
    app.get('/*', (_req, res) => {
      res.sendFile(join(staticPath, 'index.html'));
    });
  } else {
    // Development: proxy all non-API requests to Vite dev server
    viteProxy = createProxyMiddleware({
      target: `http://localhost:${DEFAULT_WEB_PORT}`,
      changeOrigin: true,
      ws: true,
    });
    app.use(viteProxy);
  }

  // Error handler
  app.use((err, _req, res, _next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}
