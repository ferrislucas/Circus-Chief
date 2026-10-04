import { execFile as execFileCallback, spawnSync as defaultSpawnSync } from 'child_process';
import { promisify } from 'util';

const defaultExecFile = promisify(execFileCallback);

/**
 * Login-shell environment derivation (Muse agent user-shell parity).
 *
 * The server process env is a snapshot taken at launch. When Circus Chief
 * runs in a sparse launch context (GUI app, launchd daemon, container), that
 * snapshot lacks entries that only exist in the user's interactive login
 * shell: dotfile-configured PATH entries, SSH_AUTH_SOCK, user-exported
 * tokens, version-manager shims. The owned `muse exec` child replaces (not
 * inherits) its environment, so whatever is missing here is invisible to
 * every tool the agent shells out to.
 *
 * This module probes the user's login shell once per process lifetime
 * (`$SHELL -lic 'env -0'`; `env -0` is used instead of `printenv -0` because
 * the BSD userland on macOS rejects `-0` for printenv while `env -0` works
 * on both BSD and GNU, verified by spike 2026-09-27: ~1s, under the 2s
 * budget) and merges the result UNDER explicit values (FR-10 precedence:
 * login-shell baseline < server process env < session env < provider
 * additionalEnvVars).
 *
 * Only allowlisted keys propagate (Risk R-1). Anything already set
 * explicitly is never overwritten, and explicit PATH order is never
 * rewritten: shell-only entries are appended after the explicit entries.
 */

export const LOGIN_SHELL_TIMEOUT_MS = 2000;
export const LOGIN_SHELL_DISABLE_ENV_VAR = 'CIRCUS_CHIEF_NO_LOGIN_SHELL';

/** Exact keys propagated from the login shell (plus PREFIXES below). */
const EXACT_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'EDITOR',
  'CARGO_HOME',
  'NVM_DIR',
  'NVM_BIN',
  'RBENV_ROOT',
  'GOPATH',
  'GOBIN',
  'MUSE_BIN',
]);

/** Prefixes propagated from the login shell. */
const KEY_PREFIXES = ['GIT_', 'GPG_', 'GCM_', 'NVM_', 'RBENV_'];

function isPropagatedKey(key) {
  if (EXACT_KEYS.has(key)) return true;
  return KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function splitKeyValue(entry) {
  const idx = entry.indexOf('=');
  if (idx <= 0) return null;
  return [entry.slice(0, idx), entry.slice(idx + 1)];
}

/**
 * Parse NUL-delimited `env -0` output into an object.
 * @param {Buffer|string} output
 * @returns {Object}
 */
export function parseEnvZero(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output || '');
  const env = {};
  for (const entry of text.split('\0')) {
    if (!entry) continue;
    const parsed = splitKeyValue(entry);
    if (parsed) env[parsed[0]] = parsed[1];
  }
  return env;
}

/**
 * Parse newline-delimited `printenv` fallback output into an object.
 * Values containing newlines do not survive this format; the allowlisted
 * parity keys (PATH, sockets, tokens) never contain newlines in practice.
 * @param {Buffer|string} output
 * @returns {Object}
 */
export function parseEnvLines(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output || '');
  const env = {};
  for (const entry of text.split('\n')) {
    if (!entry) continue;
    const parsed = splitKeyValue(entry);
    if (parsed) env[parsed[0]] = parsed[1];
  }
  return env;
}

function runDump({ shell, dumpCommand, timeoutMs, spawnSync }) {
  return spawnSync(shell, ['-lic', dumpCommand], {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
    encoding: 'buffer',
  });
}

function attemptDump({ shell, dumpCommand, timeoutMs, spawnSync, parse }) {
  const result = runDump({ shell, dumpCommand, timeoutMs, spawnSync });
  const failure = describeSpawnFailure(result, shell);
  if (failure) return { env: null, failure };
  const parsed = parse(result.stdout);
  if (Object.keys(parsed).length === 0) return { env: null, failure: null };
  return { env: parsed, failure: null };
}

function describeSpawnFailure(result, shell) {
  if (result?.error) {
    if (result.error?.code === 'ETIMEDOUT' || /timed out/i.test(result.error?.message || '')) {
      return `login-shell probe timed out after budget (${shell} -lic)`;
    }
    return `login-shell probe failed: ${result.error?.message || result.error}`;
  }
  if (result?.status !== 0) {
    const stderr = result?.stderr?.toString('utf8', 0, 200).trim();
    return `login-shell probe exited with status ${result?.status ?? 'unknown'}${stderr ? `: ${stderr}` : ''}`;
  }
  return null;
}

/**
 * Probe the user's login shell for its exported environment.
 * Never throws: failures resolve to `{ ok: false, reason }` (FR-13 — the
 * caller falls back to today's hardened snapshot behavior).
 *
 * Finding #7 (R-2): the `env -0` attempt and the `printenv` retry share ONE
 * overall budget — the retry gets only the time the first attempt left,
 * never a fresh full budget, so a hanging shell costs at most `timeoutMs`
 * (default ≤2s), not twice that.
 *
 * @param {Object} [opts]
 * @param {string} [opts.shell] - Defaults to $SHELL, then /bin/sh.
 * @param {number} [opts.timeoutMs] - Overall budget across both dumps (default 2000ms).
 * @param {Object} [deps] - Test seam: { spawnSync, platform }.
 * @returns {{ ok: true, env: Object } | { ok: false, reason: string }}
 */
