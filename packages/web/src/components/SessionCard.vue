<template>
  <!-- Parent session with children -->
  <div v-if="hasChildren" class="parent-session-group">
    <router-link :to="`/sessions/${session.id}`" class="session-card card parent-card">
      <div class="session-header-row">
        <div class="expand-toggle">
          <button
            class="expand-btn"
            @click.prevent="toggleExpand"
            :aria-label="isExpanded ? 'Collapse children' : 'Expand children'"
            :title="isExpanded ? 'Collapse' : 'Expand'"
          >
            {{ isExpanded ? '▼' : '▶' }}
          </button>
          <span v-if="childCount > 0" class="child-count">{{ childCount }}</span>
        </div>
        <div class="session-info">
          <h3 class="session-name">{{ session.name }}</h3>
          <p class="session-meta">
            <span :class="['status-badge', `status-${session.status}`]">{{ session.status }}</span>
            <span class="session-mode">{{ formattedMode }}</span>
            <PrIndicators v-if="prUrl" :pr-url="prUrl" :summary="prSummary" />
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
        <div class="session-date">
          {{ formatDate(dateToShow) }}
        </div>
      </div>
      <div v-if="showSummary">
        <div v-if="summary" class="session-summary">
          <p class="summary-text">{{ summary.shortSummary }}</p>
          <div class="summary-meta">
            <span v-if="summary.filesModified?.length" class="summary-files">
              {{ summary.filesModified.length }} files modified
            </span>
          </div>
        </div>
        <div v-else-if="summaryLoading" class="session-summary session-summary-loading">
          <span class="loading-spinner-small"></span>
          <span>Loading summary...</span>
        </div>
        <div v-else-if="summaryError" class="session-summary session-summary-error">
          <span class="error-icon">!</span>
          <span>Summary unavailable</span>
          <button class="retry-btn" @click.prevent="$emit('retrySummary', session.id)">Retry</button>
        </div>
      </div>
    </router-link>

    <!-- Children container -->
    <div v-if="isExpanded" class="children-container">
      <div v-for="child in children" :key="child.id" class="child-session">
        <SessionCard
          :session="child"
          :show-summary="true"
          :summary="summaries[child.id]"
          :is-child="true"
          :children="getChildrenForSession(child.id)"
          :summaries="summaries"
          :pr-url="child.prUrl"
          :pr-summary="summaries[child.id]"
          @retry-summary="$emit('retrySummary', child.id)"
        />
      </div>
      <button class="add-child-btn" @click="addChildSession">
        + Add child session
      </button>
    </div>
  </div>

  <!-- Regular card (standalone or child) -->
  <router-link
    v-else
    :to="`/sessions/${session.id}`"
    class="session-card card"
    :class="{ 'is-child': isChild }"
  >
    <div class="session-header-row">
      <div class="session-info">
        <h3 class="session-name">{{ session.name }}</h3>
        <p class="session-meta">
          <span :class="['status-badge', `status-${session.status}`]">{{ session.status }}</span>
          <span class="session-mode">{{ formattedMode }}</span>
          <span class="session-model">{{ formattedModel }}</span>
          <PrIndicators v-if="prUrl" :pr-url="prUrl" :summary="prSummary" />
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
      <div class="session-header-actions">
        <div class="session-date">
          {{ formatDate(dateToShow) }}
        </div>
        <div class="session-action-buttons-group">
          <button
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
          <div v-if="showArchive || showUnarchive" class="archive-actions">
            <button
              v-if="showArchive && canArchive"
              class="archive-btn"
              title="Archive session"
              @click.stop.prevent="onArchiveClick"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="5" rx="1" ry="1"></rect>
                <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"></path>
                <path d="M10 13h4"></path>
              </svg>
            </button>
            <button
              v-if="showUnarchive"
              class="archive-btn"
              title="Unarchive session"
              @click.stop.prevent="onUnarchiveClick"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="4" width="20" height="5" rx="1" ry="1"></rect>
                <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"></path>
                <path d="M12 11v6"></path>
                <path d="M9 14l3-3 3 3"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
    <div v-if="showSummary">
      <div v-if="summary" class="session-summary">
        <p class="summary-text">{{ summary.shortSummary }}</p>
        <div class="summary-meta">
          <span v-if="summary.filesModified?.length" class="summary-files">
            {{ summary.filesModified.length }} files modified
          </span>
        </div>
      </div>
      <div v-else-if="summaryLoading" class="session-summary session-summary-loading">
        <span class="loading-spinner-small"></span>
        <span>Loading summary...</span>
      </div>
      <div v-else-if="summaryError" class="session-summary session-summary-error">
        <span class="error-icon">!</span>
        <span>Summary unavailable</span>
        <button class="retry-btn" @click.prevent="$emit('retrySummary', session.id)">Retry</button>
      </div>
    </div>
  </router-link>

  <!-- Button Status Modal -->
  <ButtonStatusModal
    v-if="selectedButtonForModal"
    :button="{ label: selectedButtonForModal.label }"
    :latest-run="selectedButtonForModal.latestRun"
    :is-open="!!selectedButtonForModal"
    @close="selectedButtonForModal = null"
  />
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { formatDate } from '../utils/formatters.js';
import { useModelInfo } from '../composables/useModelInfo.js';
import ButtonStatusModal from './ButtonStatusModal.vue';
import PrIndicators from './PrIndicators.vue';

