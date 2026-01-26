<template>
  <div class="orchestration-panel">
    <!-- Header with toggle button -->
    <div class="panel-header cursor-pointer" @click="toggle">
      <div class="header-left">
        <button
          type="button"
          class="toggle-button"
          @click.stop="toggle"
          :aria-expanded="isExpanded"
          title="Toggle orchestration panel"
          aria-label="Toggle orchestration panel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="chevron-icon">
            <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 1 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
          </svg>
        </button>
        <span class="panel-title">Orchestration</span>
      </div>
    </div>

    <!-- Content (collapsible) -->
    <div v-if="isExpanded" class="orchestration-content">
      <!-- Schedule button -->
      <div class="schedule-row">
        <button
          type="button"
          class="btn btn-secondary btn-schedule"
          @click.stop="$emit('openSchedule')"
          :disabled="!inputHasContent || (!isDraft && sessionStatus === 'scheduled')"
          :title="isDraft ? 'Schedule this session to start later' : 'Schedule this message to be sent later'"
        >
          Scheduling
        </button>
      </div>

      <!-- Template selector for chaining sessions -->
      <div class="template-row">
        <TemplateSelector
          :session-id="sessionId"
          :project-id="projectId"
          :current-template-id="currentTemplateId"
          :disabled="sessionStatus === 'running'"
          @update:templateId="handleTemplateChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { defineOptions } from 'vue';
import TemplateSelector from './TemplateSelector.vue';

defineOptions({
  name: 'OrchestrationPanel',
});

const props = defineProps({
  sessionId: { type: String, required: true },
  projectId: { type: String, required: true },
  currentTemplateId: { type: String, default: null },
  sessionStatus: { type: String, default: 'waiting' },
  isDraft: { type: Boolean, default: false },
  inputHasContent: { type: Boolean, default: false },
});

const emit = defineEmits(['openSchedule', 'update:templateId']);

const isExpanded = ref(false);

function toggle() {
  isExpanded.value = !isExpanded.value;
}

function handleTemplateChange(templateId) {
  emit('update:templateId', templateId);
}
</script>

<style scoped>
.orchestration-panel {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0;
  gap: 0.5rem;
}

.panel-header.cursor-pointer {
  cursor: pointer;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
}

.toggle-button {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s, transform 0.2s ease;
  flex-shrink: 0;
}

.toggle-button:hover {
  color: var(--color-text);
  background: var(--color-background-mute);
}

.chevron-icon {
  width: 1rem;
  height: 1rem;
  transition: transform 0.2s ease;
}

.toggle-button[aria-expanded="true"] .chevron-icon {
  transform: rotate(180deg);
}

.panel-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-soft);
  letter-spacing: 0.05em;
}

.orchestration-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.schedule-row {
  display: flex;
  justify-content: flex-start;
}

.template-row {
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
  margin-top: 0.75rem;
}

.btn-secondary {
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
}

.btn-secondary:hover {
  background-color: var(--color-background-mute);
}

.btn-schedule {
  min-width: 48px;
  min-height: 48px;
  padding: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}

.btn-schedule:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.btn-schedule:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
