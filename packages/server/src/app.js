import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './api/index.js';
import { createBasicAuthMiddleware } from './middleware/basicAuth.js';
import { MAX_JSON_SIZE } from '@circuschief/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create Express application
 * @param {Object} options
 * @param {boolean} options.production - Enable production mode
 * @param {{ username: string, password: string }|null} options.auth - Basic auth credentials
 * @returns {express.Application}
 */
export function createApp(options = {}) {
  const app = express();

  // CORS — allow Authorization header when auth is enabled for preflight
  if (options.auth) {
    app.use(cors({
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));
  } else {
    app.use(cors());
  }

  // Body parsing
  app.use(express.json({ limit: MAX_JSON_SIZE }));
  app.use(express.urlencoded({ extended: true, limit: MAX_JSON_SIZE }));

  // Multipart form data parsing is handled per-route with specific middleware
  // to avoid conflicts between upload.single() and upload.array() across different endpoints

  // Auth middleware — protects API routes only, not static files or SPA fallback
  const authMiddleware = createBasicAuthMiddleware(options.auth);

  // API routes
  app.use('/api', authMiddleware, apiRouter);

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
