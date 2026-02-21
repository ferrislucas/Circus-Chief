<template>
  <div class="child-sessions-panel child-sessions-section">
    <div class="panel-header" @click="toggleExpanded">
      <h3 class="panel-title">Child Sessions ({{ sessions.length }})</h3>
      <span class="expand-icon">{{ isExpanded ? '▼' : '▶' }}</span>
    </div>

    <div v-if="isExpanded" class="panel-content">
      <div class="child-sessions-list">
      <router-link
        v-for="session in sessions"
        :key="session.id"
        :to="`/sessions/${session.id}/conversation`"
        class="child-session-item"
      >
        <div class="child-session-info">
          <div class="child-session-name">{{ session.name }}</div>
          <div class="child-session-meta">
            <span :class="['status-badge', `status-${session.status}`]">{{ session.status }}</span>

            <!-- PR Indicators -->
            <PrIndicators
              v-if="session.prUrl"
              :pr-url="session.prUrl"
              :summary="summaries[session.id]"
            />

            <!-- Command button status indicators -->
            <span
              v-for="indicator in getButtonStatuses(session)"
              :key="indicator.buttonId"
              :class="['button-status-indicator', `button-status-${indicator.status}`]"
              :title="indicator.label"
              @click.stop.prevent="selectedButtonForModal = indicator"
            >{{ getStatusIcon(indicator.status) }}</span>

            <span v-if="getTemplateName(session.nextTemplateId)" class="child-session-next-template">
              → {{ getTemplateName(session.nextTemplateId) }}
            </span>
            <span class="child-session-date">{{ formatDate(session.createdAt) }}</span>
          </div>
        </div>
        <div class="child-session-arrow">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </router-link>
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
import { ref } from 'vue';
import PrIndicators from './PrIndicators.vue';
import ButtonStatusModal from './ButtonStatusModal.vue';
import { useTemplatesStore } from '../stores/templates.js';

const selectedButtonForModal = ref(null);
const isExpanded = ref(true);

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value;
};

const props = defineProps({
  sessions: {
    type: Array,
    required: true,
  },
  parentSessionId: {
    type: String,
    required: true,
  },
  summaries: {
    type: Object,
    default: () => ({}),
  },
  commandButtons: {
    type: Array,
    default: () => [],
  },
});

const templatesStore = useTemplatesStore();

const getTemplateName = (templateId) => {
  if (!templateId) return null;
  const template = templatesStore.getTemplateById(templateId);
  return template?.name || null;
};

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;

  // Today
  if (diffMs < 86400000) {
    return `at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  // Within a week
  if (diffMs < 604800000) {
    return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  // Older
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const getButtonStatuses = (session) => {
  const buttonMap = Object.fromEntries(props.commandButtons.map(b => [b.id, b]));
  const runs = session.latestCommandRuns || [];
  return runs
    .filter(run => buttonMap[run.buttonId]?.showOnList)
    .map(run => ({
      buttonId: run.buttonId,
      label: buttonMap[run.buttonId].label,
      command: buttonMap[run.buttonId].command,
      status: run.status,
      latestRun: run,
    }));
};

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
/* Match SummaryTab section styling */
.child-sessions-panel,
.child-sessions-section {
  margin-bottom: 1.5rem;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  margin-bottom: 1rem;
  user-select: none;
}

.panel-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-soft);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.expand-icon {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  transition: transform 0.2s ease;
}

.panel-content {
  margin-bottom: 1rem;
}

.child-sessions-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.child-session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  border-radius: var(--border-radius, 8px);
  text-decoration: none;
  color: var(--color-text);
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  transition: border-color 0.15s, background-color 0.15s;
}

.child-session-item:hover {
  border-color: var(--color-primary);
  background-color: var(--color-bg-soft, rgba(255, 255, 255, 0.03));
}

.child-session-info {
  flex: 1;
  min-width: 0;
}

.child-session-name {
  font-size: 0.9rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.child-session-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.child-session-date {
  opacity: 0.7;
}

.child-session-next-template {
  color: var(--color-primary, #06b6d4);
  font-size: 0.7rem;
  font-weight: 500;
}

.child-session-arrow {
  flex-shrink: 0;
  color: var(--color-text-soft);
  margin-left: 0.5rem;
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
