import { api } from '../../composables/useApi.js';

// AbortControllers are intentionally kept outside Pinia state: they are
// request-lifecycle objects, not application state. A WeakMap also lets each
// store instance maintain independent per-session requests without relying on
// Vue's handling of non-plain objects.
const sessionFetchControllers = new WeakMap();

function getSessionFetchControllers(store) {
  let controllers = sessionFetchControllers.get(store);
  if (!controllers) {
    controllers = new Map();
    sessionFetchControllers.set(store, controllers);
  }
  return controllers;
}

/**
 * Update a session in a list, or add it if not found.
 * @param {Array} listInput - The list to update
 * @param {Object} sessionData - The session data
 * @param {boolean} addIfMissing - Whether to add the session if not found
 */
function updateSessionInList(listInput, sessionData, addIfMissing = false) {
  const list = listInput;
  const index = list.findIndex((s) => s.id === sessionData.id);
  if (index !== -1) {
    list[index] = { ...list[index], ...sessionData };
  } else if (addIfMissing) {
    list.unshift(sessionData);
  }
}

function getDescendantSessionIds(sessions, sessionId) {
  const descendantIds = [];
  const visited = new Set([sessionId]);
  const stack = [sessionId];

  while (stack.length > 0) {
    const currentId = stack.pop();
    const children = sessions.filter((session) => session.parentSessionId === currentId);

    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      descendantIds.push(child.id);
      stack.push(child.id);
    }
  }

  return descendantIds;
}

/**
 * Move a session between lists (e.g., archive/unarchive).
 * @param {Array} sourceList - The list to remove from
 * @param {Array} targetList - The list to add to
 * @param {Object} sessionData - The session data
 */

function moveSessionBetweenLists(sourceList, targetList, sessionData) {
  const existingSession = sourceList.find((s) => s.id === sessionData.id);
  const merged = existingSession ? { ...existingSession, ...sessionData } : sessionData;
  updateSessionInList(targetList, merged, true);
  return sourceList.filter((s) => s.id !== sessionData.id);
}

/**
 * Session CRUD and lifecycle actions for the sessions store.
 * These are spread directly into the Pinia store actions, so `this` refers to the store instance.
 */
