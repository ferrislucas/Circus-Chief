import { resolveAgentTypeFromModel } from './sessionProvider.js';

// Human-readable labels used in the cross-kind switch error message.
export const AGENT_TYPE_LABELS = Object.freeze({
  'claude-code': 'Claude Code',
  codex: 'Codex',
});

/**
 * @param {string} agentType
 * @returns {string}
 */
export function agentLabel(agentType) {
  return AGENT_TYPE_LABELS[agentType] || agentType || 'unknown';
}

/**
 * Cross-kind model switch guard. A session is bound to one agent type for its
 * lifetime. If the caller selected a model that resolves to a different agent
 * than the session's existing agentType, reject BEFORE dispatching
 * continueSession or updating session.model — mixing Claude and Codex
 * mid-conversation would produce a broken resume/context state. Same-kind
 * model changes (sonnet↔opus, gpt-4o↔o1-mini) pass through.
 *
 * @param {Object} session - The session row (must include agentType + model).
 * @param {string|null} requestedModel - Model ID from req.body.model, or null.
 * @returns {{ error: string, message: string }|null} 400-body on block, or null to allow.
 */
export function checkCrossKindSwitch(session, requestedModel) {
  const sessionAgentType = session.agentType || 'claude-code';
  const effectiveModel = requestedModel || session.model;
  const requestedAgentType = resolveAgentTypeFromModel(effectiveModel);
  if (requestedAgentType === sessionAgentType) return null;
  return {
    error: 'CROSS_KIND_MODEL_SWITCH',
    message: `Cannot switch agent kind mid-session (${agentLabel(sessionAgentType)} → ${agentLabel(requestedAgentType)})`,
  };
}
