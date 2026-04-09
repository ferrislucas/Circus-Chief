<template>
  <div
    v-if="isOpen"
    class="modal-backdrop"
    @click.self="close"
  >
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">
          Lane Settings
        </h2>
        <button
          class="close-btn"
          aria-label="Close"
          @click="close"
        >
          &times;
        </button>
      </div>

      <div class="modal-body">
        <!-- Lane Name -->
        <div class="form-group">
          <label
            for="lane-name"
            class="form-label"
          >Lane Name</label>
          <input
            id="lane-name"
            v-model="form.name"
            type="text"
            class="form-input"
            placeholder="Enter lane name"
          >
        </div>

        <!-- Lane Position -->
        <div
          v-if="totalLanes > 1"
          class="form-group"
        >
          <label class="form-label">Position</label>
          <div class="lane-position-controls">
            <button
              class="btn btn-icon"
              :disabled="laneIndex <= 0"
              title="Move left"
              @click="handleMoveLane(laneIndex - 1)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span class="lane-position-label">{{ laneIndex + 1 }} of {{ totalLanes }}</span>
            <button
              class="btn btn-icon"
              :disabled="laneIndex >= totalLanes - 1"
              title="Move right"
              @click="handleMoveLane(laneIndex + 1)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Automation Type -->
        <div class="form-group">
          <label class="form-label">On-Enter Automation</label>
          <div class="automation-options">
            <label class="radio-option">
              <input
                v-model="automationType"
                type="radio"
                value="none"
                name="automation"
              >
              <span>None</span>
            </label>
            <label class="radio-option">
              <input
                v-model="automationType"
                type="radio"
                value="template"
                name="automation"
              >
              <span>Run a template</span>
            </label>
            <label class="radio-option">
              <input
                v-model="automationType"
                type="radio"
                value="prompt"
                name="automation"
              >
              <span>Run a custom prompt</span>
            </label>
          </div>
        </div>

        <!-- Template Selector -->
        <div
          v-if="automationType === 'template'"
          class="form-group"
        >
          <label
            for="template-select"
            class="form-label"
          >Select Template</label>
          <select
            id="template-select"
            v-model="form.onEnterTemplateId"
            class="form-input"
          >
            <option :value="null">
              Select a template...
            </option>
            <optgroup
              v-if="projectTemplates.length"
              label="Project Templates"
            >
              <option
                v-for="t in projectTemplates"
                :key="t.id"
                :value="t.id"
              >
                {{ t.name }}
              </option>
            </optgroup>
            <optgroup
              v-if="globalTemplates.length"
              label="Global Templates"
            >
              <option
                v-for="t in globalTemplates"
                :key="t.id"
                :value="t.id"
              >
                {{ t.name }}
              </option>
            </optgroup>
          </select>
          <p class="form-help">
            When a session enters this lane, the selected template will automatically run.
          </p>
        </div>

        <!-- Custom Prompt -->
        <div
          v-if="automationType === 'prompt'"
          class="form-group"
        >
          <label
            for="custom-prompt"
            class="form-label"
          >Custom Prompt</label>
          <ResizableTextarea
            id="custom-prompt"
            ref="promptTextareaRef"
            v-model="form.onEnterPrompt"
            class="form-input form-textarea"
            placeholder="Enter the prompt to run when a session enters this lane..."
            rows="4"
            :min-height="80"
          />
          <div class="prompt-actions-row">
            <InterpolationHelp />
            <SlashCommandButton
              v-if="workingDirectory"
              @open="showSlashCommandWizard = true"
            />
          </div>
        </div>

        <!-- Slash Command Wizard Modal -->
        <SlashCommandWizard
          v-if="automationType === 'prompt'"
          v-model:is-open="showSlashCommandWizard"
          :working-directory="workingDirectory || ''"
          mode="insert"
          :hide-builtin="true"
          @insert="handleSlashCommandInsert"
        />

        <!-- Agent Settings (only for custom prompt) -->
        <div
          v-if="automationType === 'prompt'"
          class="agent-settings-section"
        >
          <button
            type="button"
            class="section-toggle"
            @click="showAgentSettings = !showAgentSettings"
          >
            <span
              class="toggle-chevron"
              :class="{ open: showAgentSettings }"
            >&#9654;</span>
            Session Settings
          </button>

          <div
            v-if="showAgentSettings"
            class="agent-settings-body"
          >
            <SessionFormOptions
              :mode="form.onEnterMode || 'standard'"
              :model="form.onEnterModel"
              :effort-level="form.onEnterEffortLevel"
              :thinking-enabled="form.onEnterThinkingEnabled ?? false"
              :hide-start-immediately="true"
              @update:mode="form.onEnterMode = $event"
              @update:model="form.onEnterModel = $event"
              @update:effort-level="form.onEnterEffortLevel = $event"
              @update:thinking-enabled="form.onEnterThinkingEnabled = $event"
            />

            <!-- Auto-Reschedule Settings -->
            <div class="form-group">
              <label class="toggle-switch-row">
                <label class="toggle-switch">
                  <input
                    v-model="form.onEnterAutoRescheduleEnabled"
                    type="checkbox"
                  >
                  <span class="toggle-slider" />
                </label>
                <span class="toggle-label">Auto-reschedule on errors</span>
              </label>
            </div>

            <div
              v-if="form.onEnterAutoRescheduleEnabled"
              class="reschedule-settings"
            >
              <!-- Reschedule Triggers -->
              <div class="form-group">
                <p class="settings-label">
                  Reschedule Triggers
                </p>
                <label class="checkbox-option">
                  <input
                    v-model="form.onEnterRescheduleOnTokenLimit"
                    type="checkbox"
                  >
                  <span>Token limit errors</span>
                </label>
                <label class="checkbox-option">
                  <input
                    v-model="form.onEnterRescheduleOnServiceError"
                    type="checkbox"
                  >
                  <span>Service unavailability</span>
                </label>
              </div>

              <!-- Delay -->
              <div class="form-group">
                <label class="form-label">Reschedule Delay</label>
                <select
                  v-model.number="form.onEnterRescheduleDelayMinutes"
                  class="form-input"
                >
                  <option :value="5">
                    5 minutes
                  </option>
                  <option :value="15">
                    15 minutes
                  </option>
                  <option :value="30">
                    30 minutes
                  </option>
                  <option :value="60">
                    1 hour
                  </option>
                  <option :value="120">
                    2 hours
                  </option>
                </select>
              </div>

              <!-- Limits -->
              <div class="form-group">
                <label class="form-label">Max Reschedule Count</label>
                <input
                  v-model.number="form.onEnterMaxRescheduleCount"
                  type="number"
                  min="1"
                  max="100"
                  class="form-input"
                  placeholder="Unlimited"
                >
              </div>

              <div class="form-group">
                <label class="form-label">Max Total Tokens</label>
                <input
                  v-model.number="form.onEnterMaxTotalTokens"
                  type="number"
                  min="1000"
                  step="1000"
                  class="form-input"
                  placeholder="Unlimited"
                >
              </div>

              <div class="form-group">
                <label class="form-label">Reschedule At Token Count</label>
                <input
                  v-model.number="form.onEnterRescheduleAtTokenCount"
                  type="number"
                  min="10000"
                  step="10000"
                  class="form-input"
                  placeholder="None"
                >
              </div>
            </div>
          </div>
        </div>

        <!-- Delete Lane Section -->
        <div class="danger-zone">
          <h4 class="danger-title">
            Danger Zone
          </h4>
          <p class="danger-description">
            Deleting this lane will remove all cards from it. Sessions will remain in the project.
          </p>
          <button
            class="btn btn-danger"
            :disabled="deleting"
            @click="confirmDelete"
          >
            {{ deleting ? 'Deleting...' : 'Delete Lane' }}
          </button>
        </div>
      </div>

      <div class="modal-footer">
        <button
          class="btn btn-secondary"
          @click="close"
        >
          Cancel
        </button>
        <button
          class="btn btn-primary"
          :disabled="saving || !isValid"
          @click="handleSave"
        >
          {{ saving ? 'Saving...' : 'Save Changes' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
/* eslint-disable max-lines */
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { useKanbanStore } from '../stores/kanban.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useUiStore } from '../stores/ui.js';
import { useProjectsStore } from '../stores/projects.js';
import InterpolationHelp from './InterpolationHelp.vue';
import ResizableTextarea from './ResizableTextarea.vue';
import SessionFormOptions from './SessionFormOptions.vue';
import SlashCommandButton from './SlashCommandButton.vue';
import SlashCommandWizard from './SlashCommandWizard.vue';

const props = defineProps({
  isOpen: Boolean,
  projectId: String,
  lane: Object,
});

const emit = defineEmits(['close', 'update:isOpen', 'updated', 'deleted']);

const kanbanStore = useKanbanStore();
const templatesStore = useTemplatesStore();
const uiStore = useUiStore();
const projectsStore = useProjectsStore();

const saving = ref(false);
const deleting = ref(false);
const automationType = ref('none');
const showAgentSettings = ref(false);
const showSlashCommandWizard = ref(false);
const promptTextareaRef = ref(null);

// Local position state to track pending position changes
const initialLaneIndex = ref(-1);
const currentLaneIndex = ref(-1);

const form = reactive({
  name: '',
  onEnterTemplateId: null,
  onEnterPrompt: '',
  // Agent settings
  onEnterMode: null,
  onEnterModel: null,
  onEnterEffortLevel: null,
  onEnterThinkingEnabled: null,
  // Auto-reschedule
  onEnterAutoRescheduleEnabled: false,
  onEnterRescheduleDelayMinutes: 15,
  onEnterRescheduleOnTokenLimit: true,
  onEnterRescheduleOnServiceError: true,
  onEnterMaxRescheduleCount: null,
  onEnterMaxTotalTokens: null,
  onEnterRescheduleAtTokenCount: null,
});

const projectTemplates = computed(() => templatesStore.projectTemplates);
const globalTemplates = computed(() => templatesStore.globalTemplates);

const workingDirectory = computed(() => {
  const project = projectsStore.getProjectById(props.projectId);
  return project?.workingDirectory || null;
});

const laneIndex = computed(() => currentLaneIndex.value);

const totalLanes = computed(() => kanbanStore.board?.lanes?.length || 0);

const isValid = computed(() => {
  if (!form.name.trim()) return false;
  if (automationType.value === 'template' && !form.onEnterTemplateId) return false;
  if (automationType.value === 'prompt' && !form.onEnterPrompt.trim()) return false;
  return true;
});

/* eslint-disable-next-line complexity */
function resetForm() {
  if (props.lane) {
    form.name = props.lane.name || '';
    form.onEnterTemplateId = props.lane.onEnterTemplateId || null;
    form.onEnterPrompt = props.lane.onEnterPrompt || '';

    // Agent settings
    form.onEnterMode = props.lane.onEnterMode || null;
    form.onEnterModel = props.lane.onEnterModel || null;
    form.onEnterEffortLevel = props.lane.onEnterEffortLevel || null;
    form.onEnterThinkingEnabled = props.lane.onEnterThinkingEnabled ?? null;
    form.onEnterAutoRescheduleEnabled = props.lane.onEnterAutoRescheduleEnabled || false;
    form.onEnterRescheduleDelayMinutes = props.lane.onEnterRescheduleDelayMinutes || 15;
    form.onEnterRescheduleOnTokenLimit = props.lane.onEnterRescheduleOnTokenLimit ?? true;
    form.onEnterRescheduleOnServiceError = props.lane.onEnterRescheduleOnServiceError ?? true;
    form.onEnterMaxRescheduleCount = props.lane.onEnterMaxRescheduleCount || null;
    form.onEnterMaxTotalTokens = props.lane.onEnterMaxTotalTokens || null;
    form.onEnterRescheduleAtTokenCount = props.lane.onEnterRescheduleAtTokenCount || null;

    // Determine automation type from current values
    if (props.lane.onEnterTemplateId) {
      automationType.value = 'template';
    } else if (props.lane.onEnterPrompt) {
      automationType.value = 'prompt';
    } else {
      automationType.value = 'none';
    }

    // Auto-expand settings section if any agent settings are already configured
    showAgentSettings.value = Boolean(form.onEnterMode ||
      form.onEnterModel ||
      form.onEnterEffortLevel ||
      form.onEnterThinkingEnabled !== null ||
      form.onEnterAutoRescheduleEnabled);

    // Initialize position tracking
    const index = kanbanStore.board?.lanes?.findIndex((l) => l.id === props.lane.id) ?? -1;
    initialLaneIndex.value = index;
    currentLaneIndex.value = index;
  } else {
    form.name = '';
    form.onEnterTemplateId = null;
    form.onEnterPrompt = '';
    form.onEnterMode = null;
    form.onEnterModel = null;
    form.onEnterEffortLevel = null;
    form.onEnterThinkingEnabled = null;
    form.onEnterAutoRescheduleEnabled = false;
    form.onEnterRescheduleDelayMinutes = 15;
    form.onEnterRescheduleOnTokenLimit = true;
    form.onEnterRescheduleOnServiceError = true;
    form.onEnterMaxRescheduleCount = null;
    form.onEnterMaxTotalTokens = null;
    form.onEnterRescheduleAtTokenCount = null;
    automationType.value = 'none';
    showAgentSettings.value = false;
    initialLaneIndex.value = -1;
    currentLaneIndex.value = -1;
  }
}

function close() {
  // Reset position to initial on cancel
  currentLaneIndex.value = initialLaneIndex.value;
  emit('update:isOpen', false);
  emit('close');
}

function handleSlashCommandInsert({ text }) {
  const textarea = promptTextareaRef.value;
  if (textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = form.onEnterPrompt.substring(0, start);
    const after = form.onEnterPrompt.substring(end);
    form.onEnterPrompt = before + text + after;
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = start + text.length;
      textarea.focus();
    });
  }
}

