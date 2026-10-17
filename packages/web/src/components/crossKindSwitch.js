/**
 * Cross-provider switch picker helpers (FRD §4/G4).
 *
 * Pure functions (no store access) so the confirmation copy and scope rule
 * stay unit-testable. The picker flow in ConversationTab resolves provider
 * kinds to agent types, asks this module whether a change needs
 * confirmation, and dispatches `updateSessionModel` only after confirm.
 * Gemini switches intentionally get no confirmation here: the backend keeps
 * rejecting them with the existing `CROSS_KIND_MODEL_SWITCH` copy, which the
 * caller surfaces from the request error.
 */

/** Agent kinds eligible for an in-place switch (mirrors the server guard). */
export const IN_SCOPE_SWITCH_KINDS = Object.freeze(['claude-code', 'codex', 'muse']);

const AGENT_LABELS = Object.freeze({
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  muse: 'Muse',
});

/**
 * Map a provider `kind` to its agent type. Unknown/absent kinds stay
 * Claude Code, matching the ModelSelector and server resolver defaults.
 * @param {string|null} kind
 * @returns {string}
 */
export function agentTypeForKind(kind) {
  if (kind === 'openai') return 'codex';
  if (kind === 'google') return 'gemini';
  if (kind === 'meta') return 'muse';
  return 'claude-code';
}

/**
 * @param {string} agentType
 * @returns {string}
 */
export function agentLabelForType(agentType) {
  return AGENT_LABELS[agentType] || agentType;
}

/**
 * Resolve a (providerId, modelId) pair to its agent type via the providers
 * catalog. Prefers the explicit provider id; falls back to whichever
 * provider owns the model id; defaults to Claude Code like the picker.
 * @param {Array} providers - Provider rows with `id`, `kind`, and `models`.
 * @param {string|null} providerId
 * @param {string|null} modelId
 * @returns {string}
 */
export function agentTypeForProviders(providers, providerId, modelId) {
  const list = providers || [];
  const byId = providerId ? list.find((p) => p.id === providerId) : null;
  if (byId) return agentTypeForKind(byId.kind);
  const owner = modelId ? list.find((p) => (p.models || []).some((m) => m.modelId === modelId)) : null;
  return agentTypeForKind(owner?.kind);
}

/** Generic switch confirmation (FRD §4/G4) for when a kind is unresolvable. */
export const GENERIC_SWITCH_COPY =
  'Switch model? Native context is cleared; full text history is passed to the new provider.';

/**
 * Whether a (providerId, modelId) pair resolves to an authoritative kind in
 * the providers catalog. False when the catalog is unloaded, the provider
 * was deleted AND no remaining provider owns the model id, or the model id
 * is unknown — exactly the cases where `agentTypeForProviders` silently
 * defaults to Claude Code. Mirrors its lookup order (explicit provider id,
 * then model ownership).
 * @param {Array|null} providers - Provider rows with `id`, `kind`, and `models`.
 * @param {string|null} providerId
 * @param {string|null} modelId
 * @returns {boolean}
 */
export function isKindResolvable(providers, providerId, modelId) {
  const list = providers || [];
  if (providerId && list.some((p) => p.id === providerId)) return true;
  if (modelId && list.some((p) => (p.models || []).some((m) => m.modelId === modelId))) return true;
  return !providerId && !modelId;
}

/**
 * Orchestrate one picker change: confirm in-scope kind switches, persist,
 * and roll back on cancel/failure so the picker always matches the server.
 *
 * @param {object} args
 * @param {string|null} args.oldModel
 * @param {string|null} args.oldProviderId
 * @param {string} args.newModel
 * @param {string|null} args.newProviderId
 * @param {string} args.fromAgentType
 * @param {string} args.toAgentType
 * @param {boolean} args.isStarted
 * @param {(copy: string) => boolean} args.confirmFn - confirm dialog (window.confirm).
 * @param {(model: string, providerId: string|null) => Promise<unknown>} args.persistFn
 * @param {(err: Error) => void} args.onError - surfaces the backend error copy.
 * @param {(model: string|null, providerId: string|null) => void} args.revertFn
 * @returns {Promise<'persisted'|'cancelled'|'failed'>}
 */
export async function persistModelSelectionWithConfirm({
  oldModel, oldProviderId, newModel, newProviderId,
  fromAgentType, toAgentType, isStarted,
  confirmFn, persistFn, onError, revertFn,
}) {
  const plan = planModelSwitch({ fromAgentType, toAgentType, isStarted });
  if (plan?.action === 'confirm' && !confirmFn(plan.copy)) {
    revertFn(oldModel, oldProviderId);
    return 'cancelled';
  }
  try {
    await persistFn(newModel, newProviderId);
    return 'persisted';
  } catch (err) {
    onError(err);
    // Roll back only when the server definitively refused (4xx — its state is
    // provably unchanged, e.g. gemini cross-kind). On network/5xx failures the
    // outcome is unknown, so keep the user's choice: draft submits and
    // same-kind sends still carry it and self-heal.
    if (err?.status >= 400 && err?.status < 500) revertFn(oldModel, oldProviderId);
    return 'failed';
  }
}

/**
 * Decide what the picker must do before persisting a model change.
 *
 * @param {{ fromAgentType: string, toAgentType: string, isStarted: boolean, modelsDiffer?: boolean, kindUnresolvable?: boolean }} args
 *   - `modelsDiffer`: whether the old/new model ids differ (the caller
 *     compares them; resolved agent types alone cannot tell when both
 *     defaulted to Claude Code).
 *   - `kindUnresolvable`: whether either end failed `isKindResolvable`
 *     (catalog unloaded, provider deleted, unknown model id).
 * @returns {{ action: 'confirm', copy: string } | { action: 'backend' } | null}
 *   - `null`: persist directly (same kind, or draft session — nothing to lose).
 *   - `{ action: 'confirm', copy }`: show the copy in a confirm dialog and
 *     persist only when the user accepts.
 *   - `{ action: 'backend' }`: persist directly; the backend rejects
 *     out-of-scope (gemini) switches with the existing error copy.
 */
export function planModelSwitch({ fromAgentType, toAgentType, isStarted, modelsDiffer = false, kindUnresolvable = false }) {
  if (!isStarted) return null;
  // Either kind defaulted without evidence on a started session with a real
  // model change: confirm generically (FRD §4/G4) instead of persisting
  // silently — the specific copy could mislabel an unknown kind.
  if (kindUnresolvable && modelsDiffer) {
    return { action: 'confirm', copy: GENERIC_SWITCH_COPY };
  }
  if (!toAgentType || toAgentType === fromAgentType) return null;
  if (IN_SCOPE_SWITCH_KINDS.includes(fromAgentType) && IN_SCOPE_SWITCH_KINDS.includes(toAgentType)) {
    return {
      action: 'confirm',
      copy: `Switch from ${agentLabelForType(fromAgentType)} to ${agentLabelForType(toAgentType)}? Native context is cleared; full text history is passed to the new provider.`,
    };
  }
  return { action: 'backend' };
}
