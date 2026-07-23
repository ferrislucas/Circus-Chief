import { messages, sessions } from '../database.js';
import { resolveAgentTypeFromModel, resolveProviderFromModel } from './sessionProvider.js';
import { isTierRef } from '@circuschief/shared';
import { resolveActiveModel } from './tierResolutionService.js';

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
 * Resolve the concrete (modelId, providerIdHint) pair to use for an
 * agent-kind decision (Work Item 2 of the Model Tiers remediation plan).
 *
 * A raw `tier::<id>` sentinel must never be handed to
 * `resolveAgentTypeFromModel` directly — it owns no provider, so the lookup
 * silently falls through to the 'claude-code' default, which is wrong
 * whenever the tier's actual active member is a Codex/Gemini model. This
 * helper is the single place that resolves a tier ref (via the same
 * active-tier resolver used by start/continue execution) before any
 * agent-kind decision is made.
 *
 * @param {string|null|undefined} modelOrRef - A concrete model id or a tier ref.
 * @param {string|null} [providerIdHint] - Explicit provider hint for a concrete model.
 * @returns {{ modelId: string|null, providerIdHint: string|null, unresolved?: boolean }}
 */
export function resolveModelForAgentKind(modelOrRef, providerIdHint = null) {
  if (!isTierRef(modelOrRef)) {
    return { modelId: modelOrRef, providerIdHint };
  }
  const resolved = resolveActiveModel(modelOrRef, {});
  if (!resolved) {
    return { modelId: null, providerIdHint: null, unresolved: true };
  }
  return { modelId: resolved.model, providerIdHint: resolved.providerId };
}

/**
 * Convenience wrapper around {@link resolveModelForAgentKind} +
 * `resolveAgentTypeFromModel` for the common "derive the agentType to
 * persist on a newly-created session" case (template triggers, kanban lane
 * triggers) — callers that have no existing session/agentType to compare
 * against, just a model field that may be a tier ref.
 *
 * Falls back to 'claude-code' when the tier can't currently be resolved
 * (matching the pre-existing default for a null/unknown model), rather than
 * throwing — a newly-created session's agentType is defense-in-depth here;
 * the real start-time tier-failover path always re-derives the correct kind
 * per attempt before dispatching the agent.
 *
 * @param {string|null|undefined} modelOrRef - A concrete model id or a tier ref.
 * @returns {string} 'claude-code' | 'codex' | 'gemini'
 */
export function deriveAgentTypeForModelOrTier(modelOrRef) {
  const resolved = resolveModelForAgentKind(modelOrRef);
  if (resolved.unresolved) return 'claude-code';
  return resolveAgentTypeFromModel(resolved.modelId, resolved.providerIdHint);
}

/**
 * Cross-kind model switch guard. A session is bound to one agent type for its
 * lifetime. If the caller selected a model that resolves to a different agent
 * than the session's existing agentType, reject BEFORE dispatching
 * continueSession or updating session.model — mixing Claude and Codex
 * mid-conversation would produce a broken resume/context state. Same-kind
 * model changes (sonnet↔opus, gpt-4o↔o1-mini) pass through.
 *
 * Tier-aware (Work Item 2): a `tier::<id>` selection is resolved to its
 * active member before the agent kind is compared, so a started session
 * correctly rejects a tier that currently resolves to a different kind, and
 * allows one that resolves to the same kind. A tier with no resolvable
 * healthy member returns a clear, distinct error rather than silently
 * defaulting to 'claude-code'.
 *
 * @param {Object} session - The session row (must include agentType + model).
 * @param {string|null} requestedModel - Model ID from req.body.model, or null.
 * @returns {{ error: string, message: string }|null} 400-body on block, or null to allow.
 */
