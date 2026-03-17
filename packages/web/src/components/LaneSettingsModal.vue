<template>
  <div v-if="isOpen" class="modal-backdrop" @click.self="close">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">Lane Settings</h2>
        <button @click="close" class="close-btn" aria-label="Close">&times;</button>
      </div>

      <div class="modal-body">
        <!-- Lane Name -->
        <div class="form-group">
          <label for="lane-name" class="form-label">Lane Name</label>
          <input
            id="lane-name"
            type="text"
            v-model="form.name"
            class="form-input"
            placeholder="Enter lane name"
          />
        </div>

        <!-- Automation Type -->
        <div class="form-group">
          <label class="form-label">On-Enter Automation</label>
          <div class="automation-options">
            <label class="radio-option">
              <input
                type="radio"
                v-model="automationType"
                value="none"
                name="automation"
              />
              <span>None</span>
            </label>
            <label class="radio-option">
              <input
                type="radio"
                v-model="automationType"
                value="template"
                name="automation"
              />
              <span>Run a template</span>
            </label>
            <label class="radio-option">
              <input
                type="radio"
                v-model="automationType"
                value="prompt"
                name="automation"
              />
              <span>Run a custom prompt</span>
            </label>
          </div>
        </div>

        <!-- Template Selector -->
        <div v-if="automationType === 'template'" class="form-group">
          <label for="template-select" class="form-label">Select Template</label>
          <select
            id="template-select"
            v-model="form.onEnterTemplateId"
            class="form-input"
          >
            <option :value="null">Select a template...</option>
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
          <p class="form-help">
            When a session enters this lane, the selected template will automatically run.
          </p>
        </div>

        <!-- Custom Prompt -->
        <div v-if="automationType === 'prompt'" class="form-group">
          <label for="custom-prompt" class="form-label">Custom Prompt</label>
          <ResizableTextarea
            id="custom-prompt"
            v-model="form.onEnterPrompt"
            class="form-input form-textarea"
            placeholder="Enter the prompt to run when a session enters this lane..."
            rows="4"
            :min-height="80"
          />
          <InterpolationHelp />
        </div>

        <!-- Delete Lane Section -->
        <div class="danger-zone">
          <h4 class="danger-title">Danger Zone</h4>
          <p class="danger-description">
            Deleting this lane will remove all cards from it. Sessions will remain in the project.
          </p>
          <button
            @click="confirmDelete"
            class="btn btn-danger"
            :disabled="deleting"
          >
            {{ deleting ? 'Deleting...' : 'Delete Lane' }}
          </button>
        </div>
      </div>

      <div class="modal-footer">
        <button @click="close" class="btn btn-secondary">Cancel</button>
        <button
          @click="handleSave"
          class="btn btn-primary"
          :disabled="saving || !isValid"
        >
          {{ saving ? 'Saving...' : 'Save Changes' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useKanbanStore } from '../stores/kanban.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useUiStore } from '../stores/ui.js';
import InterpolationHelp from './InterpolationHelp.vue';
import ResizableTextarea from './ResizableTextarea.vue';

const props = defineProps({
  isOpen: Boolean,
  projectId: String,
  lane: Object,
});

const emit = defineEmits(['close', 'update:isOpen', 'updated', 'deleted']);

const kanbanStore = useKanbanStore();
const templatesStore = useTemplatesStore();
const uiStore = useUiStore();

const saving = ref(false);
const deleting = ref(false);
const automationType = ref('none');

const form = reactive({
  name: '',
  onEnterTemplateId: null,
  onEnterPrompt: '',
});

const projectTemplates = computed(() => templatesStore.projectTemplates);
const globalTemplates = computed(() => templatesStore.globalTemplates);

const isValid = computed(() => {
  if (!form.name.trim()) return false;
  if (automationType.value === 'template' && !form.onEnterTemplateId) return false;
  if (automationType.value === 'prompt' && !form.onEnterPrompt.trim()) return false;
  return true;
});

function resetForm() {
  if (props.lane) {
    form.name = props.lane.name || '';
    form.onEnterTemplateId = props.lane.onEnterTemplateId || null;
    form.onEnterPrompt = props.lane.onEnterPrompt || '';

    // Determine automation type from current values
    if (props.lane.onEnterTemplateId) {
      automationType.value = 'template';
    } else if (props.lane.onEnterPrompt) {
      automationType.value = 'prompt';
    } else {
      automationType.value = 'none';
    }
  } else {
    form.name = '';
    form.onEnterTemplateId = null;
    form.onEnterPrompt = '';
    automationType.value = 'none';
  }
}

function close() {
  emit('update:isOpen', false);
  emit('close');
}

async function handleSave() {
  if (!props.lane || !isValid.value) return;

  saving.value = true;
  try {
    const data = {
      name: form.name.trim(),
    };

    // Set automation based on type
    if (automationType.value === 'template') {
      data.onEnterTemplateId = form.onEnterTemplateId;
      data.onEnterPrompt = null; // Clear prompt when using template
    } else if (automationType.value === 'prompt') {
      data.onEnterTemplateId = null; // Clear template when using prompt
      data.onEnterPrompt = form.onEnterPrompt.trim();
    } else {
      // None - clear both
      data.onEnterTemplateId = null;
      data.onEnterPrompt = null;
    }

    await kanbanStore.updateLane(props.projectId, props.lane.id, data);
    uiStore.success('Lane settings saved');
    emit('updated');
    close();
  } catch (err) {
    console.error('Failed to save lane settings:', err);
    uiStore.error(err.message || 'Failed to save lane settings');
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  if (!props.lane) return;

  if (!confirm(`Are you sure you want to delete the "${props.lane.name}" lane? This cannot be undone.`)) {
    return;
  }

  deleting.value = true;
  try {
    await kanbanStore.deleteLane(props.projectId, props.lane.id);
    uiStore.success('Lane deleted');
    emit('deleted');
    close();
  } catch (err) {
    console.error('Failed to delete lane:', err);
    uiStore.error(err.message || 'Failed to delete lane');
  } finally {
    deleting.value = false;
  }
}

// Load templates when modal opens
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      resetForm();
      // Load templates if not already loaded
      if (props.projectId && templatesStore.projectTemplates.length === 0 && templatesStore.globalTemplates.length === 0) {
        templatesStore.fetchProjectTemplates(props.projectId);
      }
    }
  },
  { immediate: true }
);

// Reset form when lane changes
watch(
  () => props.lane,
  () => {
    if (props.isOpen) {
      resetForm();
    }
  }
);
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0.5rem;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  border: 1px solid var(--color-border);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 1.5rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.form-group {
  margin-bottom: 1.25rem;
}

.form-label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--color-text);
}

.form-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  background: var(--color-background);
  color: var(--color-text);
  font-size: 0.95rem;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(34, 197, 255, 0.1);
}

.form-textarea {
  min-height: 80px;
  font-family: var(--font-mono, monospace);
  font-size: 0.875rem;
}

.form-help {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.automation-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.radio-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--color-text);
}

.radio-option input {
  cursor: pointer;
}

.danger-zone {
  margin-top: 2rem;
  padding: 1rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.5rem;
}

.danger-title {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #ef4444;
}

.danger-description {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  color: var(--color-text-soft);
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-size: 0.9rem;
  transition: opacity 0.2s, background-color 0.2s;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-background-secondary);
}

.btn-danger {
  background: #ef4444;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
