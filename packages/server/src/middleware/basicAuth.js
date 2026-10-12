import { readFileSync, statSync, watch, existsSync } from 'fs';
import bcrypt from 'bcryptjs';
import { getDefaultAuthFilePath } from '../config.js';

export const AUTH_REALM = 'Circus Chief';

// Compared when the username is unknown so the unknown-user and
// wrong-password paths cost the same shape (no user oracle).
const DUMMY_HASH = bcrypt.hashSync('circus-chief-invalid-credential', 4);

const BCRYPT_HASH_RE = /^\$2[by]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * Parse htpasswd-compatible `user:bcrypt-hash` file contents.
 * Blank lines and `#` comments are ignored. Anything else malformed —
 * including an empty user set — throws fail-closed with the line number.
 * Only `$2b$`/`$2y$` hashes are accepted (what `htpasswd -B` emits).
 * @param {string} contents - Raw file contents.
 * @returns {Map<string, string>} username → bcrypt hash.
 */
export function parseHtpasswd(contents) {
  const users = new Map();
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const line = lines[i].trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) {
      throw new Error(`Malformed auth file at line ${lineNumber}: expected "user:bcrypt-hash".`);
    }
    const user = line.slice(0, colon);
    const hash = line.slice(colon + 1);
    if (!BCRYPT_HASH_RE.test(hash)) {
      throw new Error(`Malformed auth file at line ${lineNumber}: not a bcrypt ($2b$/$2y$) hash.`);
    }
    if (users.has(user)) {
      throw new Error(`Malformed auth file at line ${lineNumber}: duplicate user "${user}".`);
    }
    users.set(user, hash);
  }
  if (users.size === 0) {
    throw new Error('Malformed auth file: no users defined (refusing to serve open).');
  }
  return users;
}

function checkPermissions(filePath) {
  try {
    const mode = statSync(filePath).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      console.warn(
        `Warning: auth file ${filePath} has permissions ${mode.toString(8)}; ` +
        'consider chmod 600 so only the owner can read it.'
      );
    }
  } catch {
    // Permissions are advisory only — never block startup on a stat failure.
  }
}

/**
 * Load and watch an htpasswd file. The watcher hot-reloads credentials so
 * passwords rotate without a restart; watcher errors only log.
 * @param {string} filePath - Path to the htpasswd file.
 * @returns {{ users: Map<string,string>, path: string, reload: Function, close: Function }}
 */
export function loadAuthConfig(filePath) {
  let stat;
  try {
    stat = statSync(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      const missing = new Error(`Auth file not found: ${filePath}. Create it or relaunch without --auth.`);
      missing.code = 'AUTH_FILE_MISSING';
      throw missing;
    }
    throw err;
  }
  if (stat.isDirectory()) {
    throw new Error(`Auth file is a directory: ${filePath}. Expected an htpasswd file.`);
  }

  checkPermissions(filePath);

  const state = { users: parseHtpasswd(readFileSync(filePath, 'utf-8')) };

  const reload = () => {
    try {
      state.users = parseHtpasswd(readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error(`Auth file reload failed (${filePath}); keeping previous credentials: ${err.message}`);
    }
  };

  let watcher = null;
  try {
    watcher = watch(filePath, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') reload();
    });
    watcher.unref();
    watcher.on('error', (err) => {
      console.error(`Auth file watcher error (${filePath}): ${err.message}`);
    });
  } catch (err) {
    console.error(`Auth file watcher unavailable (${filePath}): ${err.message}`);
  }

  return {
    path: filePath,
    get users() {
      return state.users;
    },
    reload,
    close() {
      watcher?.close();
      watcher = null;
    },
  };
}

/**
 * Verify an HTTP `Authorization` header against loaded users.
 * @param {Map<string,string>} users - username → bcrypt hash.
 * @param {string|undefined} header - Raw Authorization header value.
 * @returns {Promise<string|null>} username on success, null otherwise.
 */
export async function verifyBasicHeader(users, header) {
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return null;
  const encoded = header.slice('Basic '.length).trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded === '') return null;
  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  } catch {
    return null;
  }
  const colon = decoded.indexOf(':');
  if (colon <= 0) return null;
  const user = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  const hash = users.get(user) ?? DUMMY_HASH;
  let ok;
  try {
    ok = await bcrypt.compare(password, hash);
  } catch {
    return null;
  }
  if (!ok || !users.has(user)) return null;
  return user;
}

function unauthorized(res) {
  res.set('WWW-Authenticate', `Basic realm="${AUTH_REALM}"`);
  res.status(401).json({ error: 'Unauthorized' });
}

/**
 * Build the Basic-auth Express middleware. A null config returns a
 * pass-through (auth disabled — mount behavior unchanged).
 * @param {{ users: Map<string,string> }|null} authConfig
 */
export function createAuthMiddleware(authConfig) {
  if (!authConfig) {
    return (_req, _res, next) => next();
  }
  return async (req, res, next) => {
    try {
      const user = await verifyBasicHeader(authConfig.users, req.headers.authorization);
      if (!user) {
        unauthorized(res);
        return;
      }
      req.authUser = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Resolve startup auth state from CLI options. Disabled → null without
 * touching the filesystem (but warns if the default file exists
 * unrequested). Enabled with a missing/unreadable/malformed file → throws
 * (the entry point logs and exits 1 before any side effects).
 * @param {{ authEnabled: boolean, authFile: string|null }} options
 */
export function resolveStartupAuth({ authEnabled, authFile }) {
  if (!authEnabled) {
    if (existsSync(getDefaultAuthFilePath())) {
      console.warn('Warning: auth file present but --auth not given; serving without auth.');
    }
    return null;
  }
  return loadAuthConfig(authFile ?? getDefaultAuthFilePath());
}