export function checkCrossKindSwitch(session, requestedModel) {
  const sessionAgentType = session.agentType || 'claude-code';
  const effectiveModel = requestedModel || session.model;
  const resolved = resolveModelForAgentKind(effectiveModel);
  if (resolved.unresolved) {
    return {
      error: 'TIER_UNRESOLVABLE',
      message: `Tier reference "${effectiveModel}" has no healthy or enabled members — cannot determine the agent kind`,
    };
  }
  const requestedAgentType = resolveAgentTypeFromModel(resolved.modelId, resolved.providerIdHint);
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
 * - Tier-aware (Work Item 2): `newModel` may be a `tier::<id>` ref. It is
 *   resolved to its active member via {@link resolveModelForAgentKind} before
 *   deriving the agent kind, so a Codex/Gemini-first tier correctly derives
 *   that kind rather than silently defaulting to 'claude-code'. A tier with
 *   no currently-resolvable member is a no-op here (leaves agentType/providerId
 *   untouched) — the run-time reconciliation path re-derives it once the
 *   tier actually resolves at start. A tier binding's providerId is never
 *   auto-set: the concrete provider is resolved per-run, not persisted.
 *
 * @param {Object} session - The current session row.
 * @param {string} sessionId - Session ID (used to query message history).
 * @param {string} newModel - The new model being applied.
 * @param {{ providerId?: string|null }} [opts] - Options. When `providerId` is
 *   explicitly provided (non-undefined), it both (a) suppresses auto-derivation
 *   of a providerId update below, and (b) is used as the provider-aware
 *   disambiguation hint (Fix 1) passed to `resolveAgentTypeFromModel` /
 *   `resolveProviderFromModel` — required so a tier member's exact provider
 *   (not just its `modelId`) determines the derived agent type when the same
 *   `modelId` is registered under two different providers/agent kinds.
 * @returns {Object} Partial update to merge into the update payload.
 */
export function deriveAgentTypeUpdate(session, sessionId, newModel, opts = {}) {
  if (!newModel) return {};
  if (!sessionHasNoAssistantMessages(sessionId)) return {};

  const isTier = isTierRef(newModel);
  const providerHint = opts.providerId ?? null;
  const resolved = resolveModelForAgentKind(newModel, providerHint);
  if (resolved.unresolved) {
    return {};
  }

  const derivedAgentType = resolveAgentTypeFromModel(resolved.modelId, resolved.providerIdHint);
  const update = {};

  if (derivedAgentType && derivedAgentType !== session.agentType) {
    update.agentType = derivedAgentType;
  }

  // Auto-set providerId from model when the caller didn't pass one explicitly
  // — but never for a tier binding, whose concrete provider is resolved
  // per-run rather than persisted as session.providerId (Work Item 1).
  if (opts.providerId === undefined && !isTier) {
    const derivedProvider = resolveProviderFromModel(resolved.modelId, resolved.providerIdHint);
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
 * @param {string|null} [providerIdHint] - Explicit provider for `model` (Fix 1 /
 *   Fix 4) — e.g. a tier member's own `providerId` during start-time failover.
 *   Falls back to `session.providerId` when omitted, matching prior behavior.
 * @returns {Object} Possibly-updated session object
 */
export function reconcileAgentTypeForRun(session, sessionId, model, providerIdHint = null) {
  const effectiveModelForKind = model || session.model;
  if (!effectiveModelForKind || !sessionHasNoAssistantMessages(sessionId)) {
    return session;
  }
  // Only reconcile agentType here — providerId is managed by PATCH and SessionRepository.create.
  // Suppress providerId auto-set by always passing a defined value as the explicit
  // override, while still using it as the provider-aware disambiguation hint.
  const agentTypeUpdate = deriveAgentTypeUpdate(session, sessionId, effectiveModelForKind, {
    providerId: providerIdHint ?? session.providerId,
  });
  if (Object.keys(agentTypeUpdate).length === 0) {
    return session;
  }
  sessions.update(sessionId, agentTypeUpdate);
  return sessions.getById(sessionId);
}
