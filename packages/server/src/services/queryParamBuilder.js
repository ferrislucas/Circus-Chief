import { createClaudeCodeSpawner } from './nodeSpawnHelper.js';
import {
  buildSystemPromptConfig,
  getPermissionModeForSession,
  getSandboxModeForSession,
} from './sessionPrompts.js';

/**
 * Build query parameters for the Claude Code adapter.
 * @returns {Object}
 */
function buildClaudeCodeQueryParams({
  prompt, workingDirectory, controller, session, sessionId, systemPrompt,
  model, sessionEnv, resumeSessionId = null,
}) {
  const isVCR = Boolean(process.env.VCR_MODE);
  const effectiveModel = isVCR ? 'claude-haiku-4-5-20251001' : model;

  return {
    prompt,
    options: {
      cwd: workingDirectory,
      abortController: controller,
      includePartialMessages: true,
      permissionMode: getPermissionModeForSession(session.mode),
      // Match normal Claude Code CLI behavior: load user-level settings
      // such as configured MCP servers, then project/local overrides.
      settingSources: ['user', 'project', 'local'],
      ...(resumeSessionId && { resume: resumeSessionId }),
      env: sessionEnv,
      spawnClaudeCodeProcess: createClaudeCodeSpawner(),
      model: effectiveModel,
      systemPrompt: buildSystemPromptConfig(sessionId, session.projectId, systemPrompt, session.mode),
    },
  };
}

/**
 * Build query parameters for the Codex adapter.
 *
 * Codex in v1 is a simple Chat-Completions-shaped executor. It does not need
 * or accept Claude-specific options such as permissionMode, settingSources,
 * includePartialMessages, spawnClaudeCodeProcess, or resume.
 *
 * @returns {Object}
 */
function buildCodexQueryParams({
  prompt, workingDirectory, controller, session, sessionId, systemPrompt, model, sessionEnv,
}) {
  const isVCR = Boolean(process.env.VCR_MODE);
  const effectiveModel = isVCR ? 'gpt-4o-mini' : model;

  return {
    prompt,
    options: {
      cwd: workingDirectory,
      abortController: controller,
      env: sessionEnv,
      model: effectiveModel,
      effortLevel: session?.effortLevel ?? null,
      systemPrompt: buildSystemPromptConfig(sessionId, session.projectId, systemPrompt, session.mode),
      sandboxMode: getSandboxModeForSession(session?.mode),
    },
  };
}

/**
 * Build query parameters for executing a session via the configured agent.
 * Shared by runSession, continueSession, and continueSessionWithExistingMessage.
 *
 * @param {Object} options
 * @param {string} options.prompt - The prompt text to send
 * @param {string} options.workingDirectory - Session working directory
 * @param {AbortController} options.controller - Abort controller for the session
 * @param {Object} options.session - Session object from DB
 * @param {string} options.sessionId - Session ID
 * @param {string|null} options.systemPrompt - Custom system prompt from project settings
 * @param {string|null} options.model - Model to use
 * @param {Object} options.sessionEnv - Environment variables for the session
 * @param {string|null} [options.resumeSessionId] - Session ID to resume (null for new session)
 * @param {string} [options.agentType] - 'claude-code' (default) | 'codex'
 * @returns {Object} Query parameters for agent.execute()
 */
export function buildQueryParams(options) {
  const { agentType = 'claude-code' } = options || {};
  if (agentType === 'codex') {
    return buildCodexQueryParams(options);
  }
  return buildClaudeCodeQueryParams(options);
}
