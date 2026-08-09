import { attachments, conversations, messages, projects, sessions } from '../database.js';

export class SharedDataError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'SharedDataError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Async facade over host-owned repositories. It deliberately exposes domain
 * operations rather than a database handle so a remote implementation can use
 * exactly the same runtime boundary.
 */
export class LocalDataStore {
  constructor(repositories = { sessions, messages, conversations, projects, attachments }) {
    this.repositories = repositories;
    this.supportsAtomicClaims = typeof repositories.sessions.claimScheduled === 'function';
    this.sessions = {
      getById: async (id) => repositories.sessions.getById(id),
      update: async (id, data) => repositories.sessions.update(id, data),
      getScheduledDue: async (now) => repositories.sessions.getScheduledSessionsDue(now),
      claimScheduled: async (id, expectedScheduledAt, claimedAt) => {
        // The fallback keeps legacy test doubles usable; real repositories
        // always provide the atomic method.
        const result = repositories.sessions.claimScheduled
          ? repositories.sessions.claimScheduled(id, expectedScheduledAt, claimedAt)
          : repositories.sessions.getById(id);
        if (!result) throw new SharedDataError('CONFLICT', 'Scheduled session was already claimed');
        return result;
      },
    };
    this.messages = {
      getBySessionId: async (id) => repositories.messages.getBySessionId(id),
      getByConversationId: async (id) => repositories.messages.getByConversationId(id),
      create: async (sessionId, role, content, options) => repositories.messages.create(sessionId, role, content, options),
    };
    this.conversations = {
      getActiveBySessionId: async (id) => repositories.conversations.getActiveBySessionId(id),
    };
    this.projects = { getById: async (id) => repositories.projects.getById(id) };
    this.attachments = {
      getBySessionId: async (id) => repositories.attachments.getBySessionId(id),
      updateMessageIdForSession: async (sessionId, messageId) => repositories.attachments.updateMessageIdForSession(sessionId, messageId),
    };
  }
}

let defaultStore;
export function getSharedDataStore() {
  defaultStore ??= new LocalDataStore();
  return defaultStore;
}
