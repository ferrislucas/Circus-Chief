import { sessions } from '../database.js';
import { isTierRef } from '@circuschief/shared';

// sessionId → { modelId, providerId } for the tier-member attempt currently in
// flight. Registered by the start-time failover loop before each attempt and
// cleared when the loop exits, so stream-event persistence can attribute the
// activity it persists to the exact member that is producing it — including
// the second (or later) member after a transparent startup failover.
const activeTierAttemptMembers = new Map();

/**
 * Register the concrete tier member about to be attempted for `sessionId`.
 * Overwrites any previous registration: exactly the attempt whose stream is
 * producing events may pin the session.
 *
 * @param {string} sessionId
 * @param {{ modelId: string, providerId: string }} member
 */
export function registerTierAttemptMember(sessionId, member) {
  if (!sessionId || !member?.modelId || !member?.providerId) return;
  activeTierAttemptMembers.set(sessionId, { modelId: member.modelId, providerId: member.providerId });
}

/**
 * Remove the in-flight attempt registration for `sessionId`. Called when the
 * failover loop exits so late events from an unwinding stream can never pin a
 * session to a member that is no longer running.
 *
 * @param {string} sessionId
 */
export function clearTierAttemptMember(sessionId) {
  activeTierAttemptMembers.delete(sessionId);
}

/**
 * Idempotently pin a tier-bound session to the concrete member identified by
 * `member`: the tier reference stays in `session.model`; only the concrete
 * resolution snapshot (`resolvedModel` / `resolvedProviderId`) is written.
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
 * exactly this snapshot, so repeated activity events cannot rewrite it or
 * cause duplicate side effects.
 *
 * @param {string} sessionId
 * @param {{ modelId: string, providerId: string }} member
 * @returns {boolean} true when a new snapshot was written
 */
export function pinSessionToTierMember(sessionId, member) {
  if (!member?.modelId || !member?.providerId) return false;
  const session = sessions.getById(sessionId);
  if (!session || !isTierRef(session.model)) return false;
  if (session.resolvedModel === member.modelId && session.resolvedProviderId === member.providerId) {
    return false;
  }
  sessions.update(sessionId, {
    model: session.model,
    resolvedModel: member.modelId,
    resolvedProviderId: member.providerId,
  });
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
 * @param {string} sessionId
 * @returns {boolean} true when a new snapshot was written
 */
export function pinTierMemberOnDurableActivity(sessionId) {
  const member = activeTierAttemptMembers.get(sessionId);
  if (!member) return false;
  return pinSessionToTierMember(sessionId, member);
}
