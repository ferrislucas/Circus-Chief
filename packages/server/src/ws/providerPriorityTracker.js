import { WS_MESSAGE_TYPES } from '@circuschief/shared';

/**
 * Tracks per-session provider-priority memos and decides whether a session
 * lifecycle broadcast should trigger a global provider-allowance refetch.
 *
 * Extracted from WebSocketManager to keep that module under the repo's
 * max-lines budget; behavior is unchanged.
 */
export class ProviderPriorityTracker {
  #sessionPriority = new Map();

  /**
   * Evaluate a broadcast session event.
   * @param {string} type - Broadcast message type
   * @param {Object} payload - Broadcast payload
   * @returns {'invalidate'|'suppress'|'malformed'} Decision: send a global
   *   invalidation, stay silent, or (malformed SESSION_UPDATED shape) stay
   *   silent while the caller logs a diagnostic.
   */
  evaluate(type, payload) {
    if (!isSessionLifecycleEvent(type)) return 'suppress';
    const session = payload?.session;
    const sessionId = session?.id ?? payload?.sessionId;
    if (type !== WS_MESSAGE_TYPES.SESSION_UPDATED) {
      this.#recordSessionPriority(type, sessionId, session);
      return 'invalidate';
    }
    // Fail closed: a shape that cannot change priority must not trigger a
    // global refetch. The debounce on the client is a backstop, not the
    // primary defense against malformed emitters.
    if (!hasSessionPriorityShape(session, sessionId)) return 'malformed';
    const next = { status: session.status, providerId: session.providerId, updatedAt: sessionRecencyOf(session) };
    const previous = this.#sessionPriority.get(sessionId);
    this.#sessionPriority.set(sessionId, next);
    return !previous || hasPriorityChanged(previous, next) || hasRecencyAdvanced(previous, next)
      ? 'invalidate'
      : 'suppress';
  }

  #recordSessionPriority(type, sessionId, session) {
    if (type === WS_MESSAGE_TYPES.SESSION_CREATED && hasSessionPriorityShape(session, sessionId)) {
      this.#sessionPriority.set(sessionId, { status: session.status, providerId: session.providerId, updatedAt: sessionRecencyOf(session) });
    }
    if (type === WS_MESSAGE_TYPES.SESSION_DELETED && sessionId) this.#sessionPriority.delete(sessionId);
  }

  /** Clear all memoized session priority state. */
  clear() {
    this.#sessionPriority.clear();
  }
}

function isActiveSessionStatus(status) {
  return status === 'starting' || status === 'running';
}

/**
 * Shared payload-shape validator for the record and decide paths: a
 * priority memo is only meaningful for a real session object carrying its
 * id. Anything else (missing payload, bare session id, null or non-object
 * session) cannot change priority, so the decide path skips it and the
 * record path refuses to memoize it.
 */
function hasSessionPriorityShape(session, sessionId) {
  return session !== null && typeof session === 'object'
    && typeof sessionId === 'string' && sessionId.length > 0;
}

function isSessionLifecycleEvent(type) {
  return [WS_MESSAGE_TYPES.SESSION_CREATED, WS_MESSAGE_TYPES.SESSION_UPDATED, WS_MESSAGE_TYPES.SESSION_DELETED].includes(type);
}

function hasPriorityChanged(previous, next) {
  return previous.providerId !== next.providerId
    || isActiveSessionStatus(previous.status) !== isActiveSessionStatus(next.status);
}

/**
 * Recency watermark for the MRU ordering input (`MAX(sessions.updated_at)`
 * per provider). Every session write bumps `updated_at`, so a same-status
 * update carrying a newer timestamp moved recency even though liveness did
 * not change. Accepts both the repository's camelCase `updatedAt` and raw
 * snake_case `updated_at` shapes; anything else carries no recency signal.
 */
function sessionRecencyOf(session) {
  const raw = session?.updatedAt ?? session?.updated_at;
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * True when the update proves recency moved: it carries a timestamp and the
 * memo has nothing newer to compare against (first timestamp sighting) or an
 * older one. Duplicate and stale out-of-order redeliveries stay suppressed
 * so a duplicated frame cannot cause a refetch. A timestamp-less update
 * falls back to the liveness comparison above.
 */
function hasRecencyAdvanced(previous, next) {
  return next.updatedAt !== null
    && (previous.updatedAt == null || next.updatedAt > previous.updatedAt);
}
