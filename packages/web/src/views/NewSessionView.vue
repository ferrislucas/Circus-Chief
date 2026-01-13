<template>
  <div class="container">
    <router-link :to="`/projects/${route.params.id}/sessions`" class="back-link">
      &larr; Sessions
    </router-link>
    <h1>New Session</h1>

    <form @submit.prevent="handleSubmit" class="form card">
      <!-- Quick Responses Panel - shows quick response templates above the prompt -->
      <QuickResponsesPanel
        :show-empty="true"
        @insert="handleQuickResponseInsert"
        @openSettings="quickResponseSettingsOpen = true"
      />

      <div class="form-group">
        <textarea
          id="prompt"
          ref="textareaRef"
          class="form-input form-textarea"
          placeholder="What would you like Claude to help you with?"
          rows="5"
          required
          @input="handleInput"
          @keydown="handleKeydown"
        ></textarea>
        <div class="attachment-row">
          <FileAttachment ref="fileAttachment" @update:files="attachedFiles = $event" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Options</label>

        <div class="options-row">
          <div class="thinking-toggle">
            <div class="field-with-badge">
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  v-model="thinkingEnabled"
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="toggle-label">Enable Thinking</span>
            </div>
          </div>

          <div class="thinking-toggle">
            <div class="field-with-badge">
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  v-model="startImmediately"
                />
                <span class="toggle-slider"></span>
              </label>
              <span class="toggle-label">Start Immediately</span>
            </div>
          </div>

          <div class="mode-selector-wrapper">
            <ModeSelector v-model="mode" />
          </div>

          <div class="model-selector-wrapper">
            <ModelSelector v-model="model" />
          </div>
        </div>
      </div>

      <div v-if="error" class="error-message">{{ error }}</div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-full-width" :disabled="loading">
          <span v-if="loading" class="loading-spinner"></span>
          {{ startImmediately ? 'Start Session' : 'Create Draft' }}
        </button>
      </div>

      <!-- Git Options -->
      <div v-if="gitStatus?.isGitRepo" class="form-group">
        <label class="form-label">Git Options</label>
        <div class="quick-git-options">
          <label class="radio-option">
            <input type="radio" v-model="quickGitMode" value="worktree" />
            <span class="radio-label">Create isolated worktree</span>
            <span class="radio-help">Separate working directory for this session</span>
          </label>
          <label class="radio-option">
            <input type="radio" v-model="quickGitMode" value="branch" />
            <span class="radio-label">Create new branch</span>
            <span class="radio-help">Work in the project directory</span>
          </label>
          <label class="radio-option">
            <input type="radio" v-model="quickGitMode" value="" />
            <span class="radio-label">Use current branch</span>
            <span class="radio-help">{{ gitStatus.currentBranch }}</span>
          </label>
        </div>

        <!-- Branch name input (shown for branch or worktree) -->
        <div v-if="quickGitMode" class="quick-branch-section">
          <label class="form-label form-label-small">Branch Name</label>
          <div class="quick-branch-input">
            <input
              v-model="quickWorktreeBranch"
              type="text"
              class="form-input"
              :placeholder="autoBranchName"
              @focus="handleBranchEdit"
            />
            <button
              v-if="editingBranch"
              type="button"
              class="btn btn-small"
              @click="resetBranchName"
            >
              Reset
            </button>
          </div>
          <p class="form-help">Auto-generated from session name/prompt</p>
        </div>

      </div>

      <div v-if="loadingGit" class="git-loading">
        <span class="loading-spinner"></span>
        Loading git info...
      </div>

      <!-- Session Template (optional) -->
      <div v-if="allTemplates.length > 0" class="form-group">
        <label class="form-label" for="template">Session Template (optional)</label>
        <select id="template" v-model="selectedTemplateId" class="form-input">
          <option :value="null">None - single session</option>
          <optgroup v-if="projectTemplates.length" label="Project Templates">
            <option v-for="template in projectTemplates" :key="template.id" :value="template.id">
              {{ template.name }}
            </option>
          </optgroup>
          <optgroup v-if="globalTemplates.length" label="Global Templates">
            <option v-for="template in globalTemplates" :key="template.id" :value="template.id">
              {{ template.name }}
            </option>
          </optgroup>
        </select>
        <p class="form-help">
          When selected, the template's settings are applied and a new session will automatically start when Claude finishes.
        </p>
      </div>

      <!-- Parent Session (optional) -->
      <div v-if="availableSessions.length > 0" class="form-group">
        <label class="form-label" for="parent-session">Parent Session (optional)</label>
        <select id="parent-session" v-model="parentSessionId" class="form-input">
          <option :value="null">None - create standalone session</option>
          <option v-for="session in availableSessions" :key="session.id" :value="session.id">
            {{ session.name }}
          </option>
        </select>
        <p class="form-help">
          Choose a parent session to link this as a child session. Child sessions help organize related work.
        </p>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';