export const sessionActions = {
  async fetchSessions(projectId, { silent = false } = {}) {
    // Capture a unique token for this call. Any response that resolves after a
    // newer fetch has started will be discarded — covering cross-project (A→B)
    // and same-project (A→B→A) races alike.
    const seq = ++this.sessionsFetchSeq;
    if (!silent) {
      this.loading = true;
      // Clear stale rows immediately so the previous project's list never
      // renders under the new project's heading.
      this.sessions = [];
    }
    this.error = null;
    try {
      const result = await api.getProjectSessions(projectId, false, null);
      // Guard: discard if a newer fetch has superseded this one.
      if (seq !== this.sessionsFetchSeq) return;
      // Normalize: guard against non-array API responses (e.g. null).
      const rows = Array.isArray(result) ? result : [];
      // Defensive filter: drop rows that explicitly belong to a different project.
      // Only applies when the row carries a projectId field (backward compat with
      // older API responses or test fixtures that omit the field).
      this.sessions = rows.filter(s => !s.projectId || s.projectId === projectId);
    } catch (err) {
      if (seq !== this.sessionsFetchSeq) return;
      this.error = err.message;
    } finally {
      // Only clear the loading flag if this fetch still owns the slot.
      if (!silent && seq === this.sessionsFetchSeq) this.loading = false;
    }
  },

  async fetchSession(id, showLoading = true) {
    const controllers = getSessionFetchControllers(this);
    controllers.get(id)?.abort();
    const controller = new AbortController();
    controllers.set(id, controller);
    if (showLoading) this.loading = true;
    this.error = null;
    try {
      const fetchedSession = await api.getSession(id, { signal: controller.signal });
      // Guard: only set currentSession if the user is still viewing this session.
      // This prevents stale in-flight requests (e.g., from polling that was active
      // for a previous session) from overwriting currentSession after navigation.
      if (this.viewedSessionId && this.viewedSessionId !== id) {
        // Session changed while we were fetching — discard this result for currentSession
        // but still update the session in list arrays below.
        const sessionIndex = this.sessions.findIndex((s) => s.id === id);
        if (sessionIndex !== -1) this.sessions[sessionIndex] = { ...this.sessions[sessionIndex], ...fetchedSession };
        return;
      }
      this.currentSession = fetchedSession;
      // Add the fetched session to the sessions array if not already present
      // This ensures getSessionById() can find it for computed properties like activeSessionName
      const existingIndex = this.sessions.findIndex((s) => s.id === id);
      if (existingIndex !== -1) {
        this.sessions[existingIndex] = fetchedSession;
      } else {
        this.sessions.push(fetchedSession);
      }
    } catch (err) {
      if (err?.name !== 'AbortError' && controllers.get(id) === controller) this.error = err.message;
    } finally {
      if (controllers.get(id) === controller) {
        controllers.delete(id);
        if (showLoading) this.loading = false;
      }
    }
  },

  async createSession(projectId, data) {
    this.loading = true;
    this.error = null;
    try {
      // POST /api/projects/:id/sessions creates root sessions only — a
      // request that specifies a parentSessionId must go through the
      // workspace route instead, which requires and validates it against
      // the workspace tree. Keeping this branch here means callers (e.g.
      // NewSessionView's "Parent Workspace" picker) don't need to know
      // which endpoint to use.
      const session = data?.parentSessionId
        ? await api.createWorkspaceSession(data.parentSessionId, data)
        : await api.createSession(projectId, data);
      this.sessions.unshift(session);
      return session;
    } catch (err) { this.error = err.message; throw err; }
    finally { this.loading = false; }
  },

  // eslint-disable-next-line max-params -- existing positional send signature plus optional `options` bag
  async sendMessage(sessionId, content, files = [], model = null, options = {}) {
    this.error = null;
    try {
      const sendArgs = [sessionId, content, files, model];
      if (Object.keys(options).length > 0) {
        sendArgs.push(options);
      }
      await api.sendMessage(...sendArgs);
      this._updateSessionInAllLists(sessionId, { status: 'running' });
    } catch (err) { this.error = err.message; throw err; }
  },

  async stopSession(id) {
    this.error = null;
    try { await api.stopSession(id); this._updateSessionInAllLists(id, { status: 'stopped' }); }
    catch (err) { this.error = err.message; throw err; }
  },

  async restartSession(id) {
    this.error = null;
    try { await api.restartSession(id); this._updateSessionInAllLists(id, { status: 'stopped', error: null }); }
    catch (err) { this.error = err.message; throw err; }
  },

  // eslint-disable-next-line max-params -- existing positional start signature plus optional `options` bag
  async startSession(id, prompt = undefined, model = undefined, providerId = undefined, options = {}) {
    this.error = null;
    try {
      const startArgs = [id, prompt, model, providerId];
      if (Object.keys(options).length > 0) {
        startArgs.push(options);
      }
      const result = await api.startSession(...startArgs);
      this._updateSessionInAllLists(id, { status: 'starting' });
      return result;
    } catch (err) { this.error = err.message; throw err; }
  },

  /**
   * Start a scheduled session immediately.
   * @param {string} id - Session ID
   * @param {string} [prompt] - Overrides the persisted pendingPrompt for this
   *   launch, applied atomically with the server's claim. Omit to use
   *   whatever pendingPrompt is already persisted.
   */
  async runScheduledNow(id, prompt) {
    this.error = null;
    try {
      const updated = await api.runScheduledNow(id, prompt !== undefined ? { prompt } : undefined);
      this._updateSessionInAllLists(id, updated);
      return updated;
    } catch (err) { this.error = err.message; throw err; }
  },

  async deleteSession(id) {
    this.error = null;
    const deletedIds = new Set([
      id,
      ...getDescendantSessionIds([...this.sessions, ...this.archivedSessions], id),
    ]);
    try {
      await api.deleteSession(id);
      this.sessions = this.sessions.filter((s) => !deletedIds.has(s.id));
      this.archivedSessions = this.archivedSessions.filter((s) => !deletedIds.has(s.id));
      if (this.currentSession?.id && deletedIds.has(this.currentSession.id)) this.currentSession = null;
    } catch (err) { this.error = err.message; throw err; }
  },

  async archiveSession(id, { cleanup = false } = {}) {
    this.error = null;
    try {
      const updated = await api.archiveSession(id, { cleanup });
      this.sessions = this.sessions.filter((s) => s.id !== id);
      this.archivedSessions.unshift(updated);
      if (this.currentSession?.id === id) this.currentSession = { ...this.currentSession, archived: true };
      return updated;
    } catch (err) { this.error = err.message; throw err; }
  },

  async unarchiveSession(id) {
    this.error = null;
    try {
      const updated = await api.unarchiveSession(id);
      this.archivedSessions = this.archivedSessions.filter((s) => s.id !== id);
      this.sessions.unshift(updated);
      if (this.currentSession?.id === id) this.currentSession = { ...this.currentSession, archived: false };
      return updated;
    } catch (err) { this.error = err.message; throw err; }
  },

  async duplicateSession(id, options = {}) {
    this.error = null;
    try { return await api.duplicateSession(id, options); }
    catch (err) { this.error = err.message; throw err; }
  },

  async toggleSessionStar(sessionId) {
    this.error = null;
    try {
      const updated = await api.toggleSessionStar(sessionId);
      this._updateSessionInAllLists(sessionId, { starred: updated.starred });
      return updated;
    } catch (err) { this.error = err.message; throw err; }
  },

  updateSessionStatus(sessionId, status) {
    const session = this.sessions.find(s => s.id === sessionId) || this.currentSession;
    const wasRunning = session?.status === 'running';
    const updates = { status };
    if (wasRunning && (status === 'waiting' || status === 'completed')) updates.hasResponses = true;
    this._updateSessionInAllLists(sessionId, updates);
  },

  async updateSessionThinking(sessionId, thinkingEnabled) {
    return this.updateSessionFields(sessionId, { thinkingEnabled });
  },

  async updateSessionMode(sessionId, mode) {
    return this.updateSessionFields(sessionId, { mode });
  },

  async updateSessionModel(sessionId, model, providerId = undefined) {
    this.error = null;
    try {
      const updateData = { model };
      if (providerId !== undefined) updateData.providerId = providerId;

      // For draft sessions, also update pendingModel so the backend
      // fallback chain in draftSessionService.startDraft() stays in sync
      const session = this.sessions.find(s => s.id === sessionId)
        || (this.currentSession?.id === sessionId ? this.currentSession : null);
      if (session && session.status === 'waiting') {
        updateData.pendingModel = model;
      }

      const updated = await api.updateSession(sessionId, updateData);
      // Merge the server response (not just updateData) so server-derived fields
      // like agentType and providerId stay in sync after a model change.
      this._updateSessionInAllLists(sessionId, updated);
      return updated;
    } catch (err) { this.error = err.message; throw err; }
  },

  async updateNextTemplate(sessionId, nextTemplateId) {
    return this.updateSessionFields(sessionId, { nextTemplateId });
  },

  async updateAutoSendPendingPrompt(sessionId, autoSendPendingPrompt) {
    return this.updateSessionFields(sessionId, { autoSendPendingPrompt });
  },

  async updateSessionFields(sessionId, updates) {
    this.error = null;
    try {
      const updated = await api.updateSession(sessionId, updates);
      this._updateSessionInAllLists(sessionId, updates);
      return updated;
    } catch (err) { this.error = err.message; throw err; }
  },

  updateSession(sessionData) {
    if (!sessionData?.id) return;

    // Handle archive state changes
    if (sessionData.archived === true) {
      this.sessions = moveSessionBetweenLists(this.sessions, this.archivedSessions, sessionData);
    } else if (sessionData.archived === false) {
      this.archivedSessions = moveSessionBetweenLists(this.archivedSessions, this.sessions, sessionData);
    } else {
      // Regular update - update in both lists
      updateSessionInList(this.sessions, sessionData);
      updateSessionInList(this.archivedSessions, sessionData);
    }

    // Update current session
    if (this.currentSession?.id === sessionData.id) {
      this.currentSession = { ...this.currentSession, ...sessionData };
    }
  },

  addSessionToList(session) {
    if (!session?.id) return;
    if (!this.sessions.some((s) => s.id === session.id)) this.sessions.unshift(session);
  },

  removeSessionFromList(sessionId) {
    if (!sessionId) return;
    this.sessions = this.sessions.filter((s) => s.id !== sessionId);
    this.archivedSessions = this.archivedSessions.filter((s) => s.id !== sessionId);
    if (this.currentSession?.id === sessionId) this.currentSession = null;
  },
};
