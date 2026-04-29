import { timingSafeEqual } from 'crypto';

/**
 * Create HTTP Basic Authentication middleware.
 *
 * When no credentials are configured, returns a pass-through middleware.
 * When credentials are configured, validates the Authorization: Basic header.
 *
 * Uses 'xBasic' scheme in WWW-Authenticate to suppress the browser's native
 * auth dialog, allowing the frontend to show its own styled login form.
 *
 * Token comparison uses crypto.timingSafeEqual to prevent timing attacks.
 *
 * @param {{ username: string, password: string }|null} credentials
 * @returns {import('express').RequestHandler}
 */
export function createBasicAuthMiddleware(credentials) {
  // No credentials configured — pass through
  if (!credentials) {
    return (_req, _res, next) => next();
  }

  // Pre-compute the expected base64 token as a Buffer for constant-time comparison
  const expectedBuffer = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');

  return (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.setHeader('WWW-Authenticate', 'xBasic realm="Circus Chief"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Expect "Basic <base64>"
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Basic') {
      res.setHeader('WWW-Authenticate', 'xBasic realm="Circus Chief"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Constant-time comparison to prevent timing attacks
    const providedBuffer = parts[1];
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(Buffer.from(providedBuffer), Buffer.from(expectedBuffer))
    ) {
      res.setHeader('WWW-Authenticate', 'xBasic realm="Circus Chief"');
      return res.status(401).json({ error: 'Authentication required' });
    }

    next();
  };
}
