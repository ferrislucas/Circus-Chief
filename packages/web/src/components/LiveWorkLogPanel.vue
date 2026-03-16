<template>
  <div class="live-work-log-panel" data-testid="live-work-log-panel">
    <div v-if="showHeader" class="live-header">
      <span class="loading-spinner"></span>
      <span class="live-title">Claude is working...</span>
      <span v-if="totalCount" class="live-count">({{ totalCount }} {{ totalCount === 1 ? 'item' : 'items' }})</span>
    </div>
    <div v-if="hasContent" ref="logsContainer" class="live-logs" :class="{ 'fill-available': fillAvailable }" data-testid="live-logs" @scroll="handleScroll">
      <div v-for="log in workLogs" :key="log.id" class="live-log-item">
        <ThinkingBlock v-if="log.type === 'thinking'" :content="log.content" :timestamp="log.timestamp" />
        <CommandBlock v-else :log="log" />
      </div>
      <!-- Streaming partial thinking -->
      <div v-if="partialThinking" class="live-log-item">
        <ThinkingBlock :content="partialThinking" :streaming="true" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import ThinkingBlock from './ThinkingBlock.vue';
import CommandBlock from './CommandBlock.vue';

const props = defineProps({
  workLogs: { type: Array, default: () => [] },
  partialThinking: { type: String, default: null },
  showHeader: { type: Boolean, default: true }, // Hide header when shown in parent
  fillAvailable: { type: Boolean, default: false }, // Fill available space in split view
});

// Template ref for scroll container (fixes querySelector bug in split view)
const logsContainer = ref(null);

// Scroll state tracking - auto-scroll unless user manually scrolls up
const SCROLL_THRESHOLD = 50; // pixels from bottom to consider "near bottom"
const isNearBottom = ref(true);

const totalCount = computed(() => {
  return (props.workLogs?.length || 0) + (props.partialThinking ? 1 : 0);
});

const hasContent = computed(() => {
  return props.workLogs?.length > 0 || props.partialThinking;
});

// Detect when user manually scrolls away from bottom
function handleScroll(event) {
  const container = event.target;
  if (!container) return;
  const { scrollTop, scrollHeight, clientHeight } = container;
  isNearBottom.value = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
}

// Auto-scroll to bottom when new logs arrive (only if user is near bottom)
function scrollToBottom() {
  nextTick(() => {
    if (isNearBottom.value && logsContainer.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
    }
  });
}

// Watch for new work logs
// Use 'post' flush to let Vue batch updates instead of 'sync' which forces immediate execution
watch(() => props.workLogs?.length, () => {
  scrollToBottom();
}, { flush: 'post' });

// Watch for partial thinking changes
watch(() => props.partialThinking, () => {
  scrollToBottom();
}, { flush: 'post' });

// Expose for testing
defineExpose({
  isNearBottom,
  scrollToBottom,
  logsContainer,
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

/* Fill available mode for split view */
.live-logs.fill-available {
  max-height: none;
  flex: 1;
  min-height: 0;
}

/* In fill-available mode, add subtle separators between log entries */
.live-logs.fill-available .live-log-item + .live-log-item {
  border-top: 1px solid rgba(48, 54, 61, 0.5);
  padding-top: 0.5rem;
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

/* Hide "Claude is working..." text on extremely small screens */
@media (max-width: 360px) {
  .live-title {
    display: none;
  }
}
</style>
