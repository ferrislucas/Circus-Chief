<template>
  <div
    class="session-tree-picker"
    role="listbox"
    aria-label="Session hierarchy"
    data-testid="session-tree-picker"
    @keydown="handleKeydown"
  >
    <div
      v-for="(session, index) in sessions"
      :key="session.id"
      class="picker-item"
      :class="{
        'picker-item--active': session.id === activeSessionId,
        'picker-item--root': index === 0,
      }"
      :style="{ paddingLeft: `${getDepth(index) * 1.5 + 0.5}rem` }"
      role="option"
      :aria-selected="session.id === activeSessionId ? 'true' : 'false'"
      :tabindex="index === focusedIndex ? 0 : -1"
      :ref="el => { if (el) itemRefs[index] = el }"
      :data-index="index"
      @click="emit('select', session.id)"
      @keydown.enter.prevent="emit('select', session.id)"
    >
      <div class="picker-item-label">
        <span class="picker-item-role">
          {{ getRoleLabel(index) }}
        </span>
        <span
          v-if="statusLabel(session)"
          :class="['picker-item-status', `status-${session.status}`]"
        >
          {{ statusLabel(session) }}
        </span>
      </div>
      <div class="picker-item-name" :title="session.name">
        {{ session.name }}
      </div>
      <div class="picker-item-meta">
        <span class="picker-item-summary">{{ getSummaryText(session.id) }}</span>
        <span class="picker-item-date">{{ formatDate(session.lastActivityAt || session.updatedAt || session.createdAt) }}</span>
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
  const activeIndex = props.sessions.findIndex(s => s.id === props.activeSessionId);
  if (activeIndex >= 0) {
    focusedIndex.value = activeIndex;
    nextTick(() => {
      const el = itemRefs.value[activeIndex];
      if (el && el.focus) el.focus();
    });
  }
});

function getDepth(index) {
  if (index === 0) return 0;
  return index; // In a linear chain, depth === index
}

function getRoleLabel(index) {
  if (index === 0) return '◉ ROOT';
  if (index > 1) return `└─ CHILD`;
  return 'CHILD';
}

function statusLabel(session) {
  const status = session.status;
  if (status === 'running' || status === 'starting') return '● Running';
  if (status === 'scheduled') return '⏰ Scheduled';
  if (status === 'error') return '⚠ Error';
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
.session-tree-picker {
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

.picker-item-status.status-error {
  color: var(--color-error, #f85149);
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
