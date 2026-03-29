<template>
  <!-- Workflow card (root session with consolidated view) -->
  <div class="workflow-card-wrapper">
    <router-link
      :to="`/sessions/${session.id}`"
      class="session-card card"
      :class="{ 'is-child': isChild }"
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

          <!-- Session status badges -->
          <p class="session-meta">
            <!-- Running status badge -->
            <span v-if="workflowStatus.runningCount > 0" class="status-badge status-running">
              &#x25CF; running
            </span>

            <!-- Scheduled status badge -->
            <span v-if="workflowStatus.scheduledCount > 0" class="status-badge status-scheduled">
              <svg class="schedule-icon-inline" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
              scheduled
            </span>

            <!-- Scheduled time display (for this session when it's scheduled) -->
            <span
              v-if="scheduledTimeDisplay"
              class="scheduled-time"
              :title="scheduledAbsoluteTime"
            >
              {{ scheduledTimeDisplay }}
            </span>

            <!-- PR Indicators -->
            <PrIndicators v-if="prUrl && !isChild" :pr-url="prUrl" :summary="prSummary" data-testid="session-card-pr-indicators" />

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

        <SessionCardHeaderActions
          :date-to-show="dateToShow"
          :is-child="isChild"
          :is-on-board="isOnBoard"
          :kanban-enabled="kanbanEnabled"
          :show-archive="showArchive"
          :show-unarchive="showUnarchive"
          :session-status="session.status"
          :starred="!!session.starred"
          @archive="$emit('archive', session.id)"
          @unarchive="$emit('unarchive', session.id)"
          @star="onStarClick"
          @add-to-board="onAddToBoardClick"
        />
      </div>

      <!-- Summary section -->
      <SessionCardSummary
        v-if="showSummary"
        :session-id="session.id"
        :summary="summary"
        :summary-loading="summaryLoading"
        :summary-error="summaryError"
        @retry-summary="$emit('retrySummary', session.id)"
      />

      <!-- Streaming log output for running sessions (root or children) -->
      <SessionLogStream
        v-if="hasRunningSession"
        :session-ids="runningSessionIds"
        data-testid="session-log-stream"
      />
    </router-link>
  </div>

  <!-- Button Status Modal -->
  <ButtonStatusModal
    v-if="selectedButtonForModal"
    :button="{ id: selectedButtonForModal.buttonId, label: selectedButtonForModal.label, command: selectedButtonForModal.command }"
    :latest-run="selectedButtonForModal.latestRun"
    :is-open="!!selectedButtonForModal"
    :session-id="session.id"
    @close="selectedButtonForModal = null"
  />
</template>

<script setup>
import { computed, ref } from 'vue';
import { formatDistanceToNow, format } from 'date-fns';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useKanbanStore } from '../stores/kanban.js';
import ButtonStatusModal from './ButtonStatusModal.vue';
import PrIndicators from './PrIndicators.vue';
import SessionCardSummary from './SessionCardSummary.vue';
import SessionCardHeaderActions from './SessionCardHeaderActions.vue';
import SessionLogStream from './SessionLogStream.vue';

const sessionsStore = useSessionsStore();
const commandButtonsStore = useCommandButtonsStore();
const kanbanStore = useKanbanStore();
const selectedButtonForModal = ref(null);

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
  isChild: {
    type: Boolean,
    default: false,
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
  kanbanEnabled: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['retrySummary', 'archive', 'unarchive', 'addToBoard']);

// Check if session is already on the kanban board
const isOnBoard = computed(() => {
  return kanbanStore.isSessionOnBoard(props.session.id);
});

const onAddToBoardClick = () => {
  emit('addToBoard', props.session);
};

const dateToShow = computed(() => {
  return props.session.lastActivityAt || props.session.updatedAt || props.session.createdAt;
});

/**
 * Get all sessions in the workflow tree (root + all descendants at any depth).
 * Uses iterative DFS to find children, grandchildren, etc.
 */
