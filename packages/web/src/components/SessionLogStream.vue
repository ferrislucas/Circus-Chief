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
        <span
          v-if="activeModel"
          class="log-header-model"
          data-testid="live-output-model"
        >{{ activeModel }}</span>
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
    <span class="log-collapsed-label">Show live output<span
      v-if="activeModel"
      class="log-collapsed-model"
      data-testid="live-output-model-collapsed"
    > · {{ activeModel }}</span></span>
    <svg class="chevron-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSessionStreamingStore } from '../stores/sessionStreaming.js';
import { useSessionsStore } from '../stores/sessions.js';

const props = defineProps({
  sessionIds: { type: Array, required: true },
});

const streamingStore = useSessionStreamingStore();
const sessionsStore = useSessionsStore();

function resolveSession(id) {
  if (!id) return null;
  if (sessionsStore.currentSession?.id === id) return sessionsStore.currentSession;
  return sessionsStore._findSessionById(id) || null;
}

const activeModel = computed(() => {
  for (const id of props.sessionIds) {
    const session = resolveSession(id);
    if (session?.model) return session.model;
  }
  return '';
});

// Merge work logs from all running sessions
const recentLogs = computed(() => {
  const allLogs = props.sessionIds.flatMap(
    id => streamingStore.getSessionWorkLogs(id),
  );
  return allLogs.slice(-15);
});

// Show partial text from the first session that has it
const partialText = computed(() => {
  for (const id of props.sessionIds) {
    const text = streamingStore.getSessionPartialText(id);
    if (text) return text;
  }
  return '';
});

// Show thinking from the first session that has it
const thinking = computed(() => {
  for (const id of props.sessionIds) {
    const t = streamingStore.getPartialThinking(id);
    if (t) return t;
  }
  return '';
});

// Collapsed state uses the root session ID (first in array)
const isCollapsed = computed(() =>
  streamingStore.isSessionLogCollapsed(props.sessionIds[0]),
);

const hasContent = computed(() => recentLogs.value.length > 0 || partialText.value || thinking.value);

const thinkingPreview = computed(() => {
  if (!thinking.value) return '';
  return thinking.value.length > 500 ? thinking.value.slice(-500) : thinking.value;
});

const partialTextPreview = computed(() => {
  if (!partialText.value) return '';
  return partialText.value.length > 500 ? partialText.value.slice(-500) : partialText.value;
});

function toggleCollapse() {
  streamingStore.toggleSessionLogCollapsed(props.sessionIds[0]);
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
  max-height: 25em;
  min-height: 3em;
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
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  word-break: break-word;
}

.log-partial {
  color: var(--color-text-soft, #d1d5db);
  opacity: 0.7;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  word-break: break-word;
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

.log-header-model {
  font-size: 0.65rem;
  color: var(--color-primary, #22d3ee);
  opacity: 0.85;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  padding: 0 0.35rem;
  border-radius: 4px;
  background: rgba(34, 211, 238, 0.08);
}

.log-collapsed-model {
  color: var(--color-primary, #22d3ee);
  opacity: 0.7;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
}

@keyframes pulse-glow {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
