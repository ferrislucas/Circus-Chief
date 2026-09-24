import { sessions } from '../database.js';
import { isTierRef, parseTierRef, WS_MESSAGE_TYPES } from '@circuschief/shared';
import { broadcastToSession } from '../websocket.js';
import { resolveTierRefForContinue } from './tierResolutionService.js';
import { agentCallLogger } from './agentCallLogger.js';
import { getTierName, hasResolvableTierMembers } from './sessionTierFailover.js';

/**
 * Fix 6 — safe degradation for a tier ref that no longer resolves to any
 * member (the tier was deleted, emptied, or every member's provider/model was
 * removed) at new/scheduled session start.
 *
 * Falls back to:
 *   1. The session's last-resolved concrete snapshot (`resolvedModel` /
 *      `resolvedProviderId`), when present — a session that has run before on
 *      this tier keeps using the model it last succeeded on.
 *   2. Otherwise, the same server default used elsewhere (a null model /
 *      provider, i.e. whatever the agent adapter's own SDK default resolves
 *      to — there is always a resolvable Anthropic default, so this branch
 *      never itself fails to "resolve").
 *
 * Persists the concrete fallback onto the session — clearing the tier
 * binding entirely, since there is nothing left to fail over to — so future
 * turns are unambiguous, and surfaces a visible notice + log entry naming the
 * stale tier ref and the concrete fallback that was used.
 *
 * @param {string} sessionId
 * @param {Object} session
 * @param {string} staleTierRef
 * @returns {{ model: string|null, session: Object }}
 */
export function applyStaleTierFallback(sessionId, session, staleTierRef) {
  const hasSnapshot = Boolean(session.resolvedModel);
  const fallbackModel = hasSnapshot ? session.resolvedModel : null;
  const fallbackProviderId = hasSnapshot ? session.resolvedProviderId || null : null;
  const tierName = getTierName(parseTierRef(staleTierRef) || staleTierRef);

  sessions.update(sessionId, {
    model: fallbackModel,
    providerId: fallbackProviderId,
    resolvedModel: null,
    resolvedProviderId: null,
  });
  const updatedSession = sessions.getById(sessionId);

  const reason = `Model tier "${tierName}" is no longer resolvable (deleted or has no enabled members)`;
  console.warn(
    `[SessionManager] ${reason} — falling back to ${fallbackModel || 'the server default'} model for session ${sessionId}`
  );

  broadcastToSession(sessionId, WS_MESSAGE_TYPES.TIER_FAILOVER, {
    sessionId,
    tierRef: staleTierRef,
    tierName,
    fromModel: staleTierRef,
    fromProviderId: null,
    toModel: fallbackModel,
    toProviderId: fallbackProviderId,
    reason,
    timestamp: Date.now(),
  });

  try {
    agentCallLogger._logFailoverEvent(sessionId, {
      fromModel: staleTierRef,
      fromProviderId: null,
      toModel: fallbackModel,
      toProviderId: fallbackProviderId,
      tierRef: staleTierRef,
      tierName,
      reason,
      agentType: updatedSession.agentType || 'claude-code',
    });
  } catch (_logErr) {
    // Non-fatal — the fallback proceeds even if logging fails
  }

  return { model: fallbackModel, session: updatedSession };
}

/**
 * `resolveTierRefForContinue` + stale-binding degradation for the continuation
 * paths (PRD E3 / D6). The start path (`_runTierBoundSession`) already
 * degrades a truly-stale tier binding via `applyStaleTierFallback`; this
 * wrapper gives `buildContinueModelAndEnv` / `buildModelAndProvider` the same
 * behavior so a follow-up message never throws or strands the session.
 *
 * Semantics:
 * - A TRULY stale binding — the session's own tier ref with no resolvable
 *   members left (deleted / emptied, per `hasResolvableTierMembers`, which is
 *   deliberately cooldown-blind) — degrades exactly like the start path,
 *   INCLUDING when a snapshot would have made resolution succeed anyway: a
 *   session must not keep a binding to a tier that no longer exists.
 *   `applyStaleTierFallback` clears the binding (preferring the snapshot) and
 *   broadcasts the `tier:failover` notice.
 * - A TRANSIENT state (every member merely in cooldown) continues on the
 *   snapshot, or on the first configured member for a legacy row. Cooldown
 *   must neither clear nor block an existing binding.
 * - A request for a DIFFERENT unresolvable tier still throws — that is a
 *   genuine bad selection, not the session's own binding.
 *
 * @param {string} sessionId
 * @param {Object} session - Current session row.
 * @param {string|null} requestedModel - Explicit model override, or null.
 * @returns {{ effectiveModel: string|null, providerIdHint: string|null, persist: Object }}
 * @throws {Error} from `resolveTierRefForContinue` for the non-stale-binding
 *   cases described above.
 */
export function resolveTierRefForContinueWithStaleFallback(sessionId, session, requestedModel) {
  const ownBindingRequested =
    isTierRef(session.model) && (!requestedModel || requestedModel === session.model);
  if (ownBindingRequested && !hasResolvableTierMembers(session.model)) {
    // Stale binding — degrade exactly like the start path. `applyStaleTierFallback`
    // persists the concrete fallback (snapshot or null/server-default) and clears
    // the tier binding, so nothing further needs persisting here; the persisted
    // providerId doubles as the disambiguation hint for duplicate model ids.
    const fallback = applyStaleTierFallback(sessionId, session, session.model);
    return {
      effectiveModel: fallback.model,
      providerIdHint: fallback.session?.providerId ?? null,
      persist: {},
    };
  }
  return resolveTierRefForContinue(session, requestedModel);
}
