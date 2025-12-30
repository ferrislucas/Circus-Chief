<template>
  <div class="thinking-block" :class="{ 'thinking-streaming': streaming }">
    <div class="thinking-header">
      <span class="thinking-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 16v-4"/>
          <path d="M12 8h.01"/>
        </svg>
      </span>
      <span class="thinking-label">{{ streaming ? 'Thinking...' : 'Thinking' }}</span>
      <span v-if="streaming" class="streaming-dots">
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </span>
      <span v-else-if="timestamp" class="thinking-time">{{ formatTime(timestamp) }}</span>
    </div>
    <div class="thinking-content" :class="{ expanded: isExpanded }">
      <div class="thinking-text">{{ displayContent }}</div>
      <button v-if="shouldTruncate && !isExpanded" class="show-more-btn" @click="isExpanded = true">
        Show more...
      </button>
      <button v-if="isExpanded && shouldTruncate" class="show-more-btn" @click="isExpanded = false">
        Show less
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  content: { type: String, required: true },
  timestamp: { type: Number, default: null },
  streaming: { type: Boolean, default: false },
});

const MAX_LENGTH = 500;
const isExpanded = ref(false);

const shouldTruncate = computed(() => props.content.length > MAX_LENGTH);

const displayContent = computed(() => {
  if (isExpanded.value || !shouldTruncate.value) {
    return props.content;
  }
  return props.content.slice(0, MAX_LENGTH) + '...';
});

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}
</script>

<style scoped>
.thinking-block {
  background: rgba(88, 166, 255, 0.08);
  border: 1px solid rgba(88, 166, 255, 0.2);
  border-radius: 6px;
  padding: 0.625rem;
  font-size: 0.8125rem;
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 0.5rem;
  color: var(--color-primary);
}

.thinking-icon {
  display: flex;
  align-items: center;
  opacity: 0.8;
}

.thinking-label {
  font-weight: 500;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.thinking-time {
  margin-left: auto;
  font-size: 0.6875rem;
  color: var(--color-text-soft);
  font-weight: normal;
}

.thinking-content {
  color: var(--color-text-soft);
  line-height: 1.5;
}

.thinking-text {
  white-space: pre-wrap;
  word-break: break-word;
  font-style: italic;
}

.show-more-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0.25rem 0;
  font-size: 0.75rem;
  text-decoration: underline;
  opacity: 0.8;
}

.show-more-btn:hover {
  opacity: 1;
}

/* Streaming state */
.thinking-streaming {
  border-style: dashed;
  animation: streamPulse 2s ease-in-out infinite;
}

@keyframes streamPulse {
  0%, 100% {
    border-color: rgba(88, 166, 255, 0.2);
  }
  50% {
    border-color: rgba(88, 166, 255, 0.5);
  }
}

.streaming-dots {
  display: flex;
  gap: 0.15rem;
  align-items: center;
  margin-left: 0.25rem;
}

.streaming-dots .dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background-color: var(--color-primary);
  animation: pulse 1.4s ease-in-out infinite;
}

.streaming-dots .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.streaming-dots .dot:nth-child(3) {
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

/* Reduce animations for users who prefer reduced motion or on low-power devices */
@media (prefers-reduced-motion: reduce) {
  .thinking-streaming {
    animation: none;
  }

  .streaming-dots .dot {
    animation: none;
    opacity: 0.6;
  }
}
</style>