export function probeLoginShellEnv({ shell, timeoutMs = LOGIN_SHELL_TIMEOUT_MS } = {}, deps = {}) {
  const spawnSync = deps.spawnSync ?? defaultSpawnSync;
  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') {
    return { ok: false, reason: 'login-shell probe is POSIX-only; using snapshot behavior' };
  }
  const loginShell = shell || process.env.SHELL || '/bin/sh';
  try {
    const startedAt = Date.now();
    const nul = attemptDump({ shell: loginShell, dumpCommand: 'env -0', timeoutMs, spawnSync, parse: parseEnvZero });
    if (nul.env) return { ok: true, env: nul.env };
    const remaining = Math.max(1, timeoutMs - (Date.now() - startedAt));
    const lines = attemptDump({ shell: loginShell, dumpCommand: 'printenv', timeoutMs: remaining, spawnSync, parse: parseEnvLines });
    if (lines.env) return { ok: true, env: lines.env };
    return { ok: false, reason: lines.failure || nul.failure || `login-shell probe produced no parsable entries (${loginShell} -lic)` };
  } catch (err) {
    return { ok: false, reason: `login-shell probe failed: ${err?.message || err}` };
  }
}

let cachedProbe = null;
let cacheLogged = false;

/**
 * Cached login-shell env (raw parsed output, unfiltered). Probes once per
 * process lifetime — including caching failures so a broken shell never
 * adds repeated slow probes to session startup. Respects the
 * CIRCUS_CHIEF_NO_LOGIN_SHELL=1 escape hatch (FR-13 fallback rehearsal).
 *
 * @param {Object} [opts] - Forwarded to probeLoginShellEnv on first call.
 * @param {Object} [deps] - Test seam forwarded to probeLoginShellEnv.
 * @returns {{ ok: true, env: Object } | { ok: false, reason: string }}
 */
export function getLoginShellEnv(opts = {}, deps = {}) {
  if (cachedProbe) return cachedProbe;
  if (process.env[LOGIN_SHELL_DISABLE_ENV_VAR] === '1') {
    cachedProbe = { ok: false, reason: 'login-shell probe disabled via CIRCUS_CHIEF_NO_LOGIN_SHELL=1' };
    return cachedProbe;
  }
  cachedProbe = probeLoginShellEnv(opts, deps);
  if (!cachedProbe.ok && !cacheLogged) {
    cacheLogged = true;
    console.warn(`[loginShellEnv] ${cachedProbe.reason}; falling back to server snapshot env.`);
  }
  return cachedProbe;
}

/** Clear the process-lifetime probe cache (tests and diagnostics re-probe). */
export function resetLoginShellEnvCache() {
  cachedProbe = null;
  cacheLogged = false;
}

/**
 * Async budget for one `execFile` login-shell dump. Tighter than the sync
 * 2s-per-dump budget: the diagnostics endpoint re-probe must stay well
 * under the 2s×2 sync cost AND off the event loop (finding #6).
 */
export const LOGIN_SHELL_ASYNC_TIMEOUT_MS = 1000;

function describeExecFailure(err, shell) {
  const message = err?.message || String(err);
  if (err?.killed || /timed out/i.test(message)) {
    return `login-shell probe timed out after budget (${shell} -lic)`;
  }
  if (typeof err?.code === 'number') {
    const stderr = String(err?.stderr || '').slice(0, 200).trim();
    return `login-shell probe exited with status ${err.code}${stderr ? `: ${stderr}` : ''}`;
  }
  return `login-shell probe failed: ${message}`;
}

