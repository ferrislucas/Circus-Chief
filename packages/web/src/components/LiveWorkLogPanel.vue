<template>
  <div class="live-work-log-panel">
    <div class="live-header">
      <span class="loading-spinner"></span>
      <span class="live-title">Claude is working...</span>
      <span v-if="totalCount" class="live-count">({{ totalCount }} {{ totalCount === 1 ? 'item' : 'items' }})</span>
    </div>
    <div v-if="hasContent" class="live-logs" ref="logsContainer">
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
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import ThinkingBlock from './ThinkingBlock.vue';
import CommandBlock from './CommandBlock.vue';

const props = defineProps({
  workLogs: { type: Array, default: () => [] },
  partialThinking: { type: String, default: null },
});

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
function handleScroll() {
  if (!logsContainer.value) return;
  const { scrollTop, scrollHeight, clientHeight } = logsContainer.value;
  isNearBottom.value = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
}

// Auto-scroll to bottom when new logs arrive (only if user is near bottom)
function scrollToBottom() {
  nextTick(() => {
    if (logsContainer.value && isNearBottom.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
    }
  });
}

// Attach scroll listener on mount
onMounted(() => {
  logsContainer.value?.addEventListener('scroll', handleScroll);
});

// Cleanup scroll listener on unmount
onUnmounted(() => {
  logsContainer.value?.removeEventListener('scroll', handleScroll);
});

// Watch for new work logs
watch(() => props.workLogs?.length, () => {
  scrollToBottom();
});

// Watch for partial thinking changes
watch(() => props.partialThinking, () => {
  scrollToBottom();
});
</script>

<style scoped>
.live-work-log-panel {
  border-top: 1px solid var(--color-border);
  padding: 0.75rem 0;
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
</style>
