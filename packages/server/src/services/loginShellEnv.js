import { spawnSync as defaultSpawnSync } from 'child_process';
import { statSync } from 'fs';

/**
 * Login-shell environment derivation (Muse agent user-shell parity).
 *
 * The server process env is a snapshot taken at launch. When Circus Chief
 * runs in a sparse launch context (GUI app, launchd daemon, container), that
 * snapshot lacks entries that only exist in the user's interactive login
 * shell: dotfile-configured PATH entries, SSH_AUTH_SOCK, user-exported
 * tokens, version-manager shims. The owned `muse serve` host replaces (not
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
 * @param {Object} [opts]
 * @param {string} [opts.shell] - Defaults to $SHELL, then /bin/sh.
 * @param {number} [opts.timeoutMs] - Per-dump budget (default 2000ms).
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
    const nul = attemptDump({ shell: loginShell, dumpCommand: 'env -0', timeoutMs, spawnSync, parse: parseEnvZero });
    if (nul.env) return { ok: true, env: nul.env };
    const lines = attemptDump({ shell: loginShell, dumpCommand: 'printenv', timeoutMs, spawnSync, parse: parseEnvLines });
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
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
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

/**
 * Check whether an SSH agent socket path is live (FR-5). Sync stat test:
 * the path must exist and be a socket. Never throws.
 * @param {string} sockPath
 * @returns {{ alive: boolean, reason?: string }}
 */
export function isSshAgentSocketAlive(sockPath, deps = {}) {
  const stat = deps.statSync ?? statSync;
  if (!sockPath) {
    return { alive: false, reason: 'SSH_AUTH_SOCK is not set' };
  }
  try {
    const stats = stat(sockPath);
    if (!stats.isSocket()) {
      return { alive: false, reason: `SSH_AUTH_SOCK path exists but is not a socket: ${sockPath}` };
    }
    return { alive: true };
  } catch (err) {
    return { alive: false, reason: `SSH agent socket not reachable at ${sockPath} (${err?.code || err?.message || 'unknown'})` };
  }
}

/**
 * Drop a stale SSH_AUTH_SOCK from a host env instead of passing it through
 * silently (FR-5). Returns the (possibly new) env plus the drop reason.
 * Never throws; live sockets and unset values pass through untouched.
 * @param {Object} env
 * @returns {{ env: Object, droppedReason: string|null }}
 */
export function filterDeadSshSocket(env, isAlive = isSshAgentSocketAlive) {
  const sockPath = env?.SSH_AUTH_SOCK;
  if (!sockPath) return { env, droppedReason: null };
  const probe = isAlive(sockPath);
  if (probe.alive) return { env, droppedReason: null };
  const next = { ...env };
  delete next.SSH_AUTH_SOCK;
  return { env: next, droppedReason: probe.reason };
}