function handleMoveLane(toIndex) {
  const fromIndex = currentLaneIndex.value;
  if (fromIndex < 0 || fromIndex === toIndex) return;
  currentLaneIndex.value = toIndex;
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
      // Clear agent settings when using template
      data.onEnterMode = null;
      data.onEnterModel = null;
      data.onEnterEffortLevel = null;
      data.onEnterThinkingEnabled = null;
      data.onEnterAutoRescheduleEnabled = false;
      data.onEnterRescheduleDelayMinutes = 15;
      data.onEnterRescheduleOnTokenLimit = true;
      data.onEnterRescheduleOnServiceError = true;
      data.onEnterMaxRescheduleCount = null;
      data.onEnterMaxTotalTokens = null;
      data.onEnterRescheduleAtTokenCount = null;
    } else if (automationType.value === 'prompt') {
      data.onEnterTemplateId = null; // Clear template when using prompt
      data.onEnterPrompt = form.onEnterPrompt.trim();
      // Include agent settings
      data.onEnterMode = form.onEnterMode;
      data.onEnterModel = form.onEnterModel;
      data.onEnterEffortLevel = form.onEnterEffortLevel;
      data.onEnterThinkingEnabled = form.onEnterThinkingEnabled;
      data.onEnterAutoRescheduleEnabled = form.onEnterAutoRescheduleEnabled;
      data.onEnterRescheduleDelayMinutes = form.onEnterRescheduleDelayMinutes;
      data.onEnterRescheduleOnTokenLimit = form.onEnterRescheduleOnTokenLimit;
      data.onEnterRescheduleOnServiceError = form.onEnterRescheduleOnServiceError;
      data.onEnterMaxRescheduleCount = form.onEnterMaxRescheduleCount;
      data.onEnterMaxTotalTokens = form.onEnterMaxTotalTokens;
      data.onEnterRescheduleAtTokenCount = form.onEnterRescheduleAtTokenCount;
    } else {
      // None - clear both
      data.onEnterTemplateId = null;
      data.onEnterPrompt = null;
      data.onEnterMode = null;
      data.onEnterModel = null;
      data.onEnterEffortLevel = null;
      data.onEnterThinkingEnabled = null;
      data.onEnterAutoRescheduleEnabled = false;
      data.onEnterRescheduleDelayMinutes = 15;
      data.onEnterRescheduleOnTokenLimit = true;
      data.onEnterRescheduleOnServiceError = true;
      data.onEnterMaxRescheduleCount = null;
      data.onEnterMaxTotalTokens = null;
      data.onEnterRescheduleAtTokenCount = null;
    }

    // Check if position changed
    if (currentLaneIndex.value !== initialLaneIndex.value && currentLaneIndex.value >= 0) {
      const lanes = kanbanStore.board?.lanes;
      if (lanes && lanes.length > 1) {
        const newOrder = lanes.map((l) => l.id);
        const laneId = props.lane.id;
        const [movedId] = newOrder.splice(initialLaneIndex.value, 1);
        newOrder.splice(currentLaneIndex.value, 0, movedId);

        // Reorder lanes first, then update lane properties
        await kanbanStore.reorderLanes(props.projectId, newOrder);
      }
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

// Handle board updates from WebSocket (e.g., another user reorders lanes)
watch(
  () => kanbanStore.board?.lanes,
  (newLanes) => {
    if (props.isOpen && props.lane && newLanes) {
      // Update our tracked indices if the board changed externally
      const currentIndex = newLanes.findIndex((l) => l.id === props.lane.id);
      if (currentIndex >= 0) {
        initialLaneIndex.value = currentIndex;
        currentLaneIndex.value = currentIndex;
      }
    }
  },
  { deep: true }
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
  max-width: 600px;
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

.prompt-actions-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.5rem;
}

/* Agent Settings Section */
.agent-settings-section {
  margin-bottom: 1.25rem;
}

.section-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  padding: 0.5rem 0;
  transition: color 0.15s;
}

