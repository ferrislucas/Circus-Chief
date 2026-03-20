import { api } from '../../composables/useApi.js';

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
      this.currentSession = await api.getSession(id);
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

  /**
   * Merge sessionData into the given list at the matching index, or unshift a fallback entry.
   * @param {Array} list - The session list to upsert into
   * @param {Object} sessionData - The data to merge
   * @param {Object|null} fallback - Existing session copy to merge with, or null
   */
  _upsertIntoList(list, sessionData, fallback) {
    const index = list.findIndex((s) => s.id === sessionData.id);
    if (index !== -1) {
      list[index] = { ...list[index], ...sessionData };
    } else {
      list.unshift(fallback ? { ...fallback, ...sessionData } : sessionData);
    }
  },

  /**
   * Merge sessionData into the given list at the matching index (if found).
   */
  _mergeIfPresent(list, sessionData) {
    const index = list.findIndex((s) => s.id === sessionData.id);
    if (index !== -1) list[index] = { ...list[index], ...sessionData };
  },

  _handleArchived(sessionData) {
    const existing = this.sessions.find(s => s.id === sessionData.id);
    const existingCopy = existing ? { ...existing } : null;
    this.sessions = this.sessions.filter((s) => s.id !== sessionData.id);
    this.activeSessions = this.activeSessions.filter((s) => s.id !== sessionData.id);
    this._upsertIntoList(this.archivedSessions, sessionData, existingCopy);
  },

  _handleUnarchived(sessionData) {
    const existing = this.archivedSessions.find(s => s.id === sessionData.id);
    const existingCopy = existing ? { ...existing } : null;
    this.archivedSessions = this.archivedSessions.filter((s) => s.id !== sessionData.id);
    this._upsertIntoList(this.sessions, sessionData, existingCopy);
  },

  updateSession(sessionData) {
    if (!sessionData?.id) return;

    if (sessionData.archived === true) {
      this._handleArchived(sessionData);
    } else if (sessionData.archived === false) {
      this._handleUnarchived(sessionData);
    } else {
      this._mergeIfPresent(this.sessions, sessionData);
      this._mergeIfPresent(this.archivedSessions, sessionData);
    }

    if (this.currentSession?.id === sessionData.id) this.currentSession = { ...this.currentSession, ...sessionData };
    this._mergeIfPresent(this.activeSessions, sessionData);

    if (sessionData.status === 'scheduled') {
      this._upsertIntoList(this.scheduledSessions, sessionData, null);
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
