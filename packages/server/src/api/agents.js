import { Router } from 'express';
import { agentGateway } from '../agents/AgentGateway.js';
import { buildMuseHostEnv } from '../agents/adapters/MuseAdapter.js';
import { getLoginShellEnv, refreshLoginShellEnvAsync, isSshAgentSocketAliveAsync } from '../services/loginShellEnv.js';
import { buildParityCredentialError, checkParitySignals, redactEnvForDiagnostics } from '../services/parityDiagnostics.js';
import { buildSessionEnv } from '../services/sessionProvider.js';

const router = Router();

/**
 * GET /api/agents
 *
 * Returns the capabilities of every registered agent adapter, sourced from the
 * adapter's static `capabilities` field (no adapter instantiation).
 *
 * Response shape:
 *   [
 *     { agentType: 'claude-code', capabilities: { streaming, thinking, reasoningEffort, toolUse, resume } },
 *     { agentType: 'codex',       capabilities: { streaming, thinking, reasoningEffort, toolUse, resume } },
 *   ]
 */
router.get('/', (_req, res) => {
  try {
    const agents = agentGateway.getAllAgentCapabilities();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/agents/muse/env-diagnostics (FR-12, API surface)
 *
 * Per-signal parity report for the Muse agent shell: whether each of
 * `muse`/`git`/`gh` resolution, HOME, identity, SSH agent reachability,
 * gh auth, and git identity resolves as the user's shell does — with
 * remediation hints for failures. Secret values are never included: the
 * env summary carries only SET/UNSET plus origin labels.
 *
 * `?reprobe=1` clears the process-lifetime login-shell cache first so the
 * report reflects the current shell (e.g. after fixing dotfiles).
 */
router.get('/muse/env-diagnostics', handleMuseEnvDiagnostics);

/**
 * Optional DI for diagnostics tests: Express passes its `next` callback as
 * the handler's third argument, which is a function — only a plain object
 * with a `refreshLoginShellEnvAsync` function counts as deps.
 */
function selectDiagnosticsRefresher(deps) {
  if (deps && typeof deps === 'object' && typeof deps.refreshLoginShellEnvAsync === 'function') {
    return deps.refreshLoginShellEnvAsync;
  }
  return refreshLoginShellEnvAsync;
}

/**
 * Upgrade the ssh-agent signal from stat-only to the connect-test: a
 * dead-but-present socket file passes stat yet refuses connections.
 * Pure — returns the (possibly new) signal list instead of mutating it.
 */
async function upgradeSshAgentSignal(signals, hostEnv) {
  const sshIdx = signals.findIndex((s) => s.signal === 'ssh-agent');
  if (sshIdx < 0) return signals;
  const live = await isSshAgentSocketAliveAsync(hostEnv.SSH_AUTH_SOCK);
  const ssh = signals[sshIdx];
  if (ssh.ok && !live.alive) {
    const next = signals.slice();
    next[sshIdx] = {
      signal: 'ssh-agent',
      ok: false,
      origin: ssh.origin,
      remediation: buildParityCredentialError('ssh-agent').message,
    };
    return next;
  }
  if (!ssh.ok && live.alive) {
    const next = signals.slice();
    next[sshIdx] = {
      signal: 'ssh-agent',
      ok: true,
      origin: hostEnv.SSH_AUTH_SOCK ? 'socket path' : 'unset',
      remediation: null,
    };
    return next;
  }
  return signals;
}

export async function handleMuseEnvDiagnostics(req, res, deps) {
  const refresher = selectDiagnosticsRefresher(deps);
  try {
    // Finding #6: the re-probe runs off the event loop (async execFile with
    // a tight budget) and repopulates the cache, so a slow shell no longer
    // stalls concurrent requests. The non-reprobe path keeps reading the
    // cached sync probe used by startup/turn code.
    if (req?.query?.reprobe) await refresher();
    const probe = getLoginShellEnv();
    const sessionEnv = buildSessionEnv(null, false, null);
    const hostEnv = buildMuseHostEnv(sessionEnv);
    const signals = await upgradeSshAgentSignal(checkParitySignals(hostEnv), hostEnv);
    res.json({
      probe: probe.ok ? { ok: true } : { ok: false, reason: probe.reason },
      signals,
      env: redactEnvForDiagnostics(hostEnv, probe.ok ? { shellEnv: probe.env } : {}),
    });
  } catch {
    res.status(500).json({ error: 'Failed to build environment diagnostics.' });
  }
}

export default router;
