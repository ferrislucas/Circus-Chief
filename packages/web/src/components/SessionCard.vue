<template>
  <!-- Workflow card (root session with consolidated view) -->
  <div class="workflow-card-wrapper">
    <router-link
      :to="`/sessions/${session.id}`"
      class="session-card card"
      :class="{ 'parent-card': hasChildren && isExpanded, 'is-child': isChild }"
    >
      <div class="session-header-row">
        <!-- Star button (always visible on root sessions, not on child sessions) -->
        <button
          v-if="!isChild"
          class="star-btn"
          :title="session.starred ? 'Unstar session' : 'Star session'"
          @click.stop.prevent="onStarClick"
        >
          <svg v-if="session.starred" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2"></polygon>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2"></polygon>
          </svg>
        </button>

        <div class="session-info">
          <h3 class="session-name">{{ session.name }}</h3>

          <!-- Workflow status badges (aggregated across all descendants) -->
          <p class="session-meta">
            <!-- Running count badge (if any session in workflow is running) -->
            <span v-if="workflowStatus.runningCount > 0" class="status-badge status-running">
              ● {{ workflowStatus.runningCount }} running
            </span>

            <!-- Scheduled count badge (if any session in workflow is scheduled) -->
            <span v-if="workflowStatus.scheduledCount > 0" class="status-badge status-scheduled">
              <svg class="schedule-icon-inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              {{ workflowStatus.scheduledCount }} scheduled
            </span>

            <!-- Error count badge (if any session in workflow has error) -->
            <span v-if="workflowStatus.errorCount > 0" class="status-badge status-error">
              ⚠ {{ workflowStatus.errorCount }} error
            </span>

            <!-- Session count (only show when there are multiple sessions) -->
            <span
              v-if="!isChild && workflowStatus.totalCount > 1"
              class="session-count"
            >
              {{ workflowStatus.totalCount }} {{ workflowStatus.totalCount === 1 ? 'session' : 'sessions' }}
            </span>

            <!-- PR Indicators -->
            <PrIndicators v-if="prUrl" :pr-url="prUrl" :summary="prSummary" />

            <!-- Command button status indicators -->
            <span
              v-for="indicator in buttonStatusesToDisplay"
              :key="indicator.buttonId"
              :class="['button-status-indicator', `button-status-${indicator.status}`]"
              :title="indicator.label"
              @click.stop.prevent="selectedButtonForModal = indicator"
            >{{ getStatusIcon(indicator.status) }}</span>
          </p>

          <p v-if="showProject && session.projectName" class="session-project">
            <span class="project-name">{{ session.projectName }}</span>
          </p>
        </div>

        <SessionCardActions
          :date-to-show="dateToShow"
          :is-child="isChild"
          :show-archive="showArchive"
          :show-unarchive="showUnarchive"
          :can-archive="canArchive"
          :starred="!!session.starred"
          @archive="onArchiveClick"
          @unarchive="onUnarchiveClick"
          @star="onStarClick"
        />
      </div>

      <!-- Summary section -->
      <SessionCardSummary
        :show-summary="showSummary"
        :summary="summary"
        :summary-loading="summaryLoading"
        :summary-error="summaryError"
        :files-count="filesCount"
        :session-id="session.id"
        @retry-summary="(id) => $emit('retrySummary', id)"
      />

      <!-- Expand/collapse toggle for sessions with children -->
      <div v-if="hasChildren && !isChild" class="expand-toggle-row">
        <button
          class="expand-toggle-btn"
          @click.prevent="toggleExpand"
        >
          {{ isExpanded ? '▲ Hide sessions' : `▼ Show ${workflowStatus.totalCount} sessions` }}
        </button>
      </div>
    </router-link>

    <!-- Expanded workflow sessions panel -->
    <div v-if="hasChildren && isExpanded && !isChild" class="workflow-sessions-panel">
      <div class="workflow-sessions-list">
        <!-- Root session entry -->
        <div class="workflow-session-item root-session">
          <router-link :to="`/sessions/${session.id}`" class="workflow-session-link">
            <div class="workflow-session-label">
              <span class="workflow-session-role">◉ ROOT</span>
            </div>
            <div class="workflow-session-name">{{ session.name }}</div>
            <div class="workflow-session-meta">
              <span class="workflow-session-summary">{{ summary?.shortSummary || 'No summary yet' }}</span>
              <span class="workflow-session-date">{{ formatDate(session.createdAt) }}</span>
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
  </div>

  <!-- Button Status Modal -->
  <ButtonStatusModal
    v-if="selectedButtonForModal"
    :button="{ label: selectedButtonForModal.label, command: selectedButtonForModal.command }"
    :latest-run="selectedButtonForModal.latestRun"
    :is-open="!!selectedButtonForModal"
    @close="selectedButtonForModal = null"
  />
