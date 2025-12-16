import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    sessions: [],
    activeSessions: [],
    currentSession: null,
    messages: [],
    loading: false,
    error: null,
  }),

  getters: {
    getSessionById: (state) => (id) => {
      return state.sessions.find((s) => s.id === id);
    },
  },

  actions: {
    async fetchActiveSessions(showLoading = true) {
      if (showLoading) this.loading = true;
      this.error = null;
      try {
        this.activeSessions = await api.getActiveSessions();
      } catch (err) {
        this.error = err.message;
      } finally {
        if (showLoading) this.loading = false;
      }
    },

    async fetchSessions(projectId) {
      this.loading = true;
      this.error = null;
      try {
        this.sessions = await api.getProjectSessions(projectId);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchSession(id, showLoading = true) {
      if (showLoading) this.loading = true;
      this.error = null;
      try {
        this.currentSession = await api.getSession(id);
      } catch (err) {
        this.error = err.message;
      } finally {
        if (showLoading) this.loading = false;
      }
    },

    async fetchMessages(sessionId, showLoading = true) {
      if (showLoading) this.loading = true;
      this.error = null;
      try {
        this.messages = await api.getSessionMessages(sessionId);
      } catch (err) {
        this.error = err.message;
      } finally {
        if (showLoading) this.loading = false;
      }
    },

    async createSession(projectId, data) {
      this.loading = true;
      this.error = null;
      try {
        const session = await api.createSession(projectId, data);
        this.sessions.unshift(session);
        return session;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    async sendMessage(sessionId, content) {
      this.error = null;
      try {
        await api.sendMessage(sessionId, content);
        // Optimistically update status to 'running' immediately after send succeeds
        // This ensures the UI shows "Claude is working..." without waiting for WebSocket
        const session = this.sessions.find((s) => s.id === sessionId);
        if (session) {
          session.status = 'running';
        }
        if (this.currentSession?.id === sessionId) {
          this.currentSession.status = 'running';
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async stopSession(id) {
      this.error = null;
      try {
        await api.stopSession(id);
        if (this.currentSession?.id === id) {
          this.currentSession.status = 'completed';
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async endSession(id) {
      this.error = null;
      try {
        await api.endSession(id);
        if (this.currentSession?.id === id) {
          this.currentSession.status = 'completed';
        }
        const session = this.sessions.find((s) => s.id === id);
        if (session) {
          session.status = 'completed';
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    async deleteSession(id) {
      this.error = null;
      try {
        await api.deleteSession(id);
        // Remove session from list
        this.sessions = this.sessions.filter((s) => s.id !== id);
        // Clear current session if it's the deleted one
        if (this.currentSession?.id === id) {
          this.currentSession = null;
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      }
    },

    addMessage(message) {
      this.messages.push(message);
    },

    updateSessionStatus(sessionId, status) {
      const session = this.sessions.find((s) => s.id === sessionId);
      if (session) {
        session.status = status;
      }
      if (this.currentSession?.id === sessionId) {
        this.currentSession.status = status;
      }
    },
  },
});
