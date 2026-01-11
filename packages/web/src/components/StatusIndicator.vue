<template>
  <span
    :class="['status-indicator', `status-${status}`, { 'status-animated': isAnimated }]"
    :role="isAnimated ? 'progressbar' : 'status'"
    :aria-label="ariaLabel"
  >
    <span class="status-icon">{{ statusIcon }}</span>
    <span class="status-text">{{ statusText }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  status: {
    type: String,
    required: true,
    validator: (value) => ['running', 'starting', 'waiting', 'completed', 'error'].includes(value)
  }
});

const statusTexts = {
  running: 'Running',
  starting: 'Starting...',
  waiting: 'Waiting',
  completed: 'Completed',
  error: 'Error'
};

const statusIcons = {
  running: '●',
  starting: '○',
  waiting: '◐',
  completed: '✓',
  error: '!'
};

const statusText = computed(() => statusTexts[props.status]);
const statusIcon = computed(() => statusIcons[props.status]);

const isAnimated = computed(() => {
  return props.status === 'running' || props.status === 'starting';
});

const ariaLabel = computed(() => {
  return `Session is ${statusText.value.toLowerCase()}`;
});
</script>

<style scoped>
.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  border-radius: 9999px;
  white-space: nowrap;
}

/* Status variants */
.status-running,
.status-starting {
  background: rgba(34, 211, 238, 0.1);
  color: rgb(34, 211, 238);
}

.status-waiting {
  background: rgba(251, 191, 36, 0.1);
  color: rgb(251, 191, 36);
}

.status-completed {
  background: rgba(74, 222, 128, 0.1);
  color: rgb(74, 222, 128);
}

.status-error {
  background: rgba(248, 113, 113, 0.1);
  color: rgb(248, 113, 113);
}

/* Animation for running/starting states */
.status-animated .status-icon {
  animation: pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.status-text {
  font-weight: 500;
}
</style>