</template>

<script setup>
import { computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { formatDate } from '../utils/formatters.js';
import { useSessionCardActions } from '../composables/useSessionCardActions.js';
import ButtonStatusModal from './ButtonStatusModal.vue';
import PrIndicators from './PrIndicators.vue';
import WorkflowSessionItem from './WorkflowSessionItem.vue';
import SessionCardActions from './SessionCardActions.vue';
import SessionCardSummary from './SessionCardSummary.vue';

const sessionsStore = useSessionsStore();

const props = defineProps({
  session: {
    type: Object,
    required: true,
  },
  showSummary: {
    type: Boolean,
    default: false,
  },
  showProject: {
    type: Boolean,
    default: false,
  },
  summary: {
    type: Object,
    default: null,
  },
  summaryLoading: {
    type: Boolean,
    default: false,
  },
  summaryError: {
    type: Boolean,
    default: false,
  },
  children: {
    type: Array,
    default: () => [],
  },
  isChild: {
    type: Boolean,
    default: false,
  },
  summaries: {
    type: Object,
    default: () => ({}),
  },
  showArchive: {
    type: Boolean,
    default: false,
  },
  showUnarchive: {
    type: Boolean,
    default: false,
  },
  prUrl: {
    type: String,
    default: null,
  },
  prSummary: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['retrySummary', 'archive', 'unarchive']);

const {
  selectedButtonForModal,
  filesCount,
  canArchive,
  buttonStatusesToDisplay,
  commandButtons,
  getStatusIcon,
  onArchiveClick,
  onUnarchiveClick,
  onStarClick,
} = useSessionCardActions(props, emit);

const dateToShow = computed(() => {
  // For project view (showProject=false), show createdAt; for active sessions view (showProject=true), show updatedAt
  return props.showProject ? props.session.updatedAt : props.session.createdAt;
});

const hasChildren = computed(() => props.children && props.children.length > 0);

const isExpanded = computed(() => sessionsStore.isSessionExpanded(props.session.id));

// Get aggregated workflow status for display
const workflowStatus = computed(() => {
  if (props.isChild) {
    // For child sessions, just show their own status
    const status = props.session.status;
    const runningStatuses = ['running', 'starting'];
    return {
      runningCount: runningStatuses.includes(status) ? 1 : 0,
      scheduledCount: status === 'scheduled' ? 1 : 0,
      errorCount: status === 'error' ? 1 : 0,
      totalCount: 1,
    };
  }
  return sessionsStore.getWorkflowAggregatedStatus(props.session.id);
});

// Get all descendants for the expanded panel
const allDescendants = computed(() => {
  return sessionsStore.getAllDescendants(props.session.id);
});

// Get depth of a session in the hierarchy (for indentation)
const getSessionDepth = (sessionId) => {
  const path = sessionsStore.getSessionPath(sessionId);
  // Subtract 1 because root is depth 0
  return Math.max(0, path.length - 1);
};

const toggleExpand = () => {
  sessionsStore.toggleSessionExpanded(props.session.id);
  sessionsStore.saveExpandedState();
};
</script>

<style scoped>
.workflow-card-wrapper {
  display: flex;
  flex-direction: column;
}

.parent-card {
  border-bottom: none;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.session-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  color: var(--color-text);
  text-decoration: none;
  transition: border-color 0.2s;
}

.session-card:hover {
  border-color: var(--color-primary);
  text-decoration: none;
}

.session-card.is-child {
  margin-left: 1rem;
  opacity: 0.9;
  background: var(--color-background-secondary, rgba(0, 0, 0, 0.2));
}

.session-header-row {
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  align-items: flex-start;
}

.child-count {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  background: var(--color-border);
  border-radius: 50%;
  width: 1.5rem;
  height: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-weight: 500;
}

.session-info {
  flex: 1;
  min-width: 0; /* Allows text truncation to work in flexbox */
}

.session-name {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  overflow: auto;
  word-break: break-word;
  line-height: 1.4;
}

.session-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.schedule-indicator {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.schedule-icon {
  font-size: 0.875rem;
}


.session-project {
  margin: 0.5rem 0 0;
}

.project-name {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.session-action-buttons-group {
  display: flex;
  gap: 0.25rem;
}

.star-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-soft);
  border-radius: var(--border-radius);
  transition: color 0.15s, background-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.star-btn:hover {
  color: var(--color-primary);
  background-color: var(--color-bg-soft);
}

/* Session count badge */
.session-count {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

/* Schedule icon inline with text */
.schedule-icon-inline {
  display: inline-block;
  vertical-align: middle;
  margin-right: 0.25rem;
}

/* Expand toggle row at bottom of card */
.expand-toggle-row {
  padding-top: 0.5rem;
  border-top: 1px solid var(--color-border);
}

.expand-toggle-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 0.25rem 0;
  transition: color 0.15s;
}

.expand-toggle-btn:hover {
  color: var(--color-primary-bright, #06ffff);
}

/* Workflow sessions panel (expanded view) */
.workflow-sessions-panel {
  border: 1px solid var(--color-border);
  border-top: none;
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  background: var(--color-background-secondary, rgba(0, 0, 0, 0.1));
  animation: slideIn 0.2s ease-out;
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

.button-status-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 50%;
  margin-left: 0.5rem;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  border: 1px solid transparent;
}

.button-status-indicator:hover {
  transform: scale(1.15);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
}

.button-status-running {
  background-color: rgba(210, 153, 34, 0.3);
  color: #d29922;
  border-color: #d29922;
  animation: pulse 1.5s ease-in-out infinite;
}

.button-status-success {
  background-color: rgba(63, 185, 80, 0.3);
  color: #3fb950;
  border-color: #3fb950;
}

.button-status-error {
  background-color: rgba(248, 81, 73, 0.3);
  color: #f85149;
  border-color: #f85149;
}

.button-status-killed {
  background-color: rgba(248, 81, 73, 0.3);
  color: #f85149;
  border-color: #f85149;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

@media (max-width: 480px) {
  /* Keep header row horizontal but allow wrapping */
  .session-header-row {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* Hide star button in header row on mobile */
  .session-header-row > .star-btn {
    display: none;
  }

  /* Reduce card padding for compact display */
  .session-card {
    padding: 0.75rem;
    gap: 0.5rem;
  }

  /* Compact metadata row with wrapping */
  .session-meta {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* Smaller badges on mobile */
  .status-badge {
    font-size: 0.7rem;
  }

  /* Session info takes full width, date wraps below */
  .session-info {
    min-width: 0;
    flex: 1 1 100%;
  }

  .session-card.is-child {
    margin-left: 0.5rem;
  }

  .children-container {
    margin-left: -0.75rem;
    margin-right: -0.75rem;
    border-left: none;
    border-radius: 0;
    padding: 0.5rem;
  }
}
</style>
