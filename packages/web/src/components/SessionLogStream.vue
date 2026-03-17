<template>
  <div v-if="hasContent && !isCollapsed" class="session-log-stream">
    <!-- Collapse toggle bar -->
    <div
      class="log-header"
      @click.stop.prevent="toggleCollapse"
    >
      <div class="log-header-left">
        <span class="pulse-dot" />
        <span class="log-header-label">Live Output</span>
      </div>
      <svg class="chevron-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="18 15 12 9 6 15"></polyline>
      </svg>
    </div>

    <!-- Log content — no scroll, overflow hidden, content anchored to bottom -->
    <div class="log-content">
      <!-- Use flexbox column-reverse to anchor to bottom -->
      <div class="log-content-inner">
        <div>
          <!-- Work log entries -->
          <div v-for="log in recentLogs" :key="log.id" class="log-entry">
            <span v-if="log.type === 'tool_use'" class="log-tool">&#9656; {{ log.tool }}</span>
            <span v-if="log.summary" class="log-summary">{{ log.summary }}</span>
          </div>

          <!-- Thinking (if streaming) -->
          <div v-if="thinking" class="log-thinking">
            {{ thinkingPreview }}
          </div>

          <!-- Partial text (if streaming) -->
          <div v-if="partialText" class="log-partial">
            {{ partialTextPreview }}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Collapsed state — just a small expand button -->
  <div
    v-else-if="hasContent && isCollapsed"
    class="log-collapsed"
    @click.stop.prevent="toggleCollapse"
  >
    <span class="pulse-dot" />
    <span class="log-collapsed-label">Show live output</span>
    <svg class="chevron-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSessionStreamingStore } from '../stores/sessionStreaming.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const streamingStore = useSessionStreamingStore();

const recentLogs = computed(() => streamingStore.getSessionWorkLogs(props.sessionId));
const partialText = computed(() => streamingStore.getSessionPartialText(props.sessionId));
const thinking = computed(() => streamingStore.getPartialThinking(props.sessionId));
const isCollapsed = computed(() => streamingStore.isSessionLogCollapsed(props.sessionId));

const hasContent = computed(() => recentLogs.value.length > 0 || partialText.value || thinking.value);

const thinkingPreview = computed(() => {
  if (!thinking.value) return '';
  return thinking.value.length > 200 ? thinking.value.slice(-200) : thinking.value;
});

const partialTextPreview = computed(() => {
  if (!partialText.value) return '';
  return partialText.value.length > 200 ? partialText.value.slice(-200) : partialText.value;
});

function toggleCollapse() {
  streamingStore.toggleSessionLogCollapsed(props.sessionId);
}
</script>

<style scoped>
.session-log-stream {
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
}

.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.375rem 0.75rem;
  background: rgba(0, 0, 0, 0.15);
  cursor: pointer;
  transition: background-color 0.15s;
}

.log-header:hover {
  background: rgba(0, 0, 0, 0.25);
}

.log-header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.log-header-label {
  font-size: 0.7rem;
  color: var(--color-text-soft, #9ca3af);
  font-weight: 500;
}

.pulse-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-success, #34d399);
  animation: pulse-glow 1.5s ease-in-out infinite;
}

.chevron-icon {
  color: var(--color-text-soft, #6b7280);
}

.log-content {
  padding: 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.1);
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  font-size: 0.7rem;
  color: var(--color-text-soft, #d1d5db);
  line-height: 1.5;
  overflow: hidden;
  max-height: 15em;
}

.log-content-inner {
  display: flex;
  flex-direction: column-reverse;
}

.log-entry {
  margin-bottom: 0.125rem;
}

.log-tool {
  color: var(--color-primary, #22d3ee);
  opacity: 0.7;
}

.log-summary {
  color: var(--color-text-soft, #9ca3af);
  margin-left: 0.25rem;
}

.log-thinking {
  color: var(--color-warning, #fbbf24);
  opacity: 0.5;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-partial {
  color: var(--color-text-soft, #d1d5db);
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-collapsed {
  display: flex;
  align-items: center;
  padding: 0.25rem 0.75rem;
  border-top: 1px solid var(--color-border, rgba(255, 255, 255, 0.06));
  cursor: pointer;
  transition: background-color 0.15s;
  gap: 0.5rem;
}

.log-collapsed:hover {
  background: rgba(0, 0, 0, 0.1);
}

.log-collapsed-label {
  font-size: 0.7rem;
  color: var(--color-text-soft, #6b7280);
}

.log-collapsed .chevron-icon {
  margin-left: auto;
}

@keyframes pulse-glow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
