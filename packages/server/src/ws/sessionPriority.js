import { WS_MESSAGE_TYPES } from '@circuschief/shared';

function isActiveSessionStatus(status) {
  return status === 'starting' || status === 'running';
}

/**
 * A priority memo is only meaningful for a real session object carrying its
 * id. Anything else cannot change priority, so the decide path skips it and
 * the record path refuses to memoize it.
 */
export function hasSessionPriorityShape(session, sessionId) {
  return session !== null && typeof session === 'object'
    && typeof sessionId === 'string' && sessionId.length > 0;
}

export function isSessionLifecycleEvent(type) {
  return [WS_MESSAGE_TYPES.SESSION_CREATED, WS_MESSAGE_TYPES.SESSION_UPDATED, WS_MESSAGE_TYPES.SESSION_DELETED].includes(type);
}

export function hasPriorityChanged(previous, next) {
  return previous.providerId !== next.providerId
    || isActiveSessionStatus(previous.status) !== isActiveSessionStatus(next.status);
}

/**
 * Recency watermark for the MRU ordering input. Accepts both the
 * repository's camelCase `updatedAt` and raw snake_case `updated_at` shapes;
 * anything else carries no recency signal.
 */
export function sessionRecencyOf(session) {
  const raw = session?.updatedAt ?? session?.updated_at;
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * True when the update proves recency moved: it carries a timestamp and the
 * memo has nothing newer to compare against or an older one. Duplicate and
 * stale redeliveries stay suppressed.
 */
export function hasRecencyAdvanced(previous, next) {
  return next.updatedAt !== null
    && (previous.updatedAt == null || next.updatedAt > previous.updatedAt);
}
