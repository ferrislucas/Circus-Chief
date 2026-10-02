import { execFile as execFileCallback } from 'node:child_process';
import { statSync as defaultStatSync } from 'node:fs';
import { promisify } from 'node:util';
import { DEFAULT_TIMEOUTS } from './museTimeouts.js';
import { logMuseLifecycle } from './museLifecycle.js';

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
 * Parse a `major.minor.patch` prefix out of a version string (prerelease
 * and build suffixes are ignored for compatibility purposes).
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
export function parseMuseSemver(version) {
  const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Pure version-acceptance rule for the CLI↔SDK preflight (finding #3).
 * Auto-updated CLIs must not brick every Muse turn: a newer (or older)
 * minor/patch under the same major is accepted with a warning, while a
 * major jump — or an unparseable version — still hard-fails.
 *
 * @param {string} cliVersion - Resolved `muse --version` (may be null/unknown).
 * @param {string} sdkVersion - Pinned `@muse-code/sdk` version.
 * @returns {{ compatible: boolean, drift: 'match' | 'minor-drift' | 'major-mismatch' | 'unknown' }}
 */
export function isMuseCliCompatible(cliVersion, sdkVersion) {
  const cli = parseMuseSemver(cliVersion);
  const sdk = parseMuseSemver(sdkVersion);
  if (!cli || !sdk) return { compatible: false, drift: 'unknown' };
  if (cli.major !== sdk.major) return { compatible: false, drift: 'major-mismatch' };
  if (cli.minor !== sdk.minor || cli.patch !== sdk.patch) {
    return { compatible: true, drift: 'minor-drift' };
  }
  return { compatible: true, drift: 'match' };
}

function reportVersionDrift({ context, cliVersion, sdkVersion, phase }) {
  logMuseLifecycle({
    correlationId: context?.correlationId || 'preflight',
    hostPid: 'preflight',
    sdkVersion,
    cliVersion: cliVersion || 'unknown',
    timings: context?.timings || {},
    phase,
  });
}

function buildVersionMismatchError(cliVersion, sdkVersion, drift) {
  const error = new Error(`Muse CLI/SDK version mismatch (${drift}): CLI ${cliVersion || 'unknown'} is not compatible with @muse-code/sdk ${sdkVersion}. Install Muse Code ${sdkVersion} and set MUSE_BIN to that executable, or set MUSE_ALLOW_VERSION_DRIFT=1 to proceed anyway (unsupported).`);
  error.code = 'MUSE_VERSION_MISMATCH';
  error.cliVersion = cliVersion || null;
  error.sdkVersion = sdkVersion;
  return error;
}

/**
 * CLI↔SDK compatibility preflight run before a `muse serve` host may open
 * an MSP session (finding #3). Extracted from the adapter so the adapter
 * stays under the repo's size/complexity gates; the adapter's
 * `_preflightMuseCompatibility` delegates here.
 *
 * Same-major minor/patch drift warns and proceeds (CLI auto-updates must
 * not brick turns); major jumps and unknown versions hard-fail with an
 * actionable error unless `MUSE_ALLOW_VERSION_DRIFT=1` is set.
 *
 * @param {Object} args
 * @param {string} args.museBin - Binary path (or PATH launcher name).
 * @param {boolean} args.skipProbe - Skip probing (pinned in-memory hosts).
 * @param {Function} [args.versionResolver] - `(museBin) => version` (tests).
 * @param {Object} [args.context] - Turn context for drift logging.
 * @param {string} args.sdkVersion - Pinned `@muse-code/sdk` version.
 * @returns {Promise<string>} Accepted CLI version.
 */
export async function preflightMuseCompatibility({ museBin, skipProbe, versionResolver, context = null, sdkVersion }) {
  if (skipProbe && !versionResolver) return sdkVersion;
  const resolver = versionResolver || readMuseCliVersion;
  const cliVersion = await resolver(museBin);
  const { compatible, drift } = isMuseCliCompatible(cliVersion, sdkVersion);
  if (compatible) {
    if (drift === 'minor-drift') {
      reportVersionDrift({ context, cliVersion, sdkVersion, phase: 'version-drift' });
      console.warn(`[MuseAdapter] Muse CLI ${cliVersion} drifted from pinned SDK ${sdkVersion} (same major); proceeding. Pin MUSE_BIN to ${sdkVersion} to silence this.`);
    }
    return cliVersion;
  }
  if (process.env.MUSE_ALLOW_VERSION_DRIFT === '1') {
    reportVersionDrift({ context, cliVersion, sdkVersion, phase: 'version-drift-override' });
    console.warn(`[MuseAdapter] MUSE_ALLOW_VERSION_DRIFT=1: proceeding despite ${drift} (CLI ${cliVersion || 'unknown'} vs SDK ${sdkVersion}).`);
    return cliVersion;
  }
  throw buildVersionMismatchError(cliVersion, sdkVersion, drift);
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
