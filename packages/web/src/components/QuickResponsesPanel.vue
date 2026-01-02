<template>
  <div v-if="hasResponses || showEmpty" class="quick-responses-panel cursor-pointer" @click="toggle">
    <!-- Header with toggle and settings button -->
    <div class="panel-header">
      <div class="header-left">
        <button
          type="button"
          class="toggle-button"
          @click.stop="toggle"
          :aria-expanded="isExpanded"
          title="Toggle quick responses panel"
          aria-label="Toggle quick responses panel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="chevron-icon">
            <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 1 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
          </svg>
        </button>
        <span class="panel-title">Quick Responses</span>
      </div>
      <button
        type="button"
        class="settings-button"
        @click.stop="$emit('openSettings')"
        title="Manage quick responses"
        aria-label="Manage quick responses"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="settings-icon">
          <path fill-rule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clip-rule="evenodd" />
        </svg>
      </button>
    </div>

    <!-- Loading state (shown when expanded) -->
    <div v-if="loading && isExpanded" class="loading-state">
      <span class="loading-text">Loading...</span>
    </div>

    <!-- Empty state (shown when expanded) -->
    <div v-else-if="!hasResponses && isExpanded" class="empty-state">
      <span class="empty-text">No quick responses yet</span>
      <button type="button" class="add-button" @click="$emit('openSettings')">+ Add Quick Response</button>
    </div>

    <!-- Responses content (collapsible) -->
    <div v-if="isExpanded && hasResponses && !loading" class="responses-content">
      <!-- Project responses -->
      <div v-if="projectResponses.length > 0" class="response-section">
        <span class="section-label">Project</span>
        <div class="responses-row">
          <button
            type="button"
            v-for="response in projectResponses"
            :key="response.id"
            @click.stop="handleClick(response)"
            class="response-button project-response"
            :class="{ 'auto-submit': response.autoSubmit }"
            :title="response.content"
          >
            <span class="button-label">{{ response.label }}</span>
            <span v-if="response.autoSubmit" class="auto-icon" title="Auto-submit">&#9889;</span>
          </button>
        </div>
      </div>

      <!-- Global responses -->
      <div v-if="globalResponses.length > 0" class="response-section">
        <span class="section-label">Global</span>
        <div class="responses-row">
          <button
            type="button"
            v-for="response in globalResponses"
            :key="response.id"
            @click.stop="handleClick(response)"
            class="response-button global-response"
            :class="{ 'auto-submit': response.autoSubmit }"
            :title="response.content"
          >
            <span class="button-label">{{ response.label }}</span>
            <span v-if="response.autoSubmit" class="auto-icon" title="Auto-submit">&#9889;</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';

defineProps({
  showEmpty: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['insert', 'openSettings']);

const store = useQuickResponsesStore();
const isExpanded = ref(false);

const loading = computed(() => store.loading);
const projectResponses = computed(() => store.projectResponses);
const globalResponses = computed(() => store.globalResponses);
const hasResponses = computed(() => store.hasResponses);

function toggle() {
  isExpanded.value = !isExpanded.value;
}

function handleClick(response) {
  emit('insert', {
    content: response.content,
    autoSubmit: response.autoSubmit,
  });
  // Auto-collapse panel after selecting a response
  isExpanded.value = false;
}
</script>

<style scoped>
.quick-responses-panel {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
}

.quick-responses-panel.cursor-pointer {
  cursor: pointer;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0;
  gap: 0.5rem;
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

.settings-button {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
}

.settings-button:hover {
  color: var(--color-text);
  background: var(--color-background-mute);
}

.settings-icon {
  width: 1rem;
  height: 1rem;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.loading-text,
.empty-text {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.add-button {
  background: var(--color-accent);
  color: var(--color-background);
  border: none;
  padding: 0.5rem 1rem;
  border-radius: var(--border-radius);
  font-size: 0.875rem;
  cursor: pointer;
  transition: opacity 0.15s;
}

.add-button:hover {
  opacity: 0.9;
}

.responses-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.response-section {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.section-label {
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  color: var(--color-text-soft);
  letter-spacing: 0.05em;
}

.responses-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
  overflow-x: auto;
}

.response-button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.625rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid transparent;
  white-space: normal;
}

.response-button:focus {
  outline: none;
  ring: 2px;
  ring-color: var(--color-accent);
}

.response-button:focus-visible {
  box-shadow: 0 0 0 2px var(--color-accent);
}

.response-button:active {
  transform: scale(0.97);
}

/* Project response styling - cyan/teal accent */
.project-response {
  background: rgb(8 145 178 / 0.15);
  color: rgb(34 211 238);
  border-color: rgb(8 145 178 / 0.3);
}

.project-response:hover {
  background: rgb(8 145 178 / 0.25);
  border-color: rgb(8 145 178 / 0.5);
}

/* Global response styling - gray */
.global-response {
  background: rgb(75 85 99 / 0.3);
  color: rgb(209 213 219);
  border-color: rgb(75 85 99 / 0.5);
}

.global-response:hover {
  background: rgb(75 85 99 / 0.5);
  border-color: rgb(75 85 99 / 0.7);
}

/* Auto-submit indicator */
.auto-submit {
  border-color: rgb(245 158 11 / 0.5);
}

.auto-icon {
  font-size: 0.75rem;
  color: rgb(245 158 11);
}

.button-label {
  word-break: break-word;
}

/* Mobile responsiveness */
@media (max-width: 640px) {
  .responses-row {
    flex-wrap: wrap;
  }

  .response-button {
    padding: 0.5rem 0.75rem;
  }
}
</style>
