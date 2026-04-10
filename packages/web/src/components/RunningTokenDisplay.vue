<template>
  <div
    v-if="hasNonZeroCost"
    class="running-token-display"
  >
    <span class="cost-label">Cost:</span>
    <span class="cost-value">{{ formattedBillableTokens }}</span>
    <span
      v-if="isUpdating"
      class="updating-indicator"
    >
      <span class="dot" />
      <span class="dot" />
      <span class="dot" />
    </span>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useSettingsStore } from '../stores/settings.js';

const sessionsStore = useSessionsStore();
const settingsStore = useSettingsStore();

// Ensure settings are loaded
settingsStore.fetchTokenCostWeights();

// Get the formatted BTE cost score
const formattedBillableTokens = computed(() => sessionsStore.formattedBillableTokens || '0');

// Check if cost is non-zero
const hasNonZeroCost = computed(() => {
  const cost = formattedBillableTokens.value;
  return cost && cost !== '0' && cost !== '-' && cost !== '0.0';
});

// Show updating indicator when session is running
const isUpdating = computed(() => sessionsStore.currentSession?.status === 'running');
</script>

<style scoped>
.running-token-display {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.625rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  font-size: 0.8125rem;
}

.cost-label {
  color: var(--color-text-soft);
  font-weight: 500;
}

.cost-value {
  font-family: var(--font-mono);
  color: var(--color-accent);
  font-weight: 600;
}

.updating-indicator {
  display: flex;
  gap: 0.125rem;
  align-items: center;
  margin-left: 0.125rem;
}

.updating-indicator .dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: var(--color-accent);
  animation: pulse 1.4s ease-in-out infinite;
}

.updating-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.updating-indicator .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes pulse {
  0%, 80%, 100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
