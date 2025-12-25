<template>
  <div class="token-usage-panel">
    <div class="usage-header">
      <span class="usage-title">Token Usage</span>
      <span v-if="isUpdating" class="updating-indicator">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </span>
    </div>
    <div class="usage-stats">
      <div class="stat">
        <span class="stat-label">Input</span>
        <span class="stat-value">{{ formattedTokens.input }}</span>
      </div>
      <div class="stat">
        <span class="stat-label">Output</span>
        <span class="stat-value">{{ formattedTokens.output }}</span>
      </div>
      <div class="stat stat-total">
        <span class="stat-label">Total</span>
        <span class="stat-value">{{ formattedTokens.total }}</span>
      </div>
    </div>
    <div v-if="showDetails" class="usage-details">
      <div class="detail-row">
        <span class="detail-label">Cache Read</span>
        <span class="detail-value">{{ formattedTokens.cacheRead }}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Cache Creation</span>
        <span class="detail-value">{{ formattedTokens.cacheCreation }}</span>
      </div>
      <div v-if="contextPercentage > 0" class="context-bar">
        <div class="context-bar-label">
          <span>Context Usage</span>
          <span>{{ contextPercentage }}%</span>
        </div>
        <div class="context-bar-track">
          <div
            class="context-bar-fill"
            :style="{ width: `${contextPercentage}%` }"
            :class="contextBarClass"
          ></div>
        </div>
      </div>
    </div>
    <button
      v-if="hasDetailsToShow"
      class="toggle-details"
      @click="showDetails = !showDetails"
    >
      {{ showDetails ? 'Hide details' : 'Show details' }}
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';

const sessionsStore = useSessionsStore();
const showDetails = ref(false);

const formattedTokens = computed(() => sessionsStore.formattedTokens);
const isUpdating = computed(() => sessionsStore.isUsageUpdating);

const contextPercentage = computed(() => {
  const session = sessionsStore.currentSession;
  if (!session) return 0;
  const total = (session.inputTokens || 0) + (session.outputTokens || 0);
  const window = session.contextWindow || 200000;
  return Math.round((total / window) * 100);
});

const contextBarClass = computed(() => {
  const pct = contextPercentage.value;
  if (pct >= 90) return 'critical';
  if (pct >= 70) return 'warning';
  return 'normal';
});

const hasDetailsToShow = computed(() => {
  const session = sessionsStore.currentSession;
  return session && ((session.cacheReadInputTokens || 0) > 0 ||
                     (session.cacheCreationInputTokens || 0) > 0 ||
                     contextPercentage.value > 0);
});
</script>

<style scoped>
.token-usage-panel {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 0.75rem;
  font-size: 0.875rem;
}

.usage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.usage-title {
  font-weight: 600;
  color: var(--color-text);
}

.updating-indicator {
  display: flex;
  gap: 2px;
  align-items: center;
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

.usage-stats {
  display: flex;
  gap: 1rem;
}

.stat {
  display: flex;
  flex-direction: column;
  min-width: 60px;
}

.stat-label {
  font-size: 0.625rem;
  text-transform: uppercase;
  color: var(--color-text-soft);
  margin-bottom: 0.125rem;
}

.stat-value {
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--color-text);
}

.stat-total .stat-value {
  color: var(--color-primary);
}

.usage-details {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.detail-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.detail-label {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.detail-value {
  font-size: 0.75rem;
  font-family: var(--font-mono);
  color: var(--color-text);
}

.context-bar {
  margin-top: 0.5rem;
}

.context-bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 0.625rem;
  color: var(--color-text-soft);
  margin-bottom: 0.25rem;
}

.context-bar-track {
  height: 4px;
  background: var(--color-background-mute);
  border-radius: 2px;
  overflow: hidden;
}

.context-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.context-bar-fill.normal {
  background: var(--color-success, #10b981);
}

.context-bar-fill.warning {
  background: var(--color-warning, #f59e0b);
}

.context-bar-fill.critical {
  background: var(--color-danger, #ef4444);
}

.toggle-details {
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 0.625rem;
  cursor: pointer;
  padding: 0;
  margin-top: 0.5rem;
  text-decoration: underline;
}

.toggle-details:hover {
  color: var(--color-text);
}
</style>
