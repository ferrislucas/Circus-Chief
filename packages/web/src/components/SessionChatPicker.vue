<template>
  <div
    class="session-chat-picker"
    role="listbox"
    aria-label="Workspace hierarchy"
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
      :data-session-id="entry.session.id"
      @click="emit('select', entry.session.id)"
      @keydown.enter.prevent="emit('select', entry.session.id)"
    >
      <div class="picker-item-main">
        <div
          v-if="getRoleLabel(index, entry) || statusLabel(entry.session)"
          class="picker-item-label picker-item-topline"
        >
          <span
            v-if="getRoleLabel(index, entry)"
            class="picker-item-role"
          >
            {{ getRoleLabel(index, entry) }}
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
        <div class="picker-item-details">
          <span
            class="picker-item-model"
            :title="getModelLabel(entry.session)"
          >{{ getModelLabel(entry.session) }}</span>
          <span class="picker-item-separator">·</span>
          <span class="picker-item-tokens">{{ getTokenLabel(entry.session) }}</span>
          <span class="picker-item-separator">·</span>
          <span
            class="picker-item-date"
            :title="getTimestampTitle(entry)"
          >{{ entry.pickerTimestamp ? formatDate(entry.pickerTimestamp) : '—' }}</span>
        </div>
        <div
          v-if="getSummaryText(entry.session.id)"
          class="picker-item-meta"
        >
          <span class="picker-item-summary">{{ getSummaryText(entry.session.id) }}</span>
        </div>
      </div>
      <button
        v-if="!isRootEntry(entry)"
        class="picker-item-delete"
        type="button"
        :aria-label="`Delete ${entry.session.name}`"
        :title="`Delete ${entry.session.name}`"
        :disabled="deletingSessionId === entry.session.id"
        @click.stop="emit('delete-session', entry.session.id)"
        @keydown.enter.stop.prevent="emit('delete-session', entry.session.id)"
        @keydown.space.stop.prevent="emit('delete-session', entry.session.id)"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v5" />
          <path d="M14 11v5" />
        </svg>
      </button>
      <span
        v-else
        class="picker-item-root-lock"
        title="Root workspace cannot be deleted"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect
            x="5"
            y="11"
            width="14"
            height="10"
            rx="2"
          />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
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
  rootSessionId: {
    type: String,
    default: '',
  },
  deletingSessionId: {
    type: String,
    default: null,
  },
  getTokenLabel: {
    type: Function,
    default: () => '-',
  },
  getModelLabel: {
    type: Function,
    default: session => session?.model || session?.pendingModel || 'Default model',
  },
});

const emit = defineEmits(['select', 'delete-session']);

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

function getRoleLabel(index, entry) {
  if (isRootEntry(entry)) return 'Root';
  return ''; // No hierarchy labels for child sessions
}

function isRootEntry(entry) {
  if (props.rootSessionId) return entry.session.id === props.rootSessionId;
  return !entry.session.parentSessionId || entry.depth === 0;
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

function formatFullDate(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString();
}

function getTimestampSourceLabel(source) {
  if (source === 'lastMessageAt') return 'Last message';
  if (source === 'updatedAt') return 'Updated';
  if (source === 'createdAt') return 'Created';
  return 'No activity yet';
}

function getTimestampTitle(entry) {
  if (!entry?.pickerTimestamp) return 'No activity yet';
  return `${getTimestampSourceLabel(entry.pickerTimestampSource)}: ${formatFullDate(entry.pickerTimestamp)}`;
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
  position: static;
  width: 100%;
  z-index: 120;
  margin-top: 0;
  background: var(--session-picker-background, #111827);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
  max-height: 50vh;
  overflow-y: auto;
}

.picker-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2rem;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.5rem;
  border-radius: var(--border-radius, 6px);
  cursor: pointer;
  transition: background-color 0.15s;
  line-height: 1.15;
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

.picker-item-main {
  min-width: 0;
}

.picker-item-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.125rem;
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
  min-width: 0;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text, #e5e7eb);
}

.picker-item-details {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  margin-bottom: 0.125rem;
  font-size: 0.72rem;
  color: var(--color-text-soft, #9ca3af);
}

.picker-item-model {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-item-tokens,
.picker-item-date,
.picker-item-separator {
  flex-shrink: 0;
}

.picker-item-meta {
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: 0.75rem;
  color: var(--color-text-soft, #9ca3af);
}

.picker-item-summary {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-item-delete,
.picker-item-root-lock {
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--border-radius, 6px);
}

.picker-item-delete {
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-soft, #9ca3af);
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}

.picker-item-delete:hover:not(:disabled),
.picker-item-delete:focus-visible {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.35);
  color: #fca5a5;
}

.picker-item-delete:disabled {
  cursor: wait;
  opacity: 0.55;
}

.picker-item-root-lock {
  color: rgba(156, 163, 175, 0.55);
  cursor: default;
}

</style>
