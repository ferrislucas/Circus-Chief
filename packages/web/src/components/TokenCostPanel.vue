<template>
  <div
    v-if="hasNonZeroCost"
    class="token-cost-panel"
  >
    <!-- Cost display (collapsed view) -->
    <div
      v-if="!isExpanded"
      class="cost-display"
      title="Billable Token Equivalent - weighted token cost where output tokens are 5x and cache varies"
      @click="isExpanded = !isExpanded"
    >
      <span class="cost-label">Cost:</span>
      <span class="cost-value">{{ formattedBillableTokens }}</span>
    </div>

    <!-- Expanded token breakdown -->
    <div
      v-if="isExpanded"
      class="token-breakdown"
    >
      <div
        class="bte-header"
        title="Billable Token Equivalent - weighted token cost where output tokens are 5x and cache varies"
      >
        <span class="bte-label">Cost:</span>
        <span
          class="bte-value clickable"
          @click="isExpanded = false"
        >{{ formattedBillableTokens }}</span>
      </div>

      <div class="token-grid">
        <div class="token-item">
          <div class="token-type">
            Input
          </div>
          <div class="token-count">
            {{ formattedTokens.input }}
          </div>
          <div class="token-weight">
            ×{{ weights.input }}
          </div>
          <div class="token-weighted">
            ={{ formatWeighted(inputTokens, weights.input) }}
          </div>
        </div>
        <div class="token-item">
          <div class="token-type">
            Output
          </div>
          <div class="token-count">
            {{ formattedTokens.output }}
          </div>
          <div class="token-weight">
            ×{{ weights.output }}
          </div>
          <div class="token-weighted">
            ={{ formatWeighted(outputTokens, weights.output) }}
          </div>
        </div>
        <div
          class="token-item"
          title="Tokens read from cache (90% discount)"
        >
          <div class="token-type">
            Cache Read
          </div>
          <div class="token-count">
            {{ formattedTokens.cacheRead }}
          </div>
          <div class="token-weight">
            ×{{ weights.cacheRead }}
          </div>
          <div class="token-weighted">
            ={{ formatWeighted(cacheReadTokens, weights.cacheRead) }}
          </div>
        </div>
        <div
          class="token-item"
          title="Tokens written to cache (25% premium)"
        >
          <div class="token-type">
            Cache Create
          </div>
          <div class="token-count">
            {{ formattedTokens.cacheCreation }}
          </div>
          <div class="token-weight">
            ×{{ weights.cacheCreation }}
          </div>
          <div class="token-weighted">
            ={{ formatWeighted(cacheCreationTokens, weights.cacheCreation) }}
          </div>
        </div>
      </div>

      <div class="breakdown-footer">
        <button
          type="button"
          class="settings-btn"
          title="Configure token cost weights"
          @click="openSettings"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle
              cx="12"
              cy="12"
              r="3"
            />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Settings modal -->
    <TokenWeightsModal
      :is-open="showSettings"
      @close="showSettings = false"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useInjectedSessionsStore } from '../composables/useOverlayStore.js';
import { useSettingsStore } from '../stores/settings.js';
import { formatTokenCount } from '@claudetools/shared';
import TokenWeightsModal from './TokenWeightsModal.vue';

const sessionsStore = useInjectedSessionsStore();
const settingsStore = useSettingsStore();

const isExpanded = ref(false);
const showSettings = ref(false);

// Fetch token weights on mount
settingsStore.fetchTokenCostWeights();

// Computed values
const weights = computed(() => settingsStore.tokenCostWeights);
const formattedTokens = computed(() => sessionsStore.formattedTokens);
const formattedBillableTokens = computed(() => sessionsStore.formattedBillableTokens);

// Check if cost is non-zero
const hasNonZeroCost = computed(() => {
  const cost = formattedBillableTokens.value;
  return cost && cost !== '0' && cost !== '-' && cost !== '0.0';
});

// Raw token values for weighted calculations
const inputTokens = computed(() => {
  if (sessionsStore.runningUsage && sessionsStore.runningUsage.conversationId === sessionsStore.activeConversationId) {
    const conv = sessionsStore.activeConversation;
    return (conv?.inputTokens || 0) + (sessionsStore.runningUsage.inputTokens || 0);
  }
  return sessionsStore.activeConversation?.inputTokens || 0;
});

const outputTokens = computed(() => {
  if (sessionsStore.runningUsage && sessionsStore.runningUsage.conversationId === sessionsStore.activeConversationId) {
    const conv = sessionsStore.activeConversation;
    return (conv?.outputTokens || 0) + (sessionsStore.runningUsage.outputTokens || 0);
  }
  return sessionsStore.activeConversation?.outputTokens || 0;
});

const cacheReadTokens = computed(() => {
  if (sessionsStore.runningUsage && sessionsStore.runningUsage.conversationId === sessionsStore.activeConversationId) {
    const conv = sessionsStore.activeConversation;
    return (conv?.cacheReadInputTokens || 0) + (sessionsStore.runningUsage.cacheReadInputTokens || 0);
  }
  return sessionsStore.activeConversation?.cacheReadInputTokens || 0;
});

const cacheCreationTokens = computed(() => {
  if (sessionsStore.runningUsage && sessionsStore.runningUsage.conversationId === sessionsStore.activeConversationId) {
    const conv = sessionsStore.activeConversation;
    return (conv?.cacheCreationInputTokens || 0) + (sessionsStore.runningUsage.cacheCreationInputTokens || 0);
  }
  return sessionsStore.activeConversation?.cacheCreationInputTokens || 0;
});

function formatWeighted(count, weight) {
  const weighted = (count || 0) * weight;
  return formatTokenCount(Math.round(weighted));
}

function openSettings() {
  showSettings.value = true;
}
</script>

<style scoped>
.token-cost-panel {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  position: relative;
}

.cost-display {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: background-color 0.15s;
}

.cost-display:hover {
  background: var(--color-background-mute);
}

.cost-label {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.cost-value {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-accent, var(--color-primary));
}

.toggle-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 0.5rem;
  cursor: pointer;
  padding: 0.25rem;
}

.toggle-btn:hover {
  color: var(--color-text);
}

/* Token breakdown (expanded) */
.token-breakdown {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  padding: 0.75rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  min-width: 400px;
}

.bte-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.bte-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.bte-value {
  font-family: var(--font-mono);
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--color-accent, var(--color-primary));
}

.bte-value.clickable {
  cursor: pointer;
  transition: opacity 0.15s;
}

.bte-value.clickable:hover {
  opacity: 0.8;
}

.token-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

@media (min-width: 640px) {
  .token-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.token-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.5rem;
  background: var(--color-background);
  border-radius: 0.25rem;
  text-align: center;
}

.token-type {
  font-size: 0.625rem;
  text-transform: uppercase;
  color: var(--color-text-soft);
  margin-bottom: 0.25rem;
}

.token-count {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text);
}

.token-weight {
  font-size: 0.625rem;
  color: var(--color-text-soft);
}

.token-weighted {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: var(--color-accent, var(--color-primary));
}

.breakdown-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  color: var(--color-text-soft);
  cursor: pointer;
  transition: all 0.15s;
}

.settings-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
  background: var(--color-background-soft);
}
</style>