import { useQuickResponsesStore } from '../stores/quickResponses.js';
import { api } from '../composables/useApi.js';
import { useSubmitShortcut } from '../composables/useSubmitShortcut.js';
import { generateWorktreeBranch, DEFAULT_MODEL } from '@claudetools/shared';
import FileAttachment from '../components/FileAttachment.vue';
import ModelSelector from '../components/ModelSelector.vue';
import ModeSelector from '../components/ModeSelector.vue';
import QuickResponsesPanel from '../components/QuickResponsesPanel.vue';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const templatesStore = useTemplatesStore();
const defaultsStore = useProjectDefaultsStore();
const quickResponsesStore = useQuickResponsesStore();

const prompt = ref('');
const promptHasContent = ref(false); // Tracks if textarea has content (for button disabled state)
const textareaRef = ref(null);
let inputSyncTimer = null;
let debounceTimer = null;
const mode = ref('yolo');
const model = ref(DEFAULT_MODEL);
const loading = ref(false);
const quickResponseSettingsOpen = ref(false);

// Track which fields are using project defaults
const usingDefaults = ref({
  mode: false,
  model: false,
  thinkingEnabled: false,
  startImmediately: false,
  quickGitMode: false,
  quickWorktreeBranch: false,
});

// Create keyboard shortcut handler for form submission
const handleKeydown = useSubmitShortcut(() => {
  // Read directly from textarea to avoid reactivity lag
  const currentValue = textareaRef.value?.value || prompt.value;
  if (!loading.value && currentValue.trim()) {
    handleSubmit();
  }
});
const gitStatus = ref(null);
const attachedFiles = ref([]);
const fileAttachment = ref(null);
const selectedTemplateId = ref(null);
const parentSessionId = ref(null);
const startImmediately = ref(true);

const projectTemplates = computed(() => templatesStore.projectTemplates);
const globalTemplates = computed(() => templatesStore.globalTemplates);
const allTemplates = computed(() => [...projectTemplates.value, ...globalTemplates.value]);

const storageKey = computed(() => `new-session-draft-${route.params.id}`);

// Get available sessions that can be parents (completed sessions only)
const availableSessions = computed(() => {
  return sessionsStore.sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
});

const loadingGit = ref(false);
const error = ref(null);
const thinkingEnabled = ref(true);

// Quick git feature
const quickGitMode = ref('worktree'); // '', 'branch', or 'worktree'
const quickWorktreeBranch = ref('');
const editingBranch = ref(false);
let branchDebounceTimer = null;

// Store the branch name (debounced to avoid regenerating random ID on every keystroke)
const autoBranchName = ref('');

// Debounced function to update branch name from prompt
function updateBranchNameFromPrompt(promptValue) {
  if (branchDebounceTimer) clearTimeout(branchDebounceTimer);
  branchDebounceTimer = setTimeout(() => {
    autoBranchName.value = generateWorktreeBranch('', promptValue);
    // Also update the input field if user hasn't manually edited it
    if (!editingBranch.value) {
      quickWorktreeBranch.value = autoBranchName.value;
    }
  }, 300);
}

