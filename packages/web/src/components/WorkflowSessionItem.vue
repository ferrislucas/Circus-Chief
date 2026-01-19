<template>
  <div class="workflow-session-item" :style="{ paddingLeft: `${depth * 1.5 + 0.5}rem` }">
    <router-link :to="`/sessions/${session.id}`" class="workflow-session-link">
      <div class="workflow-session-label">
        <span class="workflow-session-role">
          {{ depth > 0 ? '└─' : '' }} CHILD
        </span>
        <span v-if="statusLabel" :class="['workflow-session-status', `status-${session.status}`]">
          {{ statusLabel }}
        </span>
      </div>
      <div class="workflow-session-name">{{ session.name }}</div>
      <div class="workflow-session-meta">
        <span class="workflow-session-summary">{{ summaryText }}</span>
        <span class="workflow-session-date">{{ formatDate(session.createdAt) }}</span>
      </div>
    </router-link>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  session: {
    type: Object,
    required: true,
  },
  summaries: {
    type: Object,
    default: () => ({}),
  },
  depth: {
    type: Number,
    default: 1,
  },
});

const summaryText = computed(() => {
  const summary = props.summaries[props.session.id];
  return summary?.shortSummary || 'No summary yet';
});

const statusLabel = computed(() => {
  const status = props.session.status;
  if (status === 'running' || status === 'starting') return '● Running';
  if (status === 'scheduled') return '⏰ Scheduled';
  if (status === 'error') return '⚠ Error';
  if (status === 'waiting') return '⏸ Waiting';
  return null;
});

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  if (diffMs < 86400000) return `at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
</script>

<style scoped>
.workflow-session-item {
  padding: 0.5rem;
  border-radius: var(--border-radius, 6px);
  margin-bottom: 0.5rem;
  transition: background-color 0.15s;
}

.workflow-session-item:hover {
  background-color: var(--color-bg-soft, rgba(255, 255, 255, 0.05));
}

.workflow-session-item:last-child {
  margin-bottom: 0;
}

.workflow-session-link {
  display: block;
  color: var(--color-text);
  text-decoration: none;
}

.workflow-session-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.25rem;
}

.workflow-session-role {
  font-size: 0.65rem;
  font-weight: 600;
  color: var(--color-text-soft);
  letter-spacing: 0.05em;
}

.workflow-session-status {
  font-size: 0.7rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.workflow-session-status.status-running,
.workflow-session-status.status-starting {
  color: var(--color-success, #3fb950);
}

.workflow-session-status.status-scheduled {
  color: var(--color-primary, #06b6d4);
}

.workflow-session-status.status-error {
  color: var(--color-error, #f85149);
}

.workflow-session-status.status-waiting {
  color: var(--color-warning, #d29922);
}

.workflow-session-name {
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-session-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.workflow-session-summary {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 0.5rem;
}

.workflow-session-date {
  flex-shrink: 0;
}
</style>
