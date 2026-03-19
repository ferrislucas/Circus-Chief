<template>
  <div class="template-selector">
    <label class="selector-label">Next Template</label>
    <div class="selector-wrapper">
      <select
        v-model="selectedTemplateId"
        @change="handleChange"
        class="form-input"
        :disabled="disabled || loading"
      >
        <option :value="null">Select a template to run...</option>
        <optgroup v-if="projectTemplates.length" label="Project Templates">
          <option v-for="t in projectTemplates" :key="t.id" :value="t.id">
            {{ t.name }}
          </option>
        </optgroup>
        <optgroup v-if="globalTemplates.length" label="Global Templates">
          <option v-for="t in globalTemplates" :key="t.id" :value="t.id">
            {{ t.name }}
          </option>
        </optgroup>
      </select>
      <button
        v-if="selectedTemplateId"
        @click="clearSelection"
        class="btn-clear"
        title="Clear selection"
        :disabled="disabled || saving"
      >
        ✕
      </button>
    </div>
    <div v-if="selectedTemplate" class="template-preview">
      <p class="template-prompt-preview">
        {{ truncatePrompt(selectedTemplate.prompt) }}
      </p>
      <span v-if="chainDescription" class="chain-indicator">
        {{ chainDescription }}
      </span>
    </div>
    <p v-else class="selector-help">
      When Claude finishes responding, a new session will automatically start using this template.
    </p>
    <div v-if="saving" class="saving-indicator">
      <span class="loading-spinner"></span>
      Saving...
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, toRef } from 'vue';
import { useTemplatesStore } from '../stores/templates.js';

const props = defineProps({
  sessionId: { type: String, required: false, default: null },
  projectId: { type: String, required: true },
  currentTemplateId: { type: String, default: null },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['update:templateId']);

const templatesStore = useTemplatesStore();

const selectedTemplateId = ref(props.currentTemplateId);
const saving = ref(false);

const loading = computed(() => templatesStore.loading);
const projectTemplates = computed(() => templatesStore.projectTemplates);
const globalTemplates = computed(() => templatesStore.globalTemplates);

const selectedTemplate = computed(() => {
  if (!selectedTemplateId.value) return null;
  return templatesStore.getTemplateById(selectedTemplateId.value);
});

// Build chain description (e.g., "Chains to: Template A → Template B")
const chainDescription = computed(() => {
  if (!selectedTemplate.value?.nextTemplateId) return null;

  const chain = [];
  let currentId = selectedTemplate.value.nextTemplateId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const template = templatesStore.getTemplateById(currentId);
    if (template) {
      chain.push(template.name);
      currentId = template.nextTemplateId;
    } else {
      chain.push('Unknown');
      break;
    }
    // Limit chain display to 3 items
    if (chain.length >= 3) {
      chain.push('...');
      break;
    }
  }

  return chain.length > 0 ? `Chains to: ${chain.join(' → ')}` : null;
});

// Watch for external changes to currentTemplateId
// Use toRef for better reactivity tracking with Vue Test Utils
const currentTemplateIdRef = toRef(props, 'currentTemplateId');
watch(
  currentTemplateIdRef,
  (newId) => {
    selectedTemplateId.value = newId;
  },
  { flush: 'sync' }
);

onMounted(() => {
  // Fetch templates if not already loaded
  if (props.projectId && templatesStore.projectTemplates.length === 0 && templatesStore.globalTemplates.length === 0) {
    templatesStore.fetchProjectTemplates(props.projectId);
  }
});

function truncatePrompt(prompt, maxLength = 100) {
  if (!prompt) return '';
  if (prompt.length <= maxLength) return prompt;
  return prompt.substring(0, maxLength) + '...';
}

function handleChange(event) {
  // Read value directly from event to ensure we get the updated value
  // (v-model may not have updated the ref yet when @change fires)
  const newValue = event?.target?.value || selectedTemplateId.value;
  // Convert empty string to null (for the default "Select a template" option)
  const valueToEmit = newValue === '' ? null : newValue;

  saving.value = true;
  emit('update:templateId', valueToEmit);
  // Parent will handle the API call and set saving back to false
  setTimeout(() => {
    saving.value = false;
  }, 1000);
}

function clearSelection() {
  selectedTemplateId.value = null;
  handleChange();
}
</script>

<style scoped>
.template-selector {
  padding: 1rem;
  background: var(--color-bg-soft);
  border-radius: 0.5rem;
  margin-bottom: 1rem;
}

.selector-label {
  display: block;
  font-weight: 500;
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
  color: var(--color-text);
}

.selector-wrapper {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.selector-wrapper .form-input {
  flex: 1;
}

.btn-clear {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  color: var(--color-text-soft);
  font-size: 0.875rem;
  transition: all 0.15s;
}

.btn-clear:hover:not(:disabled) {
  background: var(--color-bg-hover);
  color: var(--color-error);
  border-color: var(--color-error);
}

.btn-clear:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.template-preview {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: var(--color-background);
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
}

.template-prompt-preview {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-soft);
  line-height: 1.4;
  font-style: italic;
}

.chain-indicator {
  display: inline-block;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  background: var(--color-warning, #f0ad4e);
  color: #333;
  border-radius: 4px;
}

.selector-help {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.saving-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

@media (max-width: 480px) {
  .template-selector {
    padding: 0.75rem;
  }

  .selector-wrapper {
    flex-direction: column;
    align-items: stretch;
  }

  .btn-clear {
    align-self: flex-end;
  }
}
</style>
