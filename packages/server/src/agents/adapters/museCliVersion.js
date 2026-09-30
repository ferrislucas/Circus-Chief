import { execFile as execFileCallback } from 'node:child_process';
import { statSync as defaultStatSync } from 'node:fs';
import { promisify } from 'node:util';
import { DEFAULT_TIMEOUTS } from './museTimeouts.js';

const execFile = promisify(execFileCallback);

/**
 * Cache of `muse --version` results keyed by binary path. The preflight
 * used to shell out once per turn; now a cached version is reused until
 * the binary's mtime changes (i.e. an upgrade/reinstall happened).
 */
const cliVersionCache = new Map();

/** Clear the CLI version cache (tests). */
export function clearMuseCliVersionCache() {
  cliVersionCache.clear();
}

/**
 * Resolve the Muse CLI version for one binary path, re-probing only when
 * the binary changed on disk since the last probe.
 *
 * @param {string} museBin - Binary path (or PATH launcher name).
 * @param {Object} [deps] - `{ statSync, execFile }` (fixture injection for tests).
 */
export async function readMuseCliVersion(museBin, deps = {}) {
  const stat = deps.statSync ?? defaultStatSync;
  const exec = deps.execFile ?? execFile;
  let mtimeMs = null;
  try {
    mtimeMs = stat(museBin).mtimeMs;
  } catch {
    /* Unresolvable path (e.g. a PATH launcher): probe without caching. */
  }
  const cached = cliVersionCache.get(museBin);
  if (cached && cached.mtimeMs !== null && cached.mtimeMs === mtimeMs) return cached.version;
  const { stdout } = await exec(museBin, ['--version'], { timeout: DEFAULT_TIMEOUTS.startupMs, windowsHide: true });
  const match = String(stdout).match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
  if (!match) {
    const error = new Error(`Could not determine Muse CLI version from ${museBin} --version output.`);
    error.code = 'MUSE_CLI_VERSION_UNKNOWN';
    throw error;
  }
  cliVersionCache.set(museBin, { mtimeMs, version: match[1] });
  return match[1];
}
