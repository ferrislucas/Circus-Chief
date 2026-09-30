import { createRobustEnv } from '../../services/nodeSpawnHelper.js';
import { filterDeadSshSocket } from '../../services/loginShellEnv.js';

/**
 * Build the env for the owned `muse serve` host so shell tools (git, gh and
 * friends) resolve the same binaries, config, and credentials as when the
 * user runs them directly. Session env wins over the host process env;
 * HOME/USER/LOGNAME fallbacks and well-known bin dirs fill the gaps left by
 * sparse server launch contexts. Safe to apply at both the adapter boundary
 * and the live spawn (user entries are never reordered or dropped).
 *
 * @param {Object} [sessionEnv] - Session env from buildSessionEnv (wins)
 * @param {Object} [baseEnv] - Host env filling the gaps (defaults to process.env)
 * @param {Object} [opts] - Optional `{ shellEnv }` forwarded to createRobustEnv
 *   (fixture injection for tests; undefined runs the cached live probe) and
 *   `{ isSshAgentAlive }` liveness predicate override (tests; default stats
 *   the socket path).
 * @returns {Object}
 */
export function buildMuseHostEnv(sessionEnv = {}, baseEnv = process.env, opts = {}) {
  const robust = createRobustEnv({ ...baseEnv, ...(sessionEnv || {}) }, opts);
  // FR-5: a stale agent socket must never be passed through silently — SSH
  // remotes/signing would fail opaquely inside the turn. Drop it and say why.
  const { env, droppedReason } = filterDeadSshSocket(
    robust,
    opts.isSshAgentAlive ? (sockPath) => opts.isSshAgentAlive(sockPath) : undefined,
  );
  if (droppedReason) {
    console.warn(`[MuseAdapter] ${droppedReason}. SSH git remotes and SSH commit signing will fail; run \`ssh-add -l\` in your terminal and relaunch the server from there.`);
  }
  return env;
}
