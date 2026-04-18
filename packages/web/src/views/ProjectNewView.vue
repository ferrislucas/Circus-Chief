<template>
  <div class="container">
    <h1>Add a Repository</h1>

    <form
      class="form card"
      @submit.prevent="handleSubmit"
    >
      <div class="form-group">
        <label
          class="form-label"
          for="workingDirectory"
        >Repository Folder</label>
        <PathChooser v-model="workingDirectory" />
        <p class="form-help">
          The root of your codebase — typically a git repository.
        </p>
      </div>

      <div class="form-group">
        <label
          class="form-label"
          for="name"
        >Display Name</label>
        <input
          id="name"
          v-model="name"
          type="text"
          class="form-input"
          placeholder="my-app"
          required
          @input="onNameInput"
        >
      </div>

      <details class="advanced-settings">
        <summary>Advanced Settings</summary>
        <div class="form-group">
          <label
            class="form-label"
            for="worktreePath"
          >Worktree Path</label>
          <div class="input-with-button">
            <input
              id="worktreePath"
              v-model="worktreePath"
              type="text"
              class="form-input"
              placeholder="/path/to/.worktrees"
              @input="onWorktreePathInput"
            >
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="!workingDirectory || detectingWorktreePath"
              @click="detectWorktreePath"
            >
              Detect
            </button>
          </div>
          <p class="form-help">
            Directory where git worktrees will be created for sessions. Leave empty to use the default.
          </p>
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="systemPrompt"
          >
            System Prompt
            <button
              v-if="systemPrompt !== defaultSystemPrompt"
              type="button"
              class="btn-link"
              @click="systemPrompt = defaultSystemPrompt"
            >
              Reset to Default
            </button>
          </label>
          <textarea
            id="systemPrompt"
            v-model="systemPrompt"
            class="form-input form-textarea"
            rows="8"
          />
          <p class="form-help">
            Customize the system prompt for the AI agent. The default prompt is pre-filled above.
          </p>
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="onSessionCreated"
          >On Session Created</label>
          <textarea
            id="onSessionCreated"
            v-model="onSessionCreated"
            class="form-input form-textarea-small"
            rows="3"
            placeholder="Shell command to run when a session is created..."
          />
          <p class="form-help">
            Runs in the background after session creation. Environment variables: CIRCUSCHIEF_SESSION_ID, CIRCUSCHIEF_PROJECT_ID, CIRCUSCHIEF_SESSION_NAME
          </p>
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="onSessionDeleted"
          >On Session Deleted</label>
          <textarea
            id="onSessionDeleted"
            v-model="onSessionDeleted"
            class="form-input form-textarea-small"
            rows="3"
            placeholder="Shell command to run when a session is deleted..."
          />
          <p class="form-help">
            Runs in the background after session deletion. Environment variables: CIRCUSCHIEF_SESSION_ID, CIRCUSCHIEF_PROJECT_ID, CIRCUSCHIEF_SESSION_NAME
          </p>
        </div>
      </details>

      <div
        v-if="error"
        class="error-message"
      >
        {{ error }}
      </div>

      <div class="form-actions">
        <router-link
          to="/"
          class="btn"
        >
          Cancel
        </router-link>
        <button
          type="submit"
          class="btn btn-primary"
          :disabled="loading"
        >
          <span
            v-if="loading"
            class="loading-spinner"
          />
          Add Repository
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectsStore } from '../stores/projects.js';
import { useUiStore } from '../stores/ui.js';
import PathChooser from '../components/PathChooser.vue';
import { DEFAULT_SYSTEM_PROMPT } from '@circuschief/shared/constants';
import { api } from '../api/index.js';

const router = useRouter();
const projectsStore = useProjectsStore();
const uiStore = useUiStore();

const defaultSystemPrompt = DEFAULT_SYSTEM_PROMPT;

const name = ref('');
const workingDirectory = ref('');
const worktreePath = ref('');
const systemPrompt = ref(DEFAULT_SYSTEM_PROMPT);
const onSessionCreated = ref('');
const onSessionDeleted = ref('');
const loading = ref(false);
const error = ref(null);
const detectingWorktreePath = ref(false);

// Track whether name was auto-filled (vs manually typed)
const nameAutoFilled = ref(true);
// Track whether worktree path was auto-filled (vs manually typed)
const worktreePathAutoFilled = ref(true);

watch(workingDirectory, (newPath) => {
  if (newPath && nameAutoFilled.value) {
    const segments = newPath.replace(/\/+$/, '').split('/');
    name.value = segments[segments.length - 1] || '';
  }
  // Auto-detect worktree path when working directory changes (only if not manually edited)
  if (newPath && worktreePathAutoFilled.value) {
    detectWorktreePath();
  }
});

// When user manually edits name, stop auto-filling
function onNameInput() {
  nameAutoFilled.value = false;
}

// When user manually edits worktree path, stop auto-filling
function onWorktreePathInput() {
  worktreePathAutoFilled.value = false;
}

async function detectWorktreePath() {
  if (!workingDirectory.value) return;
  detectingWorktreePath.value = true;
  try {
    const result = await api.detectWorktreePath(workingDirectory.value);
    worktreePath.value = result.worktreePath;
    worktreePathAutoFilled.value = true;
  } catch {
    // Silently fail — user can manually enter the path
  } finally {
    detectingWorktreePath.value = false;
  }
}

// Expose for testing
defineExpose({ name, workingDirectory, worktreePath, onNameInput, onWorktreePathInput });

async function handleSubmit() {
  loading.value = true;
  error.value = null;

  try {
    // Save null if value equals default (to avoid storing redundant data)
    const project = await projectsStore.createProject({
      name: name.value,
      workingDirectory: workingDirectory.value,
      systemPrompt: systemPrompt.value === defaultSystemPrompt ? null : systemPrompt.value,
      onSessionCreated: onSessionCreated.value || undefined,
      onSessionDeleted: onSessionDeleted.value || undefined,
      worktreePath: worktreePath.value || null,
    });
    uiStore.success('Repository added');
    router.push(`/projects/${project.id}/sessions`);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
h1 {
  margin-bottom: 2rem;
}

.form {
  max-width: 500px;
}

.form-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.error-message {
  color: var(--color-error);
  margin-bottom: 1rem;
}

.advanced-settings {
  margin-bottom: 1rem;
}

.advanced-settings summary {
  cursor: pointer;
  color: var(--color-primary);
  font-weight: 500;
  margin-bottom: 1rem;
}

.advanced-settings[open] summary {
  margin-bottom: 1rem;
}

.form-textarea {
  resize: vertical;
  min-height: 120px;
  font-family: monospace;
  font-size: 0.875rem;
  line-height: 1.5;
}

.input-with-button {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}

.input-with-button .form-input {
  flex: 1;
}

.input-with-button .btn {
  flex-shrink: 0;
}

.form-help {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-muted);
}

.form-textarea-small {
  resize: vertical;
  min-height: 60px;
  font-family: monospace;
  font-size: 0.875rem;
  line-height: 1.5;
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.75rem;
  padding: 0;
  margin-left: 0.5rem;
  cursor: pointer;
  text-decoration: underline;
}

.btn-link:hover {
  color: var(--color-primary-hover);
}

@media (max-width: 480px) {
  .form {
    max-width: none;
  }

  .form-actions {
    flex-direction: column-reverse;
  }

  .form-actions .btn {
    width: 100%;
    justify-content: center;
    min-height: 44px;
  }
}
</style>
