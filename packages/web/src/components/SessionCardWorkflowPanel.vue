<template>
  <div :class="['workflow-sessions-panel', variant === 'detail' && 'workflow-sessions-panel--detail']">
    <div class="workflow-sessions-list">
      <!-- Root session entry -->
      <div class="workflow-session-item root-session">
        <router-link :to="`/sessions/${session.id}`" class="workflow-session-link">
          <div class="workflow-session-label">
            <span class="workflow-session-role">&#x25C9; ROOT</span>
          </div>
          <div class="workflow-session-name">{{ session.name }}</div>
          <div class="workflow-session-meta">
            <span class="workflow-session-summary">{{ rootSummaryText }}</span>
            <span class="workflow-session-date">{{ formatDate(session.lastActivityAt || session.updatedAt || session.createdAt) }}</span>
          </div>
        </router-link>
      </div>

      <!-- Child sessions (recursive) -->
      <WorkflowSessionItem
        v-for="child in allDescendants"
        :key="child.id"
        :session="child"
        :summaries="summaries"
        :depth="getSessionDepth(child.id)"
        :pr-url="child.prUrl"
        :pr-summary="summaries[child.id]"
        :latest-command-runs="child.latestCommandRuns || []"
        :command-buttons="commandButtons"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { formatDate } from '../utils/formatters.js';
import WorkflowSessionItem from './WorkflowSessionItem.vue';

const sessionsStore = useSessionsStore();

const props = defineProps({
  session: {
    type: Object,
    required: true,
  },
  summaries: {
    type: Object,
    default: () => ({}),
  },
  summary: {
    type: Object,
    default: null,
  },
  commandButtons: {
    type: Array,
    default: () => [],
  },
  variant: {
    type: String,
    default: 'list', // 'list' | 'detail'
  },
});

const rootSummaryText = computed(() => {
  return props.summary?.shortSummary || 'No summary yet';
});

const allDescendants = computed(() => {
  return sessionsStore.getAllDescendants(props.session.id);
});

const getSessionDepth = (sessionId) => {
  const path = sessionsStore.getSessionPath(sessionId);
  return Math.max(0, path.length - 1);
};
</script>

<style scoped>
.workflow-sessions-panel {
  border: 1px solid var(--color-border);
  border-top: none;
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  background: var(--color-background-secondary, rgba(0, 0, 0, 0.1));
  animation: slideIn 0.2s ease-out;
}

.workflow-sessions-panel--detail {
  border-top: 1px solid var(--color-border);
  border-radius: 6px;
  animation: none;
  margin-bottom: 1.5rem;
}

.workflow-sessions-list {
  padding: 0.5rem;
}

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

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-0.5rem);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
