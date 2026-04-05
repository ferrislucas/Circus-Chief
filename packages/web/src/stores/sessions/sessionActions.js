import { api } from '../../composables/useApi.js';

/**
 * Update a session in a list, or add it if not found.
 * @param {Array} list - The list to update
 * @param {Object} sessionData - The session data
 * @param {boolean} addIfMissing - Whether to add the session if not found
 */
function updateSessionInList(list, sessionData, addIfMissing = false) {
  const index = list.findIndex((s) => s.id === sessionData.id);
  if (index !== -1) {
    list[index] = { ...list[index], ...sessionData };
  } else if (addIfMissing) {
    list.unshift(sessionData);
  }
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
  sourceList.splice(0, sourceList.length, ...sourceList.filter((s) => s.id !== sessionData.id));
  updateSessionInList(targetList, merged, true);
}

/**
 * Session CRUD and lifecycle actions for the sessions store.
 * These are spread directly into the Pinia store actions, so `this` refers to the store instance.
 */
export const sessionActions = {
  async fetchActiveSessions(showLoading = true) {
    if (showLoading) this.loading = true;
    this.error = null;
    try { this.activeSessions = await api.getActiveSessions(); }
    catch (err) { this.error = err.message; }
    finally { if (showLoading) this.loading = false; }
  },

  async fetchScheduledSessions(projectId = null) {
    this.loadingScheduled = true;
    this.error = null;
    try {
      const sessions = await api.getScheduledSessions(projectId);
      this.scheduledSessions = sessions.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    } catch (err) {
      this.error = err.message;
      console.error('Failed to fetch scheduled sessions:', err);
    } finally { this.loadingScheduled = false; }
  },

  async fetchSessions(projectId) {
    this.loading = true;
    this.error = null;
    try { this.sessions = await api.getProjectSessions(projectId, false, null); }
    catch (err) { this.error = err.message; }
    finally { this.loading = false; }
  },

  async fetchArchivedSessions(projectId, { reset = true } = {}) {
    const PAGE_SIZE = 25;
    if (reset) { this.archivedSessions = []; this.archivedPagination.offset = 0; }
    this.archivedPagination.loading = true;
    this.error = null;
    try {
      const response = await api.getProjectSessions(
        projectId, true, this.starredFilter, { limit: PAGE_SIZE, offset: this.archivedPagination.offset }
      );
      this.archivedSessions = reset ? response.sessions : [...this.archivedSessions, ...response.sessions];
      this.archivedPagination = {
        total: response.pagination.total,
        offset: this.archivedPagination.offset + response.sessions.length,
        hasMore: response.pagination.hasMore, loading: false,
      };
    } catch (err) { this.error = err.message; this.archivedPagination.loading = false; }
  },

  async loadMoreArchivedSessions(projectId) {
    if (this.archivedPagination.hasMore && !this.archivedPagination.loading) {
      await this.fetchArchivedSessions(projectId, { reset: false });
    }
  },

  async fetchSession(id, showLoading = true) {
    if (showLoading) this.loading = true;
    this.error = null;
    try {
      const fetchedSession = await api.getSession(id);
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
      if (this.currentSession?.parentSessionId) {
        let parentId = this.currentSession.parentSessionId;
        while (parentId) {
          const existingParent = this.sessions.find((s) => s.id === parentId);
          if (existingParent) { parentId = existingParent.parentSessionId; continue; }
          try {
            const parentSession = await api.getSession(parentId);
            this.sessions.push(parentSession);
            parentId = parentSession.parentSessionId;
          } catch (error) { console.error('Failed to fetch parent session:', error); break; }
        }
      }
      if (this.currentSession?.projectId) {
        try {
          const projectSessions = await api.getProjectSessions(this.currentSession.projectId);
          const childSessions = projectSessions.filter(s => s.parentSessionId === id);
          const newChildren = childSessions.filter(child => !this.sessions.find(s => s.id === child.id));
          this.sessions.push(...newChildren);
        } catch (error) { console.error('Failed to fetch child sessions:', error); }
      }
    } catch (err) { this.error = err.message; }
    finally { if (showLoading) this.loading = false; }
  },

  async createSession(projectId, data) {
    this.loading = true;
    this.error = null;
    try {
      const session = await api.createSession(projectId, data);
      this.sessions.unshift(session);
      return session;
    } catch (err) { this.error = err.message; throw err; }
    finally { this.loading = false; }
  },

  async sendMessage(sessionId, content, files = [], model = null) {
    this.error = null;
    try {
      await api.sendMessage(sessionId, content, files, model);
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

  async startSession(id, prompt = undefined, model = undefined) {
    this.error = null;
    try {
      const result = await api.startSession(id, prompt, model);
      this._updateSessionInAllLists(id, { status: 'starting' });
      return result;
    } catch (err) { this.error = err.message; throw err; }
  },

  async deleteSession(id) {
    this.error = null;
    try {
      await api.deleteSession(id);
      this.sessions = this.sessions.filter((s) => s.id !== id);
      this.archivedSessions = this.archivedSessions.filter((s) => s.id !== id);
      if (this.currentSession?.id === id) this.currentSession = null;
    } catch (err) { this.error = err.message; throw err; }
  },

  async archiveSession(id) {
    this.error = null;
    try {
      const updated = await api.archiveSession(id);
      this.sessions = this.sessions.filter((s) => s.id !== id);
      this.archivedSessions.unshift(updated);
      this.activeSessions = this.activeSessions.filter((s) => s.id !== id);
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
      this._updateSessionInAllLists(sessionId, updateData);
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
      moveSessionBetweenLists(this.sessions, this.archivedSessions, sessionData);
      this.activeSessions = this.activeSessions.filter((s) => s.id !== sessionData.id);
    } else if (sessionData.archived === false) {
      moveSessionBetweenLists(this.archivedSessions, this.sessions, sessionData);
    } else {
      // Regular update - update in both lists
      updateSessionInList(this.sessions, sessionData);
      updateSessionInList(this.archivedSessions, sessionData);
    }

    // Update current session and active sessions
    if (this.currentSession?.id === sessionData.id) {
      this.currentSession = { ...this.currentSession, ...sessionData };
    }
    updateSessionInList(this.activeSessions, sessionData);

    // Handle scheduled sessions
    if (sessionData.status === 'scheduled') {
      updateSessionInList(this.scheduledSessions, sessionData, true);
      this.scheduledSessions.sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
    } else {
      this.scheduledSessions = this.scheduledSessions.filter((s) => s.id !== sessionData.id);
    }
  },

  addSessionToList(session) {
    if (!session?.id) return;
    if (!this.sessions.some((s) => s.id === session.id)) this.sessions.unshift(session);
    if (['running', 'waiting', 'starting'].includes(session.status)) {
      if (!this.activeSessions.some((s) => s.id === session.id)) this.activeSessions.unshift(session);
    }
  },

  removeSessionFromList(sessionId) {
    if (!sessionId) return;
    this.sessions = this.sessions.filter((s) => s.id !== sessionId);
    this.archivedSessions = this.archivedSessions.filter((s) => s.id !== sessionId);
    this.activeSessions = this.activeSessions.filter((s) => s.id !== sessionId);
    if (this.currentSession?.id === sessionId) this.currentSession = null;
  },
};