function getWorkflowSessions() {
  const all = [props.session];
  const stack = [props.session.id];
  const visited = new Set();
  while (stack.length > 0) {
    const currentId = stack.pop();
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const children = sessionsStore.sessions.filter(s => s.parentSessionId === currentId);
    for (const child of children) {
      all.push(child);
      stack.push(child.id);
    }
  }
  return all;
}

// Get workflow status including all descendant sessions (full tree traversal)
const workflowStatus = computed(() => {
  const allSessions = getWorkflowSessions();
  const runningStatuses = ['running', 'starting'];

  let runningCount = 0;
  let scheduledCount = 0;
  for (const s of allSessions) {
    if (runningStatuses.includes(s.status)) runningCount++;
    if (s.status === 'scheduled') scheduledCount++;
  }

  return {
    runningCount,
    scheduledCount,
    totalCount: allSessions.length,
    effectiveStatus: props.session.status,
  };
});

// Collect all running/starting session IDs in the workflow (full tree traversal)
const runningSessionIds = computed(() => {
  const runningStatuses = ['running', 'starting'];
  return getWorkflowSessions()
    .filter(s => runningStatuses.includes(s.status))
    .map(s => s.id);
});

const hasRunningSession = computed(() => runningSessionIds.value.length > 0);

// Scheduled time display (for this specific session when it's scheduled)
const scheduledTimeDisplay = computed(() => {
  if (props.session.status !== 'scheduled' || !props.session.scheduledAt) return null;
  return formatDistanceToNow(new Date(props.session.scheduledAt), { addSuffix: true });
});

const scheduledAbsoluteTime = computed(() => {
  if (props.session.status !== 'scheduled' || !props.session.scheduledAt) return null;
  return format(new Date(props.session.scheduledAt), 'MMM d, h:mm a');
});

const buttonStatusesToDisplay = computed(() => {
  const projectId = props.session.projectId;
  if (!projectId) return [];

  // Access commandRunVersion to establish Vue dependency tracking.
  // eslint-disable-next-line no-unused-vars
  const _version = sessionsStore.commandRunVersion;

  const buttons = commandButtonsStore.getButtonsByProjectId(projectId);
  const buttonMap = Object.fromEntries(buttons.map(b => [b.id, b]));

  const sessionId = props.session.id;
  const sessions = sessionsStore.sessions;
  const storeSession = sessions.find(s => s.id === sessionId);
  const latestRuns = storeSession?.latestCommandRuns || props.session.latestCommandRuns || [];

  return latestRuns
    .filter(run => buttonMap[run.buttonId]?.showOnList)
    .map(run => ({
      buttonId: run.buttonId,
      label: buttonMap[run.buttonId].label,
      command: buttonMap[run.buttonId].command,
      status: run.status,
      latestRun: run,
    }));
});

const getStatusIcon = (status) => {
  switch (status) {
    case 'running':
      return '\u2299';
    case 'success':
      return '\u2713';
    case 'error':
      return '\u2715';
    case 'killed':
      return '\u2715';
    default:
      return '';
  }
};

const onStarClick = () => {
  sessionsStore.toggleSessionStar(props.session.id);
};
</script>

<style scoped>
.workflow-card-wrapper {
  display: flex;
  flex-direction: column;
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

.session-info {
  flex: 1;
  min-width: 0;
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

.session-project {
  margin: 0.5rem 0 0;
}

.project-name {
  font-size: 0.75rem;
  color: var(--color-text-soft);
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

.schedule-icon-inline {
  display: inline-block;
  vertical-align: middle;
  margin-right: 0.25rem;
}

.scheduled-time {
  font-size: 0.75rem;
  color: var(--color-text-soft);
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
  .session-header-row {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .session-header-row > .star-btn {
    display: none;
  }

  .session-card {
    padding: 0.75rem;
    gap: 0.5rem;
  }

  .session-meta {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .status-badge {
    font-size: 0.7rem;
  }

  .session-info {
    min-width: 0;
    flex: 1 1 100%;
  }

  .summary-text {
    -webkit-line-clamp: 3;
  }

  .session-card.is-child {
    margin-left: 0.5rem;
  }
}
</style>
