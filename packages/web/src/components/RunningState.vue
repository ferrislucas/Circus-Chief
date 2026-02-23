<template>
  <div class="running-state">
    <!-- Header row with status, token display, and stop button -->
    <div class="running-header">
      <div class="running-status">
        <span class="loading-spinner"></span>
        <span class="running-title">Claude is working...</span>
      </div>
      <button type="button" class="btn btn-danger btn-stop" @click="$emit('stop')" :disabled="stopping">
        <span v-if="stopping" class="loading-spinner"></span>
        Stop
      </button>
    </div>

    <!-- Work logs panel (without its own header) -->
    <LiveWorkLogPanel
      :work-logs="workLogs"
      :partial-thinking="partialThinking"
      :show-header="false"
    />

    <!-- Show template indicator while running -->
    <div v-if="nextTemplate" class="template-pending">
      <span class="template-pending-label">Next:</span>
      <router-link
        :to="templateLink"
        class="template-pending-link"
        :title="`View template: ${nextTemplate.name}`"
      >
        {{ nextTemplate.name }}
      </router-link>
      <span class="template-pending-description">will trigger when Claude finishes</span>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import LiveWorkLogPanel from './LiveWorkLogPanel.vue';

const props = defineProps({
  stopping: { type: Boolean, default: false },
  workLogs: { type: Array, default: () => [] },
  partialThinking: { type: String, default: null },
  nextTemplate: { type: Object, default: null },
  projectId: { type: String, default: null },
});

defineEmits(['stop']);

const templateLink = computed(() => {
  return `/projects/${props.projectId}/templates`;
});
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

/* Hide "Claude is working..." text on extremely small screens */
@media (max-width: 360px) {
  .running-title {
    display: none;
  }
}
</style>
