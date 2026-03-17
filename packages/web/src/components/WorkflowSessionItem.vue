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
        <div class="workflow-session-meta-right">
          <!-- PR indicators are shown on the parent card, not individual children -->

          <!-- Command button status indicators -->
          <span
            v-for="indicator in buttonStatusesToDisplay"
            :key="indicator.buttonId"
            :class="['button-status-indicator', `button-status-${indicator.status}`]"
            :title="indicator.label"
            @click.stop.prevent="selectedButtonForModal = indicator"
          >{{ getStatusIcon(indicator.status) }}</span>

          <span v-if="nextTemplateName" class="workflow-session-next">
            Next: {{ nextTemplateName }}
          </span>
          <span class="workflow-session-date">{{ formatDate(displayDate) }}</span>
        </div>
      </div>
    </router-link>

    <!-- Streaming log output for running child sessions -->
    <SessionLogStream
      v-if="isRunning"
      :session-id="session.id"
    />
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
import { computed, ref } from 'vue';
import { useTemplatesStore } from '../stores/templates.js';
import PrIndicators from './PrIndicators.vue';
import ButtonStatusModal from './ButtonStatusModal.vue';
import SessionLogStream from './SessionLogStream.vue';

const templatesStore = useTemplatesStore();
const selectedButtonForModal = ref(null);

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
  prUrl: {
    type: String,
    default: null,
  },
  prSummary: {
    type: Object,
    default: null,
  },
  latestCommandRuns: {
    type: Array,
    default: () => [],
  },
  commandButtons: {
    type: Array,
    default: () => [],
  },
});

const isRunning = computed(() => ['running', 'starting'].includes(props.session.status));

const summaryText = computed(() => {
  const summary = props.summaries[props.session.id];
  return summary?.shortSummary || 'No summary yet';
});

const statusLabel = computed(() => {
  const status = props.session.status;
  if (status === 'running' || status === 'starting') return '● Running';
  if (status === 'scheduled') return '⏰ Scheduled';
  if (status === 'error') return '⚠ Error';
  // Remove "waiting" status - don't show a label for waiting sessions
  return null;
});

const displayDate = computed(() => {
  // For scheduled sessions, show when they're scheduled to run
  if (props.session.status === 'scheduled' && props.session.scheduledAt) {
    return props.session.scheduledAt;
  }
  // For all other sessions, show last activity time
  return props.session.lastActivityAt || props.session.updatedAt || props.session.createdAt;
});

const nextTemplateName = computed(() => {
  if (!props.session.nextTemplateId) return null;
  const template = templatesStore.getTemplateById(props.session.nextTemplateId);
  return template?.name || null;
});

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  if (diffMs < 86400000) return `at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const buttonStatusesToDisplay = computed(() => {
  const buttonMap = Object.fromEntries(props.commandButtons.map(b => [b.id, b]));
  return props.latestCommandRuns
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

.workflow-session-meta-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.workflow-session-next {
  font-size: 0.7rem;
  color: var(--color-primary, #06b6d4);
}

.workflow-session-date {
  flex-shrink: 0;
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
  font-size: 0.875rem;
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
</style>