// Handle textarea input with debounced sync to reactive state
// This prevents Vue reactivity from firing on every keystroke
function handleInput(event) {
  const value = event.target.value;
  const hasContent = value.trim().length > 0;

  // Only update the reactive flag if it changed (minimizes re-renders)
  if (promptHasContent.value !== hasContent) {
    promptHasContent.value = hasContent;
  }

  // Debounce the sync to reactive state
  if (inputSyncTimer) clearTimeout(inputSyncTimer);
  inputSyncTimer = setTimeout(() => {
    // Sync to reactive state (for handleSubmit to access as fallback)
    prompt.value = value;
  }, 150);

  // Update branch name (already has its own debounce)
  if (gitStatus.value?.isGitRepo) {
    updateBranchNameFromPrompt(value);
  }
}

// Initialize quick worktree branch when git status loads
watch(
  () => gitStatus.value,
  (status) => {
    if (status?.isGitRepo && !autoBranchName.value) {
      // Generate initial branch name
      autoBranchName.value = generateWorktreeBranch('', prompt.value);
      quickWorktreeBranch.value = autoBranchName.value;
    }
  },
  { immediate: true }
);

// Track when fields are overridden by user
watch(mode, () => {
  usingDefaults.value.mode = false;
});

watch(model, () => {
  usingDefaults.value.model = false;
});

watch(thinkingEnabled, () => {
  usingDefaults.value.thinkingEnabled = false;
});

watch(startImmediately, () => {
  usingDefaults.value.startImmediately = false;
});

watch(quickGitMode, () => {
  usingDefaults.value.quickGitMode = false;
});

watch(quickWorktreeBranch, () => {
  usingDefaults.value.quickWorktreeBranch = false;
});

// Watch prompt for localStorage persistence with debouncing
watch(prompt, (newValue) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (newValue.trim()) {
      localStorage.setItem(storageKey.value, newValue);
    } else {
      localStorage.removeItem(storageKey.value);
    }
  }, 500); // 500ms debounce to avoid excessive writes
});

// Cleanup timers on unmount
onUnmounted(() => {
  if (branchDebounceTimer) clearTimeout(branchDebounceTimer);
  if (inputSyncTimer) clearTimeout(inputSyncTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
});

onMounted(async () => {
  const projectId = route.params.id;

  // Restore draft from localStorage if it exists
  const saved = localStorage.getItem(storageKey.value);
  if (saved) {
    prompt.value = saved;
  }

  // Fetch project defaults
  try {
    await defaultsStore.fetchDefaults(projectId);
    const defaults = defaultsStore.getDefaultsForProject(projectId);

    if (defaults) {
      // Pre-fill form with project defaults
      if (defaults.mode) {
        mode.value = defaults.mode;
        usingDefaults.value.mode = true;
      }
      if (defaults.model) {
        model.value = defaults.model;
        usingDefaults.value.model = true;
      }
      if (defaults.thinkingEnabled !== null && defaults.thinkingEnabled !== undefined) {
        thinkingEnabled.value = defaults.thinkingEnabled;
        usingDefaults.value.thinkingEnabled = true;
      }
      if (defaults.startImmediately !== null && defaults.startImmediately !== undefined) {
        startImmediately.value = defaults.startImmediately;
        usingDefaults.value.startImmediately = true;
      }
      if (defaults.gitMode) {
        quickGitMode.value = defaults.gitMode;
        usingDefaults.value.quickGitMode = true;
      }
      if (defaults.gitBranch) {
        quickWorktreeBranch.value = defaults.gitBranch;
        usingDefaults.value.quickWorktreeBranch = true;
      }
    }
  } catch (err) {
    // Defaults fetching is optional, don't block on error
    console.warn('Failed to fetch project defaults:', err);
  }

  loadingGit.value = true;
  try {
    gitStatus.value = await api.getGitStatus(projectId);
  } catch {
    // Git status is optional
  } finally {
    loadingGit.value = false;
  }

  // Fetch templates for this project
  templatesStore.fetchProjectTemplates(projectId);

  // Fetch quick responses for this project
  quickResponsesStore.fetchForProject(projectId);

  // Pre-populate parent session ID if provided in route query
  if (route.query.parentSessionId) {
    parentSessionId.value = route.query.parentSessionId;
  }
});

function handleBranchEdit() {
  editingBranch.value = true;
}

function resetBranchName() {
  editingBranch.value = false;
  quickWorktreeBranch.value = autoBranchName.value;
}

function handleQuickResponseInsert({ content, autoSubmit }) {
  // Destructure the quick response object to extract content and autoSubmit flag
  if (autoSubmit) {
    // Auto-submit: set the content and immediately submit the form
    const textarea = textareaRef.value;
    if (textarea) {
      textarea.value = content;
      // Trigger input event to update prompt ref
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      // Submit the form in the next tick to ensure state is synchronized
      setTimeout(() => {
        handleSubmit();
      }, 0);
    }
  } else {
    // Non-auto-submit: insert content at cursor position and allow user to edit
    const textarea = textareaRef.value;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = textarea.value.substring(0, start);
      const after = textarea.value.substring(end);
      textarea.value = before + content + after;
      textarea.selectionStart = textarea.selectionEnd = start + content.length;

      // Trigger input event to update prompt ref and UI
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
    }
  }
}

