<template>
  <div class="running-state">
    <!-- Header row with status, token display, and stop button -->
    <div class="running-header">
      <div class="running-status">
        <span class="running-title">Agent is working...</span>
      </div>
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

    <!-- Work logs panel (without its own header) -->
    <LiveWorkLogPanel
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
import { computed } from 'vue';
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
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.875rem;
}

.running-title {
  font-weight: 500;
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

/* Hide "Agent is working..." text on extremely small screens */
@media (max-width: 360px) {
  .running-title {
    display: none;
  }
}
</style>
