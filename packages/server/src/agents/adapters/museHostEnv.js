import { createRobustEnv } from '../../services/nodeSpawnHelper.js';
import { filterDeadSshSocket, staleSshSocketMessage } from '../../services/loginShellEnv.js';

/**
 * Build the env for the owned `muse exec` child so shell tools (git, gh and
 * friends) resolve the same binaries, config, and credentials as when the
 * user runs them directly. Session env wins over the host process env;
 * HOME/USER/LOGNAME fallbacks and well-known bin dirs fill the gaps left by
 * sparse server launch contexts.
 *
 * Finding #6 (single construction point per turn): the env is built exactly
 * once per turn (sessionProvider → adapter) and passed verbatim to the
 * exec spawn. This builder is idempotent (re-applying never duplicates the
 * node bin dir or user bin dirs; explicit PATH order is never rewritten),
 * but callers must not re-apply it defensively: the SSH-socket liveness
 * filter is the async cached connect-test in the adapter, one probe per
 * turn.
 *
 * @param {Object} [sessionEnv] - Session env from buildSessionEnv (wins)
 * @param {Object} [baseEnv] - Host env filling the gaps (defaults to process.env)
 * @param {Object} [opts] - Optional `{ shellEnv }` forwarded to createRobustEnv
 *   (fixture injection for tests; undefined runs the cached live probe),
 *   `{ isSshAgentAlive }` liveness predicate override (tests; default stats
 *   the socket path), and `{ skipSshFilter }` — when true the sync-stat
 *   socket filter is skipped because the caller runs the cached async
 *   connect-test instead, so only one liveness probe exists per turn
 *   (finding #8; used by the adapter, which builds the host env inline in
 *   `execute` and filters via `filterDeadSshSocketAsync`).
 * @returns {Object}
 */
export function buildMuseHostEnv(sessionEnv = {}, baseEnv = process.env, opts = {}) {
  const robust = createRobustEnv({ ...baseEnv, ...(sessionEnv || {}) }, opts);
  if (opts.skipSshFilter) return robust;
  // FR-5: a stale agent socket must never be passed through silently — SSH
  // remotes/signing would fail opaquely inside the turn. Drop it and say why.
  const { env, droppedReason } = filterDeadSshSocket(
    robust,
    opts.isSshAgentAlive ? (sockPath) => opts.isSshAgentAlive(sockPath) : undefined,
  );
  if (droppedReason) {
    console.warn(`[MuseExecAdapter] ${staleSshSocketMessage(droppedReason)}`);
  }
  return env;
}