async function handleSubmit() {
  // Read directly from textarea in case debounce timer hasn't fired
  const currentPrompt = textareaRef.value?.value || prompt.value;
  if (!currentPrompt.trim()) return;

  loading.value = true;
  error.value = null;

  try {
    // Determine git settings
    const submitGitMode = quickGitMode.value && gitStatus.value?.isGitRepo ? quickGitMode.value : undefined;
    const submitGitBranch = submitGitMode ? quickWorktreeBranch.value : undefined;

    const session = await sessionsStore.createSession(route.params.id, {
      prompt: currentPrompt,
      mode: mode.value,
      model: model.value,
      thinkingEnabled: thinkingEnabled.value,
      startImmediately: startImmediately.value,
      gitMode: submitGitMode,
      gitBranch: submitGitBranch,
      files: attachedFiles.value,
      templateId: selectedTemplateId.value,
      parentSessionId: parentSessionId.value || null,
    });
    fileAttachment.value?.clear();
    // Clear the draft from localStorage after successful submission
    localStorage.removeItem(storageKey.value);
    router.push(`/sessions/${session.id}`);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.back-link {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  display: inline-block;
  margin-bottom: 0.25rem;
  margin-top: 0;
}

h1 {
  margin-bottom: 0.5rem;
  margin-top: 0;
}

.form {
  width: 100%;
}

.form-help {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.attachment-row {
  margin-top: 0.5rem;
}

.git-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.form-actions {
  margin-bottom: 1.5rem;
}

.btn-full-width {
  width: 100%;
  padding-top: 1rem;
  padding-bottom: 1rem;
  font-size: 1.1rem;
}

.error-message {
  color: var(--color-error);
  margin-bottom: 1rem;
}

/* Quick git options */
.quick-git-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.radio-option {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.radio-option:hover {
  border-color: var(--color-border-hover);
  background-color: var(--color-bg-hover);
}

.radio-option:has(input:checked) {
  border-color: var(--color-accent);
  background-color: var(--color-accent-bg);
}

.radio-option input[type="radio"] {
  margin-top: 0.125rem;
}

.radio-label {
  font-weight: 500;
  color: var(--color-text);
}

.radio-help {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.quick-branch-section {
  margin-top: 1rem;
  padding: 1rem;
  background-color: var(--color-bg-soft);
  border-radius: 0.375rem;
}

.form-label-small {
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
}

.quick-branch-input {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.quick-branch-input input {
  flex: 1;
}

.btn-small {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

/* Field with badge */
.field-with-badge {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Options row */
.options-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  align-items: flex-start;
}

/* Thinking toggle */
.thinking-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toggle-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

/* Mode and model selector wrappers */
.mode-selector-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.model-selector-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
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
  background-color: var(--color-background-mute);
  border: 1px solid var(--color-border);
  border-radius: 22px;
  transition: 0.2s;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: var(--color-text-soft);
  border-radius: 50%;
  transition: 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(18px);
  background-color: #fff;
}

/* Mobile responsive styles */
@media (max-width: 480px) {
  h1 {
    margin-bottom: 0.5rem;
    font-size: 1.5rem;
  }

  .options-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .radio-option {
    flex-wrap: wrap;
    padding: 0.5rem;
  }

  .radio-help {
    width: 100%;
    margin-left: 1.5rem;
    margin-top: 0.25rem;
  }

  .quick-branch-section {
    padding: 0.75rem;
  }
}
</style>
