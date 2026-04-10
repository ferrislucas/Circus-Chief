<template>
  <div class="message message-assistant message-streaming">
    <div class="message-header">
      <span class="message-role">assistant</span>
      <span class="streaming-indicator">
        <span class="dot" />
        <span class="dot" />
        <span class="dot" />
      </span>
    </div>
    <div class="message-content">
      <MarkdownViewer :content="content" />
    </div>
  </div>
</template>

<script setup>
import MarkdownViewer from './MarkdownViewer.vue';

defineProps({
  content: { type: String, required: true },
});
</script>

<style scoped>
.message {
  padding: 1rem;
  margin-bottom: 1rem;
  border-radius: var(--border-radius);
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
}

.message-assistant {
  background-color: var(--color-background-soft);
}

.message-streaming {
  border-color: var(--color-accent);
  border-style: dashed;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.message-role {
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: capitalize;
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.message-content :deep(.markdown-viewer) {
  white-space: normal;
}

/* Streaming indicator animation */
.streaming-indicator {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.streaming-indicator .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-accent);
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
