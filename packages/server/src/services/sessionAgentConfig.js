import { createCodexSpawner } from './codexSpawnHelper.js';
import { createGeminiSpawner } from './geminiSpawnHelper.js';

/** Build adapter-specific defaults before the agent is created. */
export function buildAgentConfig(agentType) {
  if (agentType === 'codex') return { spawnCodexProcess: createCodexSpawner() };
  if (agentType === 'gemini') return { spawnGeminiProcess: createGeminiSpawner() };
  return {};
}