const router = useRouter();
const sessionsStore = useSessionsStore();
const commandButtonsStore = useCommandButtonsStore();
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

const { getModelDisplayName } = useModelInfo();

// Show archive for statuses that are no longer active (not running or starting)
const canArchive = computed(() => {
  return props.session.status !== 'running' && props.session.status !== 'starting';
});

const dateToShow = computed(() => {
  // For project view (showProject=false), show createdAt; for active sessions view (showProject=true), show updatedAt
  return props.showProject ? props.session.updatedAt : props.session.createdAt;
});

const formattedMode = computed(() => {
  const mode = props.session.mode;
  if (mode === 'yolo') return 'YOLO';
  // Capitalize first letter for other modes
  return mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : '';
});

const formattedModel = computed(() => {
  return getModelDisplayName(props.session.model);
});

const hasChildren = computed(() => props.children && props.children.length > 0);

const childCount = computed(() => props.children?.length || 0);

const isExpanded = computed(() => sessionsStore.isSessionExpanded(props.session.id));

const toggleExpand = () => {
  sessionsStore.toggleSessionExpanded(props.session.id);
  sessionsStore.saveExpandedState();
};

const addChildSession = () => {
  // Navigate to create new session with parent ID pre-filled
  router.push({
    name: 'new-session',
    params: { projectId: props.session.projectId || '' },
    query: { parentSessionId: props.session.id },
  });
};

const getChildrenForSession = (sessionId) => {
  return sessionsStore.getChildSessions(sessionId);
};

const buttonStatusesToDisplay = computed(() => {
  const projectId = props.session.projectId;
  if (!projectId) return [];

  // Access buttons state directly to ensure Vue tracks dependencies
  // eslint-disable-next-line no-unused-vars
  const _buttonsRef = commandButtonsStore.buttons;

  const buttons = commandButtonsStore.getButtonsByProjectId(projectId);
  const buttonMap = Object.fromEntries(buttons.map(b => [b.id, b]));

  // Read directly from session object (pre-joined by server, includes running commands)
  // This eliminates client-side O(buttons × runs) filtering
  return (props.session.latestCommandRuns || [])
    .filter(run => buttonMap[run.buttonId]?.showOnList)
    .map(run => ({
      buttonId: run.buttonId,
      label: buttonMap[run.buttonId].label,
      status: run.status,
      latestRun: run,
    }));
});

const getStatusIcon = (status) => {
  switch (status) {
    case 'running':
      return '⊙';
    case 'success':
      return '✓';
    case 'error':
      return '✕';
    case 'killed':
      return '✕';
    default:
      return '';
  }
};

const onArchiveClick = () => {
  if (confirm('Archive this session?')) {
    emit('archive', props.session.id);
  }
};

const onUnarchiveClick = () => {
  if (confirm('Restore this session to active?')) {
    emit('unarchive', props.session.id);
  }
};

const onStarClick = () => {
  sessionsStore.toggleSessionStar(props.session.id);
};
</script>

<style scoped>
.parent-session-group {
  display: flex;
  flex-direction: column;
  gap: 0;
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

.expand-toggle {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
}

.expand-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0;
  width: 1.25rem;
  height: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  transition: color 0.15s;
  flex-shrink: 0;
}

.expand-btn:hover {
  color: var(--color-text);
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.session-mode {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.session-model {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.session-project {
  margin: 0.5rem 0 0;
}

.project-name {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.session-header-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
}

.session-date {
  font-size: 0.875rem;
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

.archive-actions {
  display: flex;
  gap: 0.25rem;
}

.archive-btn {
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

.archive-btn:hover {
  color: var(--color-primary);
  background-color: var(--color-bg-soft);
}

.session-summary {
  padding-top: 0.5rem;
  border-top: 1px solid var(--color-border);
}

.session-summary-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.75rem;
}

.session-summary-error {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.75rem;
}

.error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  background-color: var(--color-warning);
  color: white;
  border-radius: 50%;
  font-size: 0.625rem;
  font-weight: bold;
}

.retry-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  margin-left: auto;
}

.retry-btn:hover {
  text-decoration: underline;
}

.summary-text {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-soft);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.summary-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.summary-files {
  opacity: 0.8;
}

.loading-spinner-small {
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.children-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-left: 0;
  margin-top: 0;
  padding: 0.75rem 1rem;
  background: var(--color-background-secondary, rgba(0, 0, 0, 0.1));
  border-left: 2px solid var(--color-primary);
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
}

.child-session {
  animation: slideIn 0.2s ease-out;
}

.add-child-btn {
  margin-top: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--color-border);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius, 6px);
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.15s;
}

.add-child-btn:hover {
  background: var(--color-primary);
  color: white;
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
  .status-badge,
  .session-mode,
  .session-model {
    font-size: 0.7rem;
  }

  /* Compact date display */
  .session-date {
    font-size: 0.75rem;
  }

  /* Session info takes full width, date wraps below */
  .session-info {
    min-width: 0;
    flex: 1 1 100%;
  }

  .session-header-actions {
    flex-direction: row;
    align-items: center;
    width: 100%;
    justify-content: space-between;
  }

  /* Limit summary to 1 line on very small screens */
  .summary-text {
    -webkit-line-clamp: 1;
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
