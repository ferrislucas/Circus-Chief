<template>
  <div
    v-if="buttonStatuses.length > 0"
    class="command-status-bar"
    data-testid="button-status-bar"
  >
    <span
      v-for="indicator in buttonStatuses"
      :key="indicator.buttonId"
      :class="['button-status-indicator', `button-status-${indicator.status}`]"
      :title="`${indicator.label}: ${indicator.status}`"
      :aria-label="indicator.status"
      data-testid="button-status-indicator"
      @click="selectedButtonForModal = indicator"
      v-html="getStatusIcon(indicator.status)"
    ></span>
    <!-- Button Status Modal -->
    <ButtonStatusModal
      v-if="selectedButtonForModal"
      :button="{ id: selectedButtonForModal.buttonId, label: selectedButtonForModal.label, command: selectedButtonForModal.command }"
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
import { getStatusIconSvg } from './statusIcons';

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

const getStatusIcon = (status) => getStatusIconSvg(status);
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
}

.button-status-indicator svg {
  width: 0.875rem;
  height: 0.875rem;
}

.button-status-indicator:hover {
  transform: scale(1.15);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
}

.button-status-running {
  background-color: rgba(210, 153, 34, 0.3);
  color: #d29922;
  border-color: #d29922;
  animation: hourglass-flip 2s ease-in-out infinite;
}

.button-status-success {
  background-color: rgba(63, 185, 80, 0.3);
  color: #3fb950;
  border-color: #3fb950;
}

.button-status-success svg {
  animation: pop-in 0.3s ease-out;
}

.button-status-error {
  background-color: rgba(248, 81, 73, 0.3);
  color: #f85149;
  border-color: #f85149;
}

.button-status-error svg {
  animation: shake 0.4s ease-in-out;
}

.button-status-killed {
  background-color: rgba(248, 81, 73, 0.3);
  color: #f85149;
  border-color: #f85149;
}

@keyframes hourglass-flip {
  0%, 80%   { transform: rotate(0deg); }
  90%       { transform: rotate(180deg); }
  100%      { transform: rotate(180deg); }
}

@keyframes pop-in {
  0%   { transform: scale(0); }
  70%  { transform: scale(1.2); }
  100% { transform: scale(1); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-2px); }
  75%      { transform: translateX(2px); }
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
  }
}
</style>
