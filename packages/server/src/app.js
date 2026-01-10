import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './api/index.js';
import { MAX_JSON_SIZE } from '@claudetools/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

  // Body parsing
  app.use(express.json({ limit: MAX_JSON_SIZE }));
  app.use(express.urlencoded({ extended: true, limit: MAX_JSON_SIZE }));

  // Multipart form data parsing is handled per-route with specific middleware
  // to avoid conflicts between upload.single() and upload.array() across different endpoints

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