async function attemptDumpAsync({ shell, dumpCommand, timeoutMs, exec, parse }) {
  try {
    const { stdout } = await exec(shell, ['-lic', dumpCommand], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const parsed = parse(stdout);
    if (Object.keys(parsed).length === 0) return { env: null, failure: null };
    return { env: parsed, failure: null };
  } catch (err) {
    return { env: null, failure: describeExecFailure(err, shell) };
  }
}

/**
 * Async variant of {@link probeLoginShellEnv} for the diagnostics endpoint
 * re-probe (finding #6): same `env -0` → `printenv` fallback and the same
 * parsers, but spawned with `execFile` so a slow shell never blocks the
 * event loop, and with a tighter per-dump budget. Never throws: failures
 * resolve to `{ ok: false, reason }`, same as the sync probe.
 *
 * The cached sync probe stays the path for startup/turn code; this is only
 * for on-demand (re-)probes that must not stall concurrent requests.
 *
 * @param {Object} [opts]
 * @param {string} [opts.shell] - Defaults to $SHELL, then /bin/sh.
 * @param {number} [opts.timeoutMs] - Per-dump budget (default 1000ms).
 * @param {Object} [deps] - Test seam: { execFile, platform }.
 * @returns {Promise<{ ok: true, env: Object } | { ok: false, reason: string }>}
 */
export async function probeLoginShellEnvAsync({ shell, timeoutMs = LOGIN_SHELL_ASYNC_TIMEOUT_MS } = {}, deps = {}) {
  const exec = deps.execFile ?? defaultExecFile;
  const platform = deps.platform ?? process.platform;
  if (platform === 'win32') {
    return { ok: false, reason: 'login-shell probe is POSIX-only; using snapshot behavior' };
  }
  const loginShell = shell || process.env.SHELL || '/bin/sh';
  try {
    const nul = await attemptDumpAsync({ shell: loginShell, dumpCommand: 'env -0', timeoutMs, exec, parse: parseEnvZero });
    if (nul.env) return { ok: true, env: nul.env };
    const lines = await attemptDumpAsync({ shell: loginShell, dumpCommand: 'printenv', timeoutMs, exec, parse: parseEnvLines });
    if (lines.env) return { ok: true, env: lines.env };
    return { ok: false, reason: lines.failure || nul.failure || `login-shell probe produced no parsable entries (${loginShell} -lic)` };
  } catch (err) {
    return { ok: false, reason: `login-shell probe failed: ${err?.message || err}` };
  }
}

/**
 * Re-probe the login shell off the event loop and repopulate the
 * process-lifetime cache (finding #6). Concurrent readers keep seeing the
 * previous cached value until the refresh lands. Respects the
 * CIRCUS_CHIEF_NO_LOGIN_SHELL=1 escape hatch like the sync path.
 *
 * @param {Object} [opts] - Forwarded to probeLoginShellEnvAsync on refresh.
 * @param {Object} [deps] - Test seam forwarded to probeLoginShellEnvAsync.
 * @returns {Promise<{ ok: true, env: Object } | { ok: false, reason: string }>}
 */
export async function refreshLoginShellEnvAsync(opts = {}, deps = {}) {
  if (process.env[LOGIN_SHELL_DISABLE_ENV_VAR] === '1') {
    cachedProbe = { ok: false, reason: 'login-shell probe disabled via CIRCUS_CHIEF_NO_LOGIN_SHELL=1' };
    return cachedProbe;
  }
  const result = await probeLoginShellEnvAsync(opts, deps);
  cachedProbe = result;
  if (!result.ok && !cacheLogged) {
    cacheLogged = true;
    console.warn(`[loginShellEnv] ${result.reason}; falling back to server snapshot env.`);
  }
  return result;
}

function mergePath(explicitPath, shellPath, separator) {
  const explicitParts = String(explicitPath || '').split(separator).filter(Boolean);
  const seen = new Set(explicitParts);
  const shellOnly = String(shellPath || '').split(separator).filter((part) => part && !seen.has(part));
  return [...explicitParts, ...shellOnly].join(separator);
}

/**
 * Merge login-shell-derived values UNDER explicit baseEnv values (FR-10).
 * Explicit entries are never overwritten, reordered, or dropped; shell-only
 * PATH entries are appended after the explicit entries without duplication,
 * so re-merging is idempotent. Only allowlisted keys propagate (R-1).
 *
 * Finding #11 (FR-3/FR-10): an explicit empty string IS a set value — the
 * user cleared the variable on purpose — so only `undefined`/`null` count
 * as gaps for non-PATH keys. PATH stays special: an empty PATH is a launch
 * artifact, not a choice, and is still filled from the shell (and
 * `buildUserCredentialEnv` continues to backfill HOME).
 *
 * @param {Object} args
 * @param {Object} [args.shellEnv] - Raw login-shell env (probe output or fixture).
 * @param {Object} [args.baseEnv] - Explicit env (wins over shellEnv).
 * @returns {Object} New object; inputs are not mutated.
 */
export function mergeShellEnv({ shellEnv = {}, baseEnv = {} } = {}) {
  const merged = { ...baseEnv };
  const separator = process.platform === 'win32' ? ';' : ':';
  for (const [key, value] of Object.entries(shellEnv || {})) {
    if (value === undefined || value === null) continue;
    if (!isPropagatedKey(key)) continue;
    if (key === 'PATH') continue;
    if (merged[key] === undefined || merged[key] === null) {
      merged[key] = String(value);
    }
  }
  const mergedPath = mergeShellPath(merged.PATH, shellEnv?.PATH, separator);
  if (mergedPath !== undefined) merged.PATH = mergedPath;
  return merged;
}

function mergeShellPath(explicitPath, shellPath, separator) {
  if (typeof shellPath !== 'string' || !shellPath) return explicitPath;
  if (explicitPath === undefined || explicitPath === null || explicitPath === '') return shellPath;
  return mergePath(explicitPath, shellPath, separator);
}

// SSH-agent socket liveness lives in sshAgentSocket.js (split out so this
// file stays under the repo's size gate); re-exported here so existing
// import paths keep working.
export {
  isSshAgentSocketAlive,
  filterDeadSshSocket,
  isSshAgentSocketAliveAsync,
  SSH_LIVENESS_CACHE_TTL_MS,
  clearSshLivenessCache,
  staleSshSocketMessage,
  filterDeadSshSocketAsync,
} from './sshAgentSocket.js';
