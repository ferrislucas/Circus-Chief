import { messages, sessions } from '../database.js';
import { resolveAgentTypeFromModel, resolveProviderFromModel } from './sessionProvider.js';

// Human-readable labels used in the cross-kind switch error message.
export const AGENT_TYPE_LABELS = Object.freeze({
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
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

/**
 * Check whether a session has no assistant messages (i.e. is still a draft).
 * Exported so PATCH, run paths, and continue paths all share one implementation.
 * @param {string} sessionId
 * @returns {boolean}
 */
export function sessionHasNoAssistantMessages(sessionId) {
  const allMessages = messages.getBySessionId(sessionId);
  return !allMessages.some(m => m.role === 'assistant');
}

/**
 * Derive the agentType (and optionally providerId) update to apply when a
 * draft session's model changes. Returns a partial update object.
 *
 * Rules:
 * - Only re-derives when the session has no assistant messages (draft/waiting).
 * - Never overrides an explicitly-supplied providerId (caller passes the
 *   explicit value in opts.providerId so we know whether to skip it).
 * - Returns {} when nothing needs to change (same-kind swap, etc.).
 *
 * @param {Object} session - The current session row.
 * @param {string} sessionId - Session ID (used to query message history).
 * @param {string} newModel - The new model being applied.
 * @param {{ providerId?: string|null }} [opts] - Options.
 * @returns {Object} Partial update to merge into the update payload.
 */
export function deriveAgentTypeUpdate(session, sessionId, newModel, opts = {}) {
  if (!newModel) return {};
  if (!sessionHasNoAssistantMessages(sessionId)) return {};

  const derivedAgentType = resolveAgentTypeFromModel(newModel);
  const update = {};

  if (derivedAgentType && derivedAgentType !== session.agentType) {
    update.agentType = derivedAgentType;
  }

  // Auto-set providerId from model when the caller didn't pass one explicitly.
  if (opts.providerId === undefined) {
    const derivedProvider = resolveProviderFromModel(newModel);
    if (derivedProvider && derivedProvider.id !== session.providerId) {
      update.providerId = derivedProvider.id;
    }
  }

  return update;
}

/**
 * Reconcile the stored agentType with the effective model for a draft session.
 * Defense in depth: if the stored agentType doesn't match (stale row),
 * re-derive and persist the correct kind before creating the adapter.
 * @param {Object} session - Current session object
 * @param {string} sessionId - Session ID
 * @param {string|null} model - Model override (null to use session.model)
 * @returns {Object} Possibly-updated session object
 */
export function reconcileAgentTypeForRun(session, sessionId, model) {
  const effectiveModelForKind = model || session.model;
  if (!effectiveModelForKind || !sessionHasNoAssistantMessages(sessionId)) {
    return session;
  }
  // Only reconcile agentType here — providerId is managed by PATCH and SessionRepository.create.
  // Suppress providerId auto-set by passing the current value as the explicit override.
  const agentTypeUpdate = deriveAgentTypeUpdate(session, sessionId, effectiveModelForKind, { providerId: session.providerId });
  if (Object.keys(agentTypeUpdate).length === 0) {
    return session;
  }
  sessions.update(sessionId, agentTypeUpdate);
  return sessions.getById(sessionId);
}
