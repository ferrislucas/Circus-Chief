<template>
  <div class="live-work-log-panel">
    <div
      v-if="showHeader"
      class="live-header"
    >
      <span class="loading-spinner" />
      <span class="live-title">Agent is working...</span>
      <span
        v-if="totalCount"
        class="live-count"
      >({{ totalCount }} {{ totalCount === 1 ? 'item' : 'items' }})</span>
    </div>
    <div
      v-if="hasContent"
      ref="logsRef"
      class="live-logs"
      @scroll.passive="handleScroll"
    >
      <!-- Naturally sizing inner content: the outer box sits at its height
           cap, so only this element's size changes on content-only growth
           and only observing it can re-pin after the retry window ends. -->
      <div
        ref="logsContentRef"
        class="live-logs-content"
      >
        <div
          v-for="log in workLogs"
          :key="log.id"
          class="live-log-item"
        >
          <ThinkingBlock
            v-if="log.type === 'thinking'"
            :content="log.content"
            :timestamp="log.timestamp"
            :tail="true"
          />
          <CommandBlock
            v-else
            :log="log"
            :tail="true"
          />
        </div>
        <!-- Streaming partial thinking -->
        <div
          v-if="partialThinking"
          class="live-log-item"
        >
          <ThinkingBlock
            :content="partialThinking"
            :streaming="true"
            :tail="true"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import ThinkingBlock from './ThinkingBlock.vue';
import CommandBlock from './CommandBlock.vue';
import { useWorkLogFollow } from '../composables/useWorkLogFollow.js';

const props = defineProps({
  workLogs: { type: Array, default: () => [] },
  partialThinking: { type: String, default: null },
  showHeader: { type: Boolean, default: true }, // Hide header when shown in parent
});

// Follow mode lives in the shared composable; the container resolves from
// this panel's own template ref so multiple live panels scroll correctly.
const logsRef = ref(null);
const logsContentRef = ref(null);
const { isNearBottom, handleScroll, scrollToBottom } = useWorkLogFollow({
  resolveContainer: () => logsRef.value,
  resolveContent: () => logsContentRef.value,
  watchSources: [() => props.workLogs?.length, () => props.partialThinking],
});

const totalCount = computed(() => (props.workLogs?.length || 0) + (props.partialThinking ? 1 : 0));

const hasContent = computed(() => props.workLogs?.length > 0 || props.partialThinking);

// Expose for testing
defineExpose({
  isNearBottom,
  scrollToBottom,
});
</script>

<style scoped>
.live-work-log-panel {
  border-top: 1px solid var(--color-border);
  padding: 0.75rem 0;
}

.live-work-log-panel:not(:has(.live-header)) {
  /* When header is hidden (show-header=false), adjust padding */
  border-top: none;
  padding-top: 0;
}

.live-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.875rem;
}

.live-title {
  font-weight: 500;
}

.live-count {
  opacity: 0.7;
  font-size: 0.8125rem;
}

.live-logs {
  margin-top: 0.75rem;
  max-height: 250px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-right: 0.25rem;
  border-left: 2px solid var(--color-primary);
  padding-left: 0.75rem;
}

/* Inner content wrapper: single child of the capped scroll box, so it
   sizes naturally with its items and preserves the item spacing. */
.live-logs-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.live-log-item {
  animation: slideIn 0.2s ease;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Custom scrollbar for logs container */
.live-logs::-webkit-scrollbar {
  width: 6px;
}

.live-logs::-webkit-scrollbar-track {
  background: var(--color-background-soft);
  border-radius: 3px;
}

.live-logs::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.live-logs::-webkit-scrollbar-thumb:hover {
  background: var(--color-text-soft);
}

/* Reduce animations for users who prefer reduced motion or on low-power devices */
@media (prefers-reduced-motion: reduce) {
  .live-log-item {
    animation: none;
  }
}

/* Hide "Agent is working..." text on extremely small screens */
@media (max-width: 360px) {
  .live-title {
    display: none;
  }
}
</style>
