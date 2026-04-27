<template>
  <div
    v-if="hasNonZeroTokens"
    class="token-usage-panel"
  >
    <div
      v-if="!isExpanded"
      class="token-display"
      title="Token usage"
      @click="isExpanded = true"
    >
      <span class="token-label">Tokens:</span>
      <span class="token-value">{{ formattedTokenTotal }}</span>
    </div>

    <div
      v-if="isExpanded"
      class="token-breakdown"
    >
      <div class="token-header">
        <span class="token-label">Tokens:</span>
        <span
          class="token-value clickable"
          @click="isExpanded = false"
        >{{ formattedTokenTotal }}</span>
      </div>

      <div class="token-grid">
        <div
          v-for="item in tokenItems"
          :key="item.label"
          class="token-item"
        >
          <div class="token-type">
            {{ item.label }}
          </div>
          <div class="token-count">
            {{ item.value }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useInjectedSessionsStore } from '../composables/useOverlayStore.js';

const sessionsStore = useInjectedSessionsStore();

const isExpanded = ref(false);

const formattedTokens = computed(() => sessionsStore.formattedTokens);
const formattedTokenTotal = computed(() => sessionsStore.formattedTokenTotal);

const hasNonZeroTokens = computed(() => {
  const tokens = formattedTokenTotal.value;
  return tokens && tokens !== '0' && tokens !== '-' && tokens !== '0.0';
});

const tokenItems = computed(() => [
  { label: 'Input', value: formattedTokens.value.input },
  { label: 'Output', value: formattedTokens.value.output },
  { label: 'Thinking', value: formattedTokens.value.thinking },
  { label: 'Cache Read', value: formattedTokens.value.cacheRead },
  { label: 'Cache Create', value: formattedTokens.value.cacheCreation },
]);
</script>

<style scoped>
.token-usage-panel {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  position: relative;
}

.token-display {
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

.token-display:hover {
  background: var(--color-background-mute);
}

.token-label {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.token-value {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-accent, var(--color-primary));
}

.token-value.clickable {
  cursor: pointer;
  transition: opacity 0.15s;
}

.token-value.clickable:hover {
  opacity: 0.8;
}

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

.token-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.token-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
}

@media (min-width: 640px) {
  .token-grid {
    grid-template-columns: repeat(5, 1fr);
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
</style>
