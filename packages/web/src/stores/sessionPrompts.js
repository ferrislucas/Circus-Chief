import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { useUiStore } from './ui.js';

export const useSessionPromptsStore = defineStore('sessionPrompts', {
  state: () => ({ prompt: null, submitting: false, versions: {} }),
  actions: {
    bumpVersion(sessionId) { this.versions[sessionId] = (this.versions[sessionId] || 0) + 1; },
    async hydrate(sessionId) {
      const version = this.versions[sessionId] || 0;
      const prompt = await api.getSessionPrompt(sessionId);
      // A websocket mutation after this request began is newer than its response.
      if ((this.versions[sessionId] || 0) === version) this.prompt = prompt;
    },
    show(prompt) { if (prompt?.sessionId) this.bumpVersion(prompt.sessionId); this.prompt = prompt; },
    resolved(promptId) { if (this.prompt?.id === promptId) { this.bumpVersion(this.prompt.sessionId); this.prompt = null; } },
    async respond(sessionId, response) {
      if (!this.prompt || this.submitting) return;
      const promptId = this.prompt.id;
      this.submitting = true;
      try {
        await api.respondToSessionPrompt(sessionId, promptId, response);
        this.resolved(promptId);
      } catch (error) {
        const status = error?.status || error?.response?.status;
        if (status === 409) {
          await this.hydrate(sessionId);
          useUiStore().warning('This prompt was already answered in another tab.');
        } else {
          useUiStore().error(error?.message || 'Unable to send prompt response.');
        }
      }
      finally { this.submitting = false; }
    },
    clear() { if (this.prompt?.sessionId) this.bumpVersion(this.prompt.sessionId); this.prompt = null; this.submitting = false; },
  },
});
