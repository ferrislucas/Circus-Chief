<template>
  <div v-if="workLogs?.length || partialThinking" class="work-log-panel">
    <details :open="isExpanded" ref="detailsRef" @toggle="handleToggle">
      <summary class="work-log-header">
        <span class="work-log-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
        </span>
        <span class="work-log-title">Work Log</span>
        <span class="work-log-count">({{ totalCount }})</span>
        <span v-if="partialThinking" class="streaming-indicator">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </span>
        <span class="work-log-chevron" :class="{ expanded: isExpanded }">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </span>
      </summary>
      <div class="work-log-content">
        <!-- Existing work logs -->
        <div v-for="log in workLogs" :key="log.id" class="work-log-item">
          <ThinkingBlock v-if="log.type === 'thinking'" :content="log.content" :timestamp="log.timestamp" />
          <CommandBlock v-else :log="log" />
        </div>
        <!-- Streaming partial thinking -->
        <div v-if="partialThinking" class="work-log-item work-log-streaming">
          <ThinkingBlock :content="partialThinking" :streaming="true" />
        </div>
      </div>
    </details>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import ThinkingBlock from './ThinkingBlock.vue';
import CommandBlock from './CommandBlock.vue';

const props = defineProps({
  workLogs: { type: Array, default: () => [] },
  isLatestMessage: { type: Boolean, default: false },
  partialThinking: { type: String, default: null },
});

const detailsRef = ref(null);
const manuallyToggled = ref(false);
const isExpanded = ref(props.isLatestMessage || !!props.partialThinking);

// Total count includes work logs + 1 if partial thinking is present
const totalCount = computed(() => {
  return (props.workLogs?.length || 0) + (props.partialThinking ? 1 : 0);
});

// Watch for changes in isLatestMessage to auto-collapse/expand
watch(() => props.isLatestMessage, (newVal) => {
  // Only auto-collapse if user hasn't manually interacted
  if (!manuallyToggled.value) {
    isExpanded.value = newVal;
  }
});

// Watch for new work logs to expand panel for latest message
watch(() => props.workLogs?.length, (newLen, oldLen) => {
  if (props.isLatestMessage && newLen > (oldLen || 0)) {
    isExpanded.value = true;
  }
});

// Watch for partial thinking to auto-expand
watch(() => props.partialThinking, (newVal) => {
  if (newVal && !manuallyToggled.value) {
    isExpanded.value = true;
  }
});

function handleToggle(event) {
  manuallyToggled.value = true;
  isExpanded.value = event.target.open;
}
</script>

<style scoped>
.work-log-panel {
  margin-top: 0.75rem;
  border-left: 2px solid var(--color-border);
  padding-left: 0.75rem;
}

.work-log-header {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--color-text-soft);
  padding: 0.25rem 0;
  user-select: none;
  list-style: none;
}

.work-log-header::-webkit-details-marker {
  display: none;
}

.work-log-header:hover {
  color: var(--color-text);
}

.work-log-icon {
  display: flex;
  align-items: center;
  opacity: 0.7;
}

.work-log-title {
  font-weight: 500;
}

.work-log-count {
  opacity: 0.7;
}

.work-log-chevron {
  margin-left: auto;
  display: flex;
  align-items: center;
  transition: transform 0.15s ease;
}

.work-log-chevron.expanded {
  transform: rotate(90deg);
}

.work-log-content {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.work-log-item {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.work-log-streaming {
  border-left: 2px solid var(--color-primary);
  padding-left: 0.5rem;
}

/* Streaming indicator animation */
.streaming-indicator {
  display: flex;
  gap: 0.15rem;
  align-items: center;
  margin-left: 0.5rem;
}

.streaming-indicator .dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: var(--color-primary);
  animation: pulse 1.4s ease-in-out infinite;
}

.streaming-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.streaming-indicator .dot:nth-child(3) {
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
