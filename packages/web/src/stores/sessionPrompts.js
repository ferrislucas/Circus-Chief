import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { useUiStore } from './ui.js';

export const useSessionPromptsStore = defineStore('sessionPrompts', {
  state: () => ({ prompt: null, submitting: false }),
  actions: {
    async hydrate(sessionId) { this.prompt = await api.getSessionPrompt(sessionId); },
    show(prompt) { this.prompt = prompt; },
    resolved(promptId) { if (this.prompt?.id === promptId) this.prompt = null; },
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
    clear() { this.prompt = null; this.submitting = false; },
  },
});
