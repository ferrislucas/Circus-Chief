import { statSync } from 'fs';
import { connect as defaultConnect } from 'net';

/**
 * SSH-agent socket liveness (Muse agent user-shell parity, FR-5).
 *
 * Split out of `loginShellEnv.js` so that file stays under the repo's size
 * gate. `loginShellEnv.js` re-exports everything here, so existing import
 * paths keep working.
 */

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

/**
 * Check whether an SSH agent socket path accepts connections (FR-5).
 * A stat-only check passes dead-but-present socket files; this connects
 * with a short timeout so a stale path is detected instead of failing
 * opaquely inside the turn. Falls back to the stat check where no
 * connect implementation is available. Never throws.
 *
 * @param {string} sockPath
 * @param {Object} [deps] - `{ statSync, connect, timeoutMs }` (tests).
 * @returns {Promise<{ alive: boolean, reason?: string }>}
 */
export function isSshAgentSocketAliveAsync(sockPath, deps = {}) {
  const stat = deps.statSync ?? statSync;
  const connectImpl = deps.connect === undefined ? defaultConnect : deps.connect;
  const timeoutMs = deps.timeoutMs ?? 500;
  if (!sockPath) {
    return Promise.resolve({ alive: false, reason: 'SSH_AUTH_SOCK is not set' });
  }
  let stats;
  try {
    stats = stat(sockPath);
  } catch (err) {
    return Promise.resolve({ alive: false, reason: `SSH agent socket not reachable at ${sockPath} (${err?.code || err?.message || 'unknown'})` });
  }
  if (!stats.isSocket()) {
    return Promise.resolve({ alive: false, reason: `SSH_AUTH_SOCK path exists but is not a socket: ${sockPath}` });
  }
  if (typeof connectImpl !== 'function') {
    return Promise.resolve({ alive: true });
  }
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(result);
    };
    const socket = connectImpl(sockPath);
    const timer = setTimeout(() => {
      done({ alive: false, reason: `SSH agent socket did not accept a connection at ${sockPath} within ${timeoutMs}ms` });
    }, timeoutMs);
    timer.unref?.();
    socket.once('connect', () => done({ alive: true }));
    socket.once('error', (err) => done({
      alive: false,
      reason: `SSH agent socket does not accept connections at ${sockPath} (${err?.code || err?.message || 'unknown'})`,
    }));
  });
}

/**
 * How long one async SSH-agent connect-test result is trusted (finding
 * #8). Repeat turns seconds apart must not each pay the 500ms penalty;
 * 30s is brief enough that a fixed agent is picked up promptly (and a
 * replaced socket re-probes immediately via its new mtime — see below).
 */
export const SSH_LIVENESS_CACHE_TTL_MS = 30_000;

/** Live connect-test results keyed by socket path + mtime (finding #8). */
const sshLivenessCache = new Map();

/** Clear the SSH liveness cache (tests). */
export function clearSshLivenessCache() {
  sshLivenessCache.clear();
}

function sshLivenessCacheKey(sockPath, mtimeMs) {
  return `${sockPath}::${mtimeMs ?? 'no-stat'}`;
}

function readSocketMtimeMs(sockPath, statSyncFn) {
  try {
    return statSyncFn(sockPath).mtimeMs ?? null;
  } catch {
    return null;
  }
}

/**
 * Operator-facing warning for a dropped stale agent socket (finding #13):
 * a session retry alone cannot fix it — the server process must be
 * re-spawned from a shell with a live agent.
 * @param {string} droppedReason - Probe reason the socket was dropped.
 * @returns {string}
 */
export function staleSshSocketMessage(droppedReason) {
  return `${droppedReason}. SSH git remotes and SSH commit signing will fail; retrying the session is not enough — `
    + 'run `ssh-add -l` in your terminal and relaunch the server from there so it re-spawns with a live agent socket.';
}

/**
 * Async variant of filterDeadSshSocket using the connect-test so a
 * dead-but-present socket file is dropped instead of passed through.
 * Never throws; live sockets and unset values pass through untouched.
 *
 * The connect-test result is cached briefly, keyed by socket path + mtime
 * (finding #8): consecutive turns with an unchanged socket pay the 500ms
 * penalty once. A replaced socket (new mtime) or an expired entry
 * re-probes, so the drop-and-warn behavior still fires on state change.
 *
 * @param {Object} env
 * @param {Function} [probe] - Async liveness probe (tests).
 * @param {Object} [opts] - `{ statSync, ttlMs }` overrides (tests).
 * @returns {Promise<{ env: Object, droppedReason: string|null }>}
 */
export async function filterDeadSshSocketAsync(env, probe = isSshAgentSocketAliveAsync, opts = {}) {
  const sockPath = env?.SSH_AUTH_SOCK;
  if (!sockPath) return { env, droppedReason: null };
  const statSyncFn = opts.statSync ?? statSync;
  const ttlMs = opts.ttlMs ?? SSH_LIVENESS_CACHE_TTL_MS;
  const mtimeMs = readSocketMtimeMs(sockPath, statSyncFn);
  const key = sshLivenessCacheKey(sockPath, mtimeMs);
  const now = Date.now();
  const cached = sshLivenessCache.get(key);
  let result;
  if (cached && now - cached.at < ttlMs) {
    result = cached.result;
  } else {
    result = await probe(sockPath);
    sshLivenessCache.set(key, { result, at: now });
    if (sshLivenessCache.size > 100) sshLivenessCache.clear();
  }
  if (result.alive) return { env, droppedReason: null };
  const next = { ...env };
  delete next.SSH_AUTH_SOCK;
  return { env: next, droppedReason: result.reason };
}
