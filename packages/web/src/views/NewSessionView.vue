<template>
  <div class="container">
    <router-link :to="`/projects/${route.params.id}/sessions`" class="back-link">
      &larr; Sessions
    </router-link>
    <h1>New Session</h1>

    <form @submit.prevent="handleSubmit" class="form card">
      <div class="form-group">
        <label class="form-label" for="prompt">Initial Prompt</label>
        <textarea
          id="prompt"
          v-model="prompt"
          class="form-input form-textarea"
          placeholder="What would you like Claude to help you with?"
          rows="5"
          required
        ></textarea>
        <div class="attachment-row">
          <FileAttachment ref="fileAttachment" @update:files="attachedFiles = $event" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Options</label>
        <div class="options-row">
          <div class="thinking-toggle">
            <label class="toggle-switch">
              <input
                type="checkbox"
                v-model="thinkingEnabled"
              />
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label">Enable Thinking</span>
          </div>

          <div class="mode-selector">
            <span class="mode-label">Mode:</span>
            <div class="mode-buttons">
              <button
                type="button"
                v-for="m in modes"
                :key="m.value"
                :class="['mode-btn', { active: mode === m.value }]"
                @click="mode = m.value"
                :title="m.description"
              >
                {{ m.label }}
              </button>
            </div>
          </div>

          <ModelSelector v-model="model" />
        </div>
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

      <div v-if="error" class="error-message">{{ error }}</div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-full-width" :disabled="loading">
          <span v-if="loading" class="loading-spinner"></span>
          Start Session
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
    </form>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useTemplatesStore } from '../stores/templates.js';
import { api } from '../composables/useApi.js';
import { generateWorktreeBranch, DEFAULT_MODEL } from '@claudetools/shared';
import FileAttachment from '../components/FileAttachment.vue';
import ModelSelector from '../components/ModelSelector.vue';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const templatesStore = useTemplatesStore();

const prompt = ref('');
const mode = ref('yolo');
const model = ref(DEFAULT_MODEL);
const gitStatus = ref(null);
const attachedFiles = ref([]);
const fileAttachment = ref(null);
const selectedTemplateId = ref(null);

const projectTemplates = computed(() => templatesStore.projectTemplates);
const globalTemplates = computed(() => templatesStore.globalTemplates);
const allTemplates = computed(() => [...projectTemplates.value, ...globalTemplates.value]);

const modes = [
  { value: 'plan', label: 'Plan', description: 'Agent plans before implementing - good for complex tasks' },
  { value: 'standard', label: 'Standard', description: 'Balanced approach - asks for approval when needed' },
  { value: 'yolo', label: 'YOLO', description: 'Auto-approve mode - agent acts autonomously' },
];
const loading = ref(false);
const loadingGit = ref(false);
const error = ref(null);
const thinkingEnabled = ref(true);

// Quick git feature
const quickGitMode = ref('worktree'); // '', 'branch', or 'worktree'
const quickWorktreeBranch = ref('');
const editingBranch = ref(false);

// Generate branch name from prompt
const autoBranchName = computed(() => {
  return generateWorktreeBranch('', prompt.value);
});

// Update quick worktree branch when auto-generated name changes
watch(autoBranchName, (newBranch) => {
  if (!editingBranch.value) {
    quickWorktreeBranch.value = newBranch;
  }
});

// Initialize quick worktree branch
watch(
  () => gitStatus.value,
  (status) => {
    if (status?.isGitRepo) {
      quickWorktreeBranch.value = autoBranchName.value;
    }
  },
  { immediate: true }
);

onMounted(async () => {
  loadingGit.value = true;
  try {
    gitStatus.value = await api.getGitStatus(route.params.id);
  } catch {
    // Git status is optional
  } finally {
    loadingGit.value = false;
  }

  // Fetch templates for this project
  templatesStore.fetchProjectTemplates(route.params.id);
});

function handleBranchEdit() {
  editingBranch.value = true;
}

function resetBranchName() {
  editingBranch.value = false;
  quickWorktreeBranch.value = autoBranchName.value;
}

async function handleSubmit() {
  loading.value = true;
  error.value = null;

  try {
    // Determine git settings
    const submitGitMode = quickGitMode.value && gitStatus.value?.isGitRepo ? quickGitMode.value : undefined;
    const submitGitBranch = submitGitMode ? quickWorktreeBranch.value : undefined;

    const session = await sessionsStore.createSession(route.params.id, {
      prompt: prompt.value,
      mode: mode.value,
      model: model.value,
      thinkingEnabled: thinkingEnabled.value,
      gitMode: submitGitMode,
      gitBranch: submitGitBranch,
      files: attachedFiles.value,
      templateId: selectedTemplateId.value,
    });
    uiStore.success('Session started');
    fileAttachment.value?.clear();
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
  margin-bottom: 0.5rem;
}

h1 {
  margin-bottom: 2rem;
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

/* Options row */
.options-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  align-items: center;
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

/* Mode selector */
.mode-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.mode-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.mode-buttons {
  display: flex;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  overflow: hidden;
}

.mode-btn {
  padding: 0.375rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--color-background);
  border: none;
  border-right: 1px solid var(--color-border);
  color: var(--color-text-soft);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.mode-btn:last-child {
  border-right: none;
}

.mode-btn:hover {
  background: var(--color-bg-hover);
}

.mode-btn.active {
  background: var(--color-primary);
  color: white;
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
    margin-bottom: 1rem;
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
