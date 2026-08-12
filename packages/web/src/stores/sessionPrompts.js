import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { useUiStore } from './ui.js';

// Opening a session view mounts several independent consumers
// (ConversationTab, SessionChatContent, useSessionInitializer's reconnect
// handler, ...) that each call `hydrate(sessionId)` on their own lifecycle
// hook, once per session open. Picking a single "owner" among them is
// fragile — it silently regresses the moment the view tree is refactored.
// Instead, concurrent calls for the same session share one in-flight
// request: a hydrate that starts while another for the same session hasn't
// settled yet reuses that promise instead of issuing a second `GET /prompt`.
const inFlightHydrations = new Map();

export const useSessionPromptsStore = defineStore('sessionPrompts', {
  state: () => ({ prompts: {}, submitting: {}, versions: {} }),
  getters: {
    promptFor: (state) => (sessionId) => state.prompts[sessionId] || null,
    isSubmitting: (state) => (sessionId) => Boolean(state.submitting[sessionId]),
  },
  actions: {
    bumpVersion(sessionId) { this.versions[sessionId] = (this.versions[sessionId] || 0) + 1; },
    hydrate(sessionId) {
      const existing = inFlightHydrations.get(sessionId);
      if (existing) return existing;
      const request = this._hydrateNow(sessionId).finally(() => {
        if (inFlightHydrations.get(sessionId) === request) inFlightHydrations.delete(sessionId);
      });
      inFlightHydrations.set(sessionId, request);
      return request;
    },
    async _hydrateNow(sessionId) {
      const version = this.versions[sessionId] || 0;
      const prompt = await api.getSessionPrompt(sessionId);
      // A websocket mutation after this request began is newer than its response.
      if ((this.versions[sessionId] || 0) === version) {
        if (prompt) this.prompts[sessionId] = prompt;
        else delete this.prompts[sessionId];
      }
    },
    show(prompt) { if (!prompt?.sessionId) return; this.bumpVersion(prompt.sessionId); this.prompts[prompt.sessionId] = prompt; },
    resolved(promptId, sessionId) {
      if (this.prompts[sessionId]?.id !== promptId) return;
      this.bumpVersion(sessionId);
      delete this.prompts[sessionId];
      delete this.submitting[sessionId];
    },
    async respond(sessionId, response) {
      const prompt = this.prompts[sessionId];
      if (!prompt || this.submitting[sessionId]) return;
      const promptId = prompt.id;
      this.submitting[sessionId] = true;
      try {
        await api.respondToSessionPrompt(sessionId, promptId, response);
        this.resolved(promptId, sessionId);
      } catch (error) {
        const status = error?.status || error?.response?.status;
        if (status === 409) {
          await this.hydrate(sessionId);
          useUiStore().warning('This prompt was already answered in another tab.');
        } else {
          useUiStore().error(error?.message || 'Unable to send prompt response.');
        }
      }
      finally { delete this.submitting[sessionId]; }
    },
    clear(sessionId) {
      if (!sessionId) return;
      this.bumpVersion(sessionId);
      delete this.prompts[sessionId];
      delete this.submitting[sessionId];
    },
  },
});
