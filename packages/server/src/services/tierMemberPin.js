import { sessions } from '../database.js';
import { isTierRef } from '@circuschief/shared';
import { broadcastSessionUpdate } from './summaryBroadcast.js';

// sessionId → { modelId, providerId, tierRef, token } for the tier-member
// attempt currently in flight. Registered by the start-time failover loop
// before each attempt and cleared when the loop exits, so stream-event
// persistence can attribute the activity it persists to the exact member
// that is producing it — including the second (or later) member after a
// transparent startup failover.
//
// Finding 11: the registration is scoped to the originating tier reference
// AND an attempt token. A stale attempt (an auto-send continuation on a
// different tier, a newer execution on the same tier) must neither pin
// through this registration nor be wiped by its cleanup.
const activeTierAttemptMembers = new Map();

let attemptTokenSeq = 0;

/**
 * Register the concrete tier member about to be attempted for `sessionId`.
 * Overwrites any previous registration: exactly the attempt whose stream is
 * producing events may pin the session.
 *
 * @param {string} sessionId
 * @param {{ modelId: string, providerId: string }} member
 * @param {{ tierRef?: string|null }} [opts] - Originating tier reference the
 *   registration is scoped to (finding 11).
 * @returns {number|null} Attempt token identifying this registration; pass it
 *   to {@link clearTierAttemptMember} so stale cleanup cannot clear a
 *   successor's registration. Null when nothing was registered.
 */
export function registerTierAttemptMember(sessionId, member, opts = {}) {
  if (!sessionId || !member?.modelId || !member?.providerId) return null;
  const token = ++attemptTokenSeq;
  activeTierAttemptMembers.set(sessionId, {
    modelId: member.modelId,
    providerId: member.providerId,
    tierRef: opts?.tierRef ?? null,
    token,
  });
  return token;
}

/**
 * Remove the in-flight attempt registration for `sessionId`. Called when the
 * failover loop exits so late events from an unwinding stream can never pin a
 * session to a member that is no longer running.
 *
 * Finding 11: when `token` is provided, only the matching registration is
 * removed — a stale outer `finally` must never clear a successor's
 * registration. Omit `token` only to retire the whole attempt unconditionally
 * (the auto-send handoff, where the originating attempt is complete and no
 * successor registration can exist yet).
 *
 * @param {string} sessionId
 * @param {number} [token]
 */
export function clearTierAttemptMember(sessionId, token) {
  if (token === undefined) {
    activeTierAttemptMembers.delete(sessionId);
    return;
  }
  const current = activeTierAttemptMembers.get(sessionId);
  if (current && current.token === token) {
    activeTierAttemptMembers.delete(sessionId);
  }
}

/**
 * Whether a pin request is superseded: the session's binding has moved to a
 * different tier than the originating attempt (`tierRef` mismatch), or the
 * originating attempt no longer owns the in-flight registration.
 * Finding 11: checking only that the current selection is any tier, or even
 * the same tier, is insufficient — ownership must match too. An ABSENT
 * registration is lost ownership, exactly like a mismatched token: the
 * originating attempt retired (its loop exited or the auto-send handoff
 * cleared it) and a late token-scoped write from it must not overwrite the
 * successor's identity — even when the tier binding still matches and no
 * successor registration remains.
 *
 * @param {Object} session - Current session row.
 * @param {string} sessionId
 * @param {{ tierRef?: string|null, attemptToken?: number|null }} [opts]
 * @returns {boolean} true when the pin must not proceed
 */
function isSupersededPin(session, sessionId, opts = {}) {
  if (!opts?.tierRef) return false;
  if (!session || session.model !== opts.tierRef) return true;
  if (opts?.attemptToken === undefined || opts?.attemptToken === null) return false;
  const active = activeTierAttemptMembers.get(sessionId);
  if (!active) return true;
  return active.token !== opts.attemptToken;
}

/**
 * Idempotently pin a tier-bound session to the concrete member identified by
 * `member`: the tier reference stays in `session.model`; only the concrete
 * resolution snapshot (`resolvedModel` / `resolvedProviderId`) is written,
 * alongside the durable last-executed identity for that member.
 *
 * This is the single write path for member pinning, shared by:
 *   - the "first durable activity" trigger (see
 *     {@link pinTierMemberOnDurableActivity}), which fires at the moment
 *     assistant/work-log activity is persisted — BEFORE any terminal-error
 *     handling can read (or lack) the snapshot; and
 *   - the success-time snapshot, which additionally requires that the turn
 *     actually ran to completion (or ran and was then proactively
 *     rescheduled).
 *
 * The write is skipped when the session is not tier-bound or already carries
 * exactly this snapshot and executed identity, so repeated activity events
 * cannot rewrite it or cause duplicate side effects.
 *
 * Finding 11: when `opts.tierRef` names the originating tier binding, the
 * write is additionally scoped to it — a stale attempt whose binding has
 * moved on (auto-send continuation on another tier) is a no-op, as is a
 * stale success snapshot racing a newer attempt (`opts.attemptToken`
 * mismatch) or unwinding after its own registration was retired (no active
 * registration at all — e.g. a same-tier auto-send continuation that already
 * cleaned up). Checking only that the current selection is any tier, or even
 * the same tier, is insufficient.
 *
 * @param {string} sessionId
 * @param {{ modelId: string, providerId: string }} member
 * @param {{ tierRef?: string|null, attemptToken?: number|null }} [opts]
 * @returns {boolean} true when a new snapshot was written
 */
export function pinSessionToTierMember(sessionId, member, opts = {}) {
  if (!member?.modelId || !member?.providerId) return false;
  const session = sessions.getById(sessionId);
  if (!session || !isTierRef(session.model)) return false;
  if (isSupersededPin(session, sessionId, opts)) return false;
  if (session.resolvedModel === member.modelId && session.resolvedProviderId === member.providerId
    && session.lastExecutedModel === member.modelId && session.lastExecutedProviderId === member.providerId) {
    return false;
  }
  sessions.update(sessionId, {
    model: session.model,
    resolvedModel: member.modelId,
    resolvedProviderId: member.providerId,
    lastExecutedModel: member.modelId,
    lastExecutedProviderId: member.providerId,
  });
  const updatedSession = sessions.getById(sessionId);
  broadcastSessionUpdate(sessionId, updatedSession.projectId, updatedSession);
  return true;
}

/**
 * Pin `sessionId` to the member of its in-flight tier attempt, if any. Called
 * at the points where DURABLE observable agent activity is persisted (assistant
 * messages, work logs): the first such event establishes the member for the
 * conversation, even if the turn later ends in a terminal error. No-op when
 * the session has no in-flight tier attempt (non-tier sessions, continuations
 * on an already-pinned member, or after the attempt loop has exited).
 *
 * Finding 11: the pin is scoped to the registration's originating tier —
 * activity on a session that has since moved to another tier binding (e.g. an
 * auto-send continuation dispatched after the originating attempt completed)
 * cannot be attributed to the stale member.
 *
 * @param {string} sessionId
 * @returns {boolean} true when a new snapshot was written
 */
export function pinTierMemberOnDurableActivity(sessionId) {
  const member = activeTierAttemptMembers.get(sessionId);
  if (!member) return false;
  if (member.tierRef) {
    const session = sessions.getById(sessionId);
    if (!session || session.model !== member.tierRef) return false;
  }
  return pinSessionToTierMember(sessionId, member);
}
