<template>
  <div class="container">
    <h1>New Project</h1>

    <form
      class="form card"
      @submit.prevent="handleSubmit"
    >
      <div class="form-group">
        <label
          class="form-label"
          for="name"
        >Project Name</label>
        <input
          id="name"
          v-model="name"
          type="text"
          class="form-input"
          placeholder="My Project"
          required
        >
      </div>

      <div class="form-group">
        <label
          class="form-label"
          for="workingDirectory"
        >Working Directory</label>
        <PathChooser v-model="workingDirectory" />
      </div>

      <details class="advanced-settings">
        <summary>Advanced Settings</summary>
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
            Runs in the background after session creation. Environment variables: CLAUDETOOLS_SESSION_ID, CLAUDETOOLS_PROJECT_ID, CLAUDETOOLS_SESSION_NAME
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
            Runs in the background after session deletion. Environment variables: CLAUDETOOLS_SESSION_ID, CLAUDETOOLS_PROJECT_ID, CLAUDETOOLS_SESSION_NAME
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
          Create Project
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectsStore } from '../stores/projects.js';
import { useUiStore } from '../stores/ui.js';
import PathChooser from '../components/PathChooser.vue';
import { DEFAULT_SYSTEM_PROMPT } from '@claudetools/shared/constants';

const router = useRouter();
const projectsStore = useProjectsStore();
const uiStore = useUiStore();

const defaultSystemPrompt = DEFAULT_SYSTEM_PROMPT;

const name = ref('');
const workingDirectory = ref('');
const systemPrompt = ref(DEFAULT_SYSTEM_PROMPT);
const onSessionCreated = ref('');
const onSessionDeleted = ref('');
const loading = ref(false);
const error = ref(null);

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
    });
    uiStore.success('Project created successfully');
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
</style>
