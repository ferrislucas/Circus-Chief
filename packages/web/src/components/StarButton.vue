<template>
  <button
    class="star-button"
    :class="[sizeClass, { 'is-starred': starred, 'is-loading': loading }]"
    :disabled="disabled || loading"
    @click="handleToggle"
    :title="starred ? 'Unstar session' : 'Star session'"
  >
    <span class="star-icon">{{ starred ? '⭐' : '☆' }}</span>
  </button>
</template>

<script>
import { ref } from 'vue';
import { useSessionsStore } from '../stores/sessions';
import { useUIStore } from '../stores/ui';

export default {
  name: 'StarButton',
  props: {
    sessionId: {
      type: String,
      required: true,
    },
    starred: {
      type: Boolean,
      default: false,
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    size: {
      type: String,
      enum: ['small', 'medium', 'large'],
      default: 'medium',
    },
  },
  emits: ['toggle'],
  setup(props, { emit }) {
    const sessionsStore = useSessionsStore();
    const uiStore = useUIStore();
    const loading = ref(false);

    const sizeClass = {
      small: 'text-xs',
      medium: 'text-sm',
      large: 'text-lg',
    }[props.size];

    const handleToggle = async () => {
      loading.value = true;
      try {
        await sessionsStore.toggleSessionStar(props.sessionId);
        emit('toggle');
      } catch (err) {
        uiStore.error('Failed to toggle star');
      } finally {
        loading.value = false;
      }
    };

    return {
      loading,
      sizeClass,
      handleToggle,
    };
  },
};
</script>

<style scoped>
.star-button {
  background: none;
  border: none;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  border-radius: 0.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: text-gray-400;
}

.star-button:hover:not(:disabled) {
  background-color: rgba(34, 197, 94, 0.1);
  color: text-emerald-400;
}

.star-button.is-starred {
  color: #fbbf24;
}

.star-button.is-starred:hover:not(:disabled) {
  background-color: rgba(251, 191, 36, 0.1);
}

.star-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.star-button.is-loading {
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.star-icon {
  display: inline-block;
  font-style: normal;
  line-height: 1;
}
</style>
