import { createCodexSpawner } from './codexSpawnHelper.js';
import { createGeminiSpawner } from './geminiSpawnHelper.js';
import { isE2ESpawnCaptureEnabled } from './e2eSpawnCapture.js';

/** Build adapter-specific defaults before the agent is created. */
export function buildAgentConfig(agentType) {
  if (agentType === 'codex') return { spawnCodexProcess: createCodexSpawner() };
  if (agentType === 'gemini') return { spawnGeminiProcess: createGeminiSpawner() };
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
