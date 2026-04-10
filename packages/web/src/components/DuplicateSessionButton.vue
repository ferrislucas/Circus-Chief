<template>
  <button
    :disabled="isLoading"
    :class="['btn', 'btn-outline-secondary', { 'is-loading': isLoading }]"
    title="Create a copy of this session with all data"
    @click="handleDuplicate"
  >
    <span
      v-if="!isLoading"
      class="button-content"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <g id="group">
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
        </g>
      </svg>
      Duplicate
    </span>
    <span
      v-else
      class="button-content loading"
    >
      <span class="loading-spinner" />
      Duplicating...
    </span>
  </button>
</template>

<script setup>
import { ref } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
  sessionName: {
    type: String,
    required: false,
    default: null,
  },
});

const emit = defineEmits(['success', 'error']);

const isLoading = ref(false);
const sessionsStore = useSessionsStore();
const uiStore = useUiStore();

const handleDuplicate = async () => {
  if (isLoading.value) return;

  if (!confirm('Duplicate this session? A new session will be created with all conversations, canvas items, and notes.')) {
    return;
  }

  isLoading.value = true;
  try {
    // Call the store action to duplicate the session
    const newSession = await sessionsStore.duplicateSession(props.sessionId);

    // Show success notification
    const displayName = newSession.name || `Copy of ${props.sessionName || 'session'}`;
    uiStore.success(`Session duplicated: "${displayName}"`);

    // Emit success event (parent can use this for navigation if needed)
    emit('success', newSession);
  } catch (error) {
    // Show error notification
    const errorMessage = error.message || 'Failed to duplicate session';
    uiStore.error(errorMessage);

    // Emit error event
    emit('error', error);
  } finally {
    isLoading.value = false;
  }
};
</script>

<style scoped>
button.is-loading {
  opacity: 0.7;
  cursor: wait;
}

.button-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.loading-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
