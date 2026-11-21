<template>
  <div class="running-state">
    <!-- Header row with status, token display, and stop button -->
    <div class="running-header">
      <button
        type="button"
        class="running-status"
        :aria-expanded="logsExpanded ? 'true' : 'false'"
        aria-controls="running-work-logs"
        title="Toggle agent activity"
        @click="logsExpanded = !logsExpanded"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          class="chevron-icon"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 1 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clip-rule="evenodd"
          />
        </svg>
        <span class="running-title">Agent is working...</span>
        <span
          v-if="activityCount"
          class="running-count"
        >({{ activityCount }})</span>
      </button>
      <div class="running-actions">
        <span
          v-if="activeModelDisplayName"
          class="running-model-label"
        >{{ activeModelDisplayName }}</span>
        <button
          type="button"
          class="btn btn-danger btn-stop"
          :disabled="stopping"
          @click="onStopClick"
        >
          <span class="loading-spinner" />
          Stop
        </button>
      </div>
    </div>

    <!-- Work logs panel (without its own header). Mounted only while open so
         follow-mode pins to the tail on expand instead of scrolling a hidden box. -->
    <LiveWorkLogPanel
      v-if="logsExpanded"
      id="running-work-logs"
      :work-logs="workLogs"
      :partial-thinking="partialThinking"
      :show-header="false"
    />

    <!-- Show template indicator while running -->
    <div
      v-if="nextTemplate"
      class="template-pending"
    >
      <span class="template-pending-label">Next:</span>
      <a
        :href="templateLink"
        class="template-pending-link"
        :title="`View template: ${nextTemplate.name}`"
      >
        {{ nextTemplate.name }}
      </a>
      <span class="template-pending-description">will trigger when the agent finishes</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import LiveWorkLogPanel from './LiveWorkLogPanel.vue';

const props = defineProps({
  activeModelDisplayName: { type: String, default: null },
  stopping: { type: Boolean, default: false },
  workLogs: { type: Array, default: () => [] },
  partialThinking: { type: String, default: '' },
  nextTemplate: { type: Object, default: null },
  projectId: { type: String, default: null },
});

const emit = defineEmits(['stop']);

// Each run starts collapsed. RunningState is created only while the session
// is running, so this does not need to persist across navigations.
const logsExpanded = ref(false);

const activityCount = computed(() => {
  const logCount = Array.isArray(props.workLogs) ? props.workLogs.length : 0;
  const partialCount = props.partialThinking ? 1 : 0;
  return logCount + partialCount;
});

function onStopClick() {
  emit('stop');
}

const templateLink = computed(() => `/projects/${props.projectId}/templates`);
</script>

<style scoped>
.running-state {
  border-top: 1px solid var(--color-border);
  padding-top: 1rem;
}

.running-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.running-status {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 44px;
  min-width: 0;
  margin: 0;
  padding: 0.25rem 0.375rem;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--color-text-soft);
  font: inherit;
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
}

.running-status:hover {
  color: var(--color-text);
  background: var(--color-background-mute);
}

.running-status:focus {
  outline: none;
}

.running-status:focus-visible {
  box-shadow: 0 0 0 2px var(--color-accent);
}

.chevron-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.running-status[aria-expanded="true"] .chevron-icon {
  transform: rotate(180deg);
}

.running-title {
  font-weight: 500;
}

.running-count {
  font-size: 0.8125rem;
  opacity: 0.7;
  white-space: nowrap;
}

.btn-stop {
  min-height: 36px;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  flex-shrink: 0;
}

.running-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

.running-model-label {
  font-size: 0.75rem;
  color: var(--color-text-soft, #888);
  white-space: nowrap;
}

.template-pending {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  margin-top: 0.75rem;
  background: var(--color-bg-soft);
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  font-size: 0.875rem;
}

.template-pending-label {
  color: var(--color-text-soft);
  font-weight: 500;
}

.template-pending-link {
  color: var(--color-accent);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.15s;
}

.template-pending-link:hover {
  color: var(--color-accent);
  text-decoration: underline;
}

.template-pending-description {
  color: var(--color-text-soft);
  font-size: 0.75rem;
  font-style: italic;
}

@media (prefers-reduced-motion: reduce) {
  .chevron-icon {
    transition: none;
  }
}

/* Hide "Agent is working..." text on extremely small screens.
   The chevron stays so the disclosure is still visible. */
@media (max-width: 360px) {
  .running-title {
    display: none;
  }
}
</style>
