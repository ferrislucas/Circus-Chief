import { serializeMcpServersToArgs } from './codexMcpArgs.js';

/**
 * Resolve the Codex configuration shared by its CLI and App Server transports.
 * Protocol-specific argument placement remains with each transport.
 */
export function buildCodexExecutionConfig(options = {}) {
  const { cwd, env, abortController, model, sandboxMode, effortLevel, mcpServers, systemPrompt } = options;
  const reasoningEffort = resolveCodexReasoningEffort(effortLevel);
  const mcpConfig = (mcpServers && typeof mcpServers === 'object')
    ? serializeMcpServersToArgs(mcpServers, { baseEnv: env })
    : { args: [], env: {} };
  const configArgs = [];

  if (reasoningEffort) {
    configArgs.push(
      '-c', `model_reasoning_effort=${reasoningEffort}`,
      '-c', `plan_mode_reasoning_effort=${reasoningEffort}`,
    );
  }
  configArgs.push(...mcpConfig.args);

  const usesChatGptAuth = !env?.OPENAI_API_KEY;
  if (usesChatGptAuth) configArgs.push('-c', 'preferred_auth_method=chatgpt');

  return {
    cwd,
    env: { ...env, ...mcpConfig.env },
    signal: abortController?.signal,
    model,
    systemPrompt: systemPrompt || null,
    sandbox: sandboxMode || 'workspace-write',
    reasoningEffort,
    configArgs,
    usesChatGptAuth,
  };
}

export function resolveCodexReasoningEffort(effortLevel) {
  if (!effortLevel || effortLevel === 'auto') return null;
  if (effortLevel === 'max') return 'xhigh';
  if (['low', 'medium', 'high'].includes(effortLevel)) return effortLevel;
  return null;
}
