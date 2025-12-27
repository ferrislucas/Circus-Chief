<template>
  <div class="token-usage-panel">
    <!-- Compact view: Total tokens + context bar (always visible) -->
    <div class="usage-compact">
      <div class="compact-tokens">
        <span class="total-label">{{ formattedTokens.total }}</span>
        <span class="total-suffix">tokens</span>
        <span v-if="isUpdating" class="updating-indicator">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </span>
      </div>
      <div class="context-bar-compact">
        <div class="context-bar-track-compact">
          <div
            class="context-bar-fill"
            :style="{ width: `${contextPercentage}%` }"
            :class="contextBarClass"
          ></div>
        </div>
        <span class="context-pct">{{ contextPercentage }}%</span>
      </div>
      <button
        v-if="hasDetailsToShow"
        class="toggle-details"
        @click="showDetails = !showDetails"
      >
        {{ showDetails ? '▲' : '▼' }}
      </button>
    </div>

    <!-- Expanded details -->
    <div v-if="showDetails" class="usage-details">
      <div class="usage-stats">
        <div class="stat">
          <span class="stat-label">Input</span>
          <span class="stat-value">{{ formattedTokens.input }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Output</span>
          <span class="stat-value">{{ formattedTokens.output }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Cache Read</span>
          <span class="stat-value">{{ formattedTokens.cacheRead }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Cache Creation</span>
          <span class="stat-value">{{ formattedTokens.cacheCreation }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';

const sessionsStore = useSessionsStore();
const showDetails = ref(false);

const formattedTokens = computed(() => sessionsStore.formattedTokens);
const isUpdating = computed(() => sessionsStore.isUsageUpdating);

// Use the store's contextPercentage getter (Issue #175 - conversation-level)
const contextPercentage = computed(() => sessionsStore.contextPercentage);

const contextBarClass = computed(() => {
  const pct = contextPercentage.value;
  if (pct >= 90) return 'critical';
  if (pct >= 70) return 'warning';
  return 'normal';
});

const hasDetailsToShow = computed(() => {
  const tokens = sessionsStore.conversationTokens || sessionsStore.currentSession;
  return tokens && ((tokens.cacheReadInputTokens || 0) > 0 ||
                     (tokens.cacheCreationInputTokens || 0) > 0);
});
</script>

<style scoped>
.token-usage-panel {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
}

/* Compact view - always visible */
.usage-compact {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.compact-tokens {
  display: flex;
  align-items: baseline;
  gap: 0.25rem;
}

.total-label {
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--color-text);
}

.total-suffix {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.context-bar-compact {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 80px;
  max-width: 150px;
}

.context-bar-track-compact {
  flex: 1;
  height: 6px;
  background: var(--color-background-mute);
  border-radius: 3px;
  overflow: hidden;
}

.context-pct {
  font-size: 0.625rem;
  font-family: var(--font-mono);
  color: var(--color-text-soft);
  min-width: 28px;
  text-align: right;
}

.updating-indicator {
  display: flex;
  gap: 2px;
  align-items: center;
  margin-left: 0.25rem;
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

.context-bar-fill {
  height: 100%;
  border-radius: 3px;
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
  padding: 0.25rem;
  margin-left: auto;
}

.toggle-details:hover {
  color: var(--color-text);
}

/* Expanded details */
.usage-details {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--color-border);
}

.usage-stats {
  display: flex;
  flex-wrap: wrap;
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
  font-size: 0.75rem;
}
</style>
