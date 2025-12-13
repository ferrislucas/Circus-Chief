import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const useSessionsStore = defineStore('sessions', {
  state: () => ({
    sessions: [],
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

    async fetchSession(id) {
      this.loading = true;
      this.error = null;
      try {
        this.currentSession = await api.getSession(id);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    async fetchMessages(sessionId) {
      this.loading = true;
      this.error = null;
      try {
        this.messages = await api.getSessionMessages(sessionId);
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
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
