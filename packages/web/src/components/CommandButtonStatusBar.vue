<template>
  <div v-if="buttonStatuses.length > 0" class="command-status-bar" data-testid="button-status-bar">
    <span
      v-for="indicator in buttonStatuses"
      :key="indicator.buttonId"
      :class="['button-status-indicator', `button-status-${indicator.status}`]"
      :title="`${indicator.label}: ${indicator.status}`"
      data-testid="button-status-indicator"
      @click="selectedButtonForModal = indicator"
    >{{ getStatusIcon(indicator.status) }}</span>
    <!-- Button Status Modal -->
    <ButtonStatusModal
      v-if="selectedButtonForModal"
      :button="{ label: selectedButtonForModal.label, command: selectedButtonForModal.command }"
      :latest-run="selectedButtonForModal.latestRun"
      :is-open="!!selectedButtonForModal"
      :session-id="sessionId"
      @close="selectedButtonForModal = null"
    />
  </div>
</template>

<script setup>
import { ref, defineProps } from 'vue';
import ButtonStatusModal from './ButtonStatusModal.vue';

const props = defineProps({
  buttonStatuses: {
    type: Array,
    default: () => [],
  },
  sessionId: {
    type: String,
    default: '',
  },
});

const selectedButtonForModal = ref(null);

const getStatusIcon = (status) => {
  switch (status) {
    case 'running':
      return '⊙';
    case 'success':
      return '✓';
    case 'error':
      return '✕';
    case 'killed':
      return '✕';
    default:
      return '';
  }
};
</script>

<style scoped>
.command-status-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.button-status-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  border: 1px solid transparent;
  font-size: 0.875rem;
  font-weight: 600;
}

.button-status-indicator:hover {
  transform: scale(1.15);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
}

.button-status-running {
  background-color: rgba(210, 153, 34, 0.3);
  color: #d29922;
  border-color: #d29922;
  animation: pulse 1.5s ease-in-out infinite;
}

.button-status-success {
  background-color: rgba(63, 185, 80, 0.3);
  color: #3fb950;
  border-color: #3fb950;
}

.button-status-error {
  background-color: rgba(248, 81, 73, 0.3);
  color: #f85149;
  border-color: #f85149;
}

.button-status-killed {
  background-color: rgba(248, 81, 73, 0.3);
  color: #f85149;
  border-color: #f85149;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

@media (max-width: 768px) {
  .command-status-bar {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .status-label {
    font-size: 0.8rem;
  }

  .button-status-indicator {
    width: 1.375rem;
    height: 1.375rem;
    font-size: 0.8rem;
  }
}
</style>
