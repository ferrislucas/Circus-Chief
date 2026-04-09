<template>
  <div
    class="session-chat-picker"
    role="listbox"
    aria-label="Session hierarchy"
    data-testid="session-chat-picker"
    @keydown="handleKeydown"
  >
    <div
      v-for="(entry, index) in sessions"
      :key="entry.session.id"
      :ref="el => { if (el) itemRefs[index] = el }"
      class="picker-item"
      :class="{
        'picker-item--active': entry.session.id === activeSessionId,
      }"
      role="option"
      :aria-selected="entry.session.id === activeSessionId ? 'true' : 'false'"
      :tabindex="index === focusedIndex ? 0 : -1"
      :data-index="index"
      @click="emit('select', entry.session.id)"
      @keydown.enter.prevent="emit('select', entry.session.id)"
    >
      <div class="picker-item-label">
        <span class="picker-item-role">
          {{ getRoleLabel(index) }}
        </span>
        <span
          v-if="statusLabel(entry.session)"
          :class="['picker-item-status', `status-${entry.session.status}`]"
        >
          {{ statusLabel(entry.session) }}
        </span>
      </div>
      <div
        class="picker-item-name"
        :title="entry.session.name"
      >
        {{ entry.session.name }}
      </div>
      <div class="picker-item-meta">
        <span class="picker-item-summary">{{ getSummaryText(entry.session.id) }}</span>
        <span class="picker-item-date">{{ formatDate(entry.session.lastActivityAt || entry.session.updatedAt || entry.session.createdAt) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick } from 'vue';

const props = defineProps({
  sessions: {
    type: Array,
    required: true,
  },
  activeSessionId: {
    type: String,
    required: true,
  },
  summaries: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(['select']);

const focusedIndex = ref(0);
const itemRefs = ref({});

onMounted(() => {
  // Focus the active session item initially
  const activeIndex = props.sessions.findIndex(e => e.session.id === props.activeSessionId);
  if (activeIndex >= 0) {
    focusedIndex.value = activeIndex;
    nextTick(() => {
      const el = itemRefs.value[activeIndex];
      if (el && el.focus) el.focus();
    });
  }
});

function getRoleLabel(index) {
  return ''; // No hierarchy labels for any sessions
}

function statusLabel(session) {
  const status = session.status;
  if (status === 'running' || status === 'starting') return '● Running';
  if (status === 'scheduled') return '⏰ Scheduled';
  return null;
}

function getSummaryText(sessionId) {
  const summary = props.summaries[sessionId];
  return summary?.shortSummary || 'No summary yet';
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  if (diffMs < 86400000) return `at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function handleKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (focusedIndex.value < props.sessions.length - 1) {
      focusedIndex.value++;
      nextTick(() => {
        const el = itemRefs.value[focusedIndex.value];
        if (el && el.focus) el.focus();
      });
    }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (focusedIndex.value > 0) {
      focusedIndex.value--;
      nextTick(() => {
        const el = itemRefs.value[focusedIndex.value];
        if (el && el.focus) el.focus();
      });
    }
  }
}
</script>

<style scoped>
.session-chat-picker {
  position: absolute;
  top: 100%;
  left: 0;
  width: 100%;
  z-index: 20;
  margin-top: 0.25rem;
  background: var(--color-background-secondary, #1f2937);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  max-height: 50vh;
  overflow-y: auto;
}

.picker-item {
  padding: 0.5rem;
  border-radius: var(--border-radius, 6px);
  cursor: pointer;
  transition: background-color 0.15s;
}

.picker-item:hover {
  background-color: rgba(255, 255, 255, 0.05);
}

.picker-item--active {
  background-color: rgba(55, 65, 81, 1);
}

.picker-item:focus-visible {
  outline: 2px solid var(--color-primary, #06b6d4);
  outline-offset: -2px;
}

.picker-item-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.picker-item-role {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-soft, #9ca3af);
  letter-spacing: 0.05em;
}

.picker-item-status {
  font-size: 0.7rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.picker-item-status.status-running,
.picker-item-status.status-starting {
  color: var(--color-success, #3fb950);
}

.picker-item-status.status-scheduled {
  color: var(--color-primary, #06b6d4);
}

.picker-item-name {
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text, #e5e7eb);
}

.picker-item-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
  color: var(--color-text-soft, #9ca3af);
}

.picker-item-summary {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 0.5rem;
}

.picker-item-date {
  flex-shrink: 0;
}
</style>
