import { createCodexSpawner } from './codexSpawnHelper.js';
import { createGeminiSpawner } from './geminiSpawnHelper.js';
import { createE2EOpenAIAllowanceClientFactory } from './e2eOpenAIAllowanceFixture.js';

/** Build adapter-specific defaults before the agent is created. */
export function buildAgentConfig(agentType) {
  if (agentType === 'codex') {
    const openaiClientFactory = createE2EOpenAIAllowanceClientFactory();
    if (openaiClientFactory) return { spawnCodexProcess: null, openaiClientFactory };
    return { spawnCodexProcess: createCodexSpawner() };
  }
  if (agentType === 'gemini') return { spawnGeminiProcess: createGeminiSpawner() };
  return {};
}

export function buildAgentEnv(sessionEnv, commitAttributionOverride) {
  const env = { ...(sessionEnv || {}) };
  if (commitAttributionOverride) {
    env.CIRCUSCHIEF_COMMIT_ATTRIBUTION = commitAttributionOverride;
  } else {
    delete env.CIRCUSCHIEF_COMMIT_ATTRIBUTION;
  }
  return env;
}
