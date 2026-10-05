import { createCodexSpawner } from './codexSpawnHelper.js';
import { createGeminiSpawner } from './geminiSpawnHelper.js';
import { isE2ESpawnCaptureEnabled } from './e2eSpawnCapture.js';
import { agentGateway } from '../agents/AgentGateway.js';
import { LoggingAgentWrapper } from '../agents/LoggingAgentWrapper.js';
import { VCRAgentAdapter } from '../agents/vcr/VCRAgentAdapter.js';

/** Build adapter-specific defaults before the agent is created. */
export function buildAgentConfig(agentType) {
  if (agentType === 'codex') return { spawnCodexProcess: createCodexSpawner() };
  if (agentType === 'gemini') return { spawnGeminiProcess: createGeminiSpawner() };
  // Muse spawns `muse exec` directly; no spawner injection needed in production.
  if (agentType === 'muse') return {};
  return {};
}

/**
 * @param {Object} sessionEnv
 * @param {string|null} commitAttributionOverride
 * @param {{ providerId?: string|null, sessionId?: string|null }} [e2eMeta] - Only
 *   applied when {@link isE2ESpawnCaptureEnabled} is true; threads the
 *   resolved providerId/sessionId through to the spawned CLI's `env` purely
 *   so the E2E spawn-capture seam (e2eSpawnCapture.js) can recover which
 *   (provider, model, session) a captured/scripted spawn attempt belongs to.
 *   Never read outside of E2E spawn-capture mode.
 */
export function buildAgentEnv(sessionEnv, commitAttributionOverride, e2eMeta = null) {
  const env = { ...(sessionEnv || {}) };
  if (commitAttributionOverride) {
    env.CIRCUSCHIEF_COMMIT_ATTRIBUTION = commitAttributionOverride;
  } else {
    delete env.CIRCUSCHIEF_COMMIT_ATTRIBUTION;
  }
  if (e2eMeta && isE2ESpawnCaptureEnabled()) {
    if (e2eMeta.providerId) env.CIRCUSCHIEF_E2E_PROVIDER_ID = e2eMeta.providerId;
    if (e2eMeta.sessionId) env.CIRCUSCHIEF_E2E_SESSION_ID = e2eMeta.sessionId;
  }
  return env;
}

/**
 * Create the agent for a session, using gateway + logging + VCR.
 *
 * If `config` is empty, the adapter-specific default config is applied
 * (e.g. codex receives a fresh `spawnCodexProcess` spawner). Explicit
 * `config` keys win over defaults. Lives here (not in sessionExecution.js)
 * so the execution module stays within its lifecycle size budget — this is
 * agent construction, which this module owns.
 *
 * @param {string} agentType - The agent type (e.g., 'claude-code', 'codex')
 * @param {Object} [config] - Optional adapter config forwarded to the gateway.
 * @returns {{ execute: (queryParams: any, meta?: any) => AsyncGenerator }}
 */
export function createAgentForSession(agentType = 'claude-code', config = {}) {
  const mergedConfig = { ...buildAgentConfig(agentType), ...config };
  const baseAgent = agentGateway.createAgent(agentType, mergedConfig);

  // Wrap with VCR adapter if in VCR mode
  const agent = process.env.VCR_MODE && !isE2ESpawnCaptureEnabled()
    ? new VCRAgentAdapter(baseAgent, { cassetteDir: 'tests/e2e/cassettes' })
    : baseAgent;

  // Always wrap with logging
  return new LoggingAgentWrapper(agent);
}
