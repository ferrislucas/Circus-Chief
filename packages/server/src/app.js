import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './api/index.js';
import { createAuthMiddleware } from './middleware/basicAuth.js';
import { MAX_JSON_SIZE } from '@circuschief/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create Express application
 * @param {Object} options
 * @param {boolean} options.production - Enable production mode
 * @param {{ users: Map<string,string> }|null} [options.auth] - Loaded Basic-auth
 *   config (null/omitted = auth disabled, behavior unchanged). When set, every
 *   request requires valid credentials except GET /api/server-info, which
 *   stays open so port-probing tooling (pw.sh) works without credentials.
 * @returns {express.Application}
 */
export function createApp(options = {}) {
  const app = express();

  // CORS (allow all in dev)
  app.use(cors());

  // Body parsing
  app.use(express.json({ limit: MAX_JSON_SIZE }));
  app.use(express.urlencoded({ extended: true, limit: MAX_JSON_SIZE }));

  // Multipart form data parsing is handled per-route with specific middleware
  // to avoid conflicts between upload.single() and upload.array() across different endpoints

  // Optional Basic auth: mounted before the API router AND before production
  // static serving so the frontend is gated too when auth is enabled.
  if (options.auth) {
    const authMiddleware = createAuthMiddleware(options.auth);
    app.use((req, res, next) => {
      if (req.method === 'GET' && req.path === '/api/server-info') return next();
      authMiddleware(req, res, next);
    });
  }

  // API routes
  app.use('/api', apiRouter);

  // Static files and SPA fallback (production only - in dev, Vite serves frontend)
  if (options.production) {
    const staticPath = join(__dirname, '../../web/dist');
    app.use(express.static(staticPath));

    // SPA fallback for client-side routing
    app.get('/*', (_req, res) => {
      res.sendFile(join(staticPath, 'index.html'));
    });
  }

  // Error handler
  app.use((err, _req, res, _next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}