.section-toggle:hover {
  color: var(--color-text);
}

.toggle-chevron {
  display: inline-block;
  font-size: 0.65rem;
  transition: transform 0.2s;
}

.toggle-chevron.open {
  transform: rotate(90deg);
}

.agent-settings-body {
  padding: 1rem;
  margin-top: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  background: var(--color-background, rgba(255, 255, 255, 0.02));
}

/* Reschedule settings styles (matching AutoRescheduleModal) */
.toggle-switch-row {
  display: flex;
  align-items: center;
  cursor: pointer;
  gap: 0.75rem;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-border);
  border-radius: 22px;
  transition: 0.2s;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--color-primary);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(18px);
}

.toggle-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
}

.reschedule-settings {
  padding: 1rem;
  margin-top: 1rem;
  border-left: 2px solid var(--color-primary);
  background: var(--color-background, rgba(255, 255, 255, 0.02));
  border-radius: 0 0.25rem 0.25rem 0;
}

.settings-label {
  margin-bottom: 0.75rem;
  font-weight: 500;
  font-size: 0.95rem;
  color: var(--color-text);
}

.checkbox-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  cursor: pointer;
  color: var(--color-text);
}

.checkbox-option input {
  width: 1rem;
  height: 1rem;
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

/* Lane position controls */
.lane-position-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.lane-position-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  min-width: 3.5rem;
  text-align: center;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  color: var(--color-text);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background-color 0.15s;
}

.btn-icon:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.btn-icon:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
