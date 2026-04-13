import { defineStore } from 'pinia';
import { TOAST_DURATION } from '@circuschief/shared';

let toastId = 0;

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [],
    modalOpen: null,
    loading: false,
  }),

  actions: {
    addToast(type, message, duration = TOAST_DURATION) {
      const id = ++toastId;
      this.toasts.push({ id, type, message });

      if (duration > 0) {
        setTimeout(() => {
          this.removeToast(id);
        }, duration);
      }

      return id;
    },

    removeToast(id) {
      this.toasts = this.toasts.filter((t) => t.id !== id);
    },

    success(message) {
      return this.addToast('success', message);
    },

    error(message) {
      return this.addToast('error', message);
    },

    warning(message) {
      return this.addToast('warning', message);
    },

    info(message) {
      return this.addToast('info', message);
    },

    openModal(modalId) {
      this.modalOpen = modalId;
    },

    closeModal() {
      this.modalOpen = null;
    },

    setLoading(loading) {
      this.loading = loading;
    },
  },
});
