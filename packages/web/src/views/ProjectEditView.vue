<template>
  <div class="container">
    <h1>Edit Project</h1>

    <div v-if="projectsStore.loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading...
    </div>

    <form v-else-if="projectsStore.currentProject" @submit.prevent="handleSubmit" class="form card">
      <div class="form-group">
        <label class="form-label" for="name">Project Name</label>
        <input
          id="name"
          v-model="name"
          type="text"
          class="form-input"
          required
        />
      </div>

      <div class="form-group">
        <label class="form-label" for="workingDirectory">Working Directory</label>
        <PathChooser v-model="workingDirectory" />
      </div>

      <div class="form-group">
        <label class="form-label" for="systemPrompt">System Prompt</label>
        <textarea
          id="systemPrompt"
          v-model="systemPrompt"
          class="form-input form-textarea"
          rows="8"
          :placeholder="defaultSystemPrompt"
        ></textarea>
        <p class="form-help">
          Customize the system prompt for the AI agent. Leave empty to use the default prompt shown above.
        </p>
      </div>

      <details class="advanced-settings">
        <summary>Session Lifecycle Hooks</summary>
        <div class="form-group">
          <label class="form-label" for="onSessionCreated">On Session Created</label>
          <textarea
            id="onSessionCreated"
            v-model="onSessionCreated"
            class="form-input form-textarea-small"
            rows="3"
            placeholder="Shell command to run when a session is created..."
          ></textarea>
          <p class="form-help">
            Runs in the background after session creation. Environment variables: CLAUDETOOLS_SESSION_ID, CLAUDETOOLS_PROJECT_ID, CLAUDETOOLS_SESSION_NAME
          </p>
        </div>

        <div class="form-group">
          <label class="form-label" for="onSessionDeleted">On Session Deleted</label>
          <textarea
            id="onSessionDeleted"
            v-model="onSessionDeleted"
            class="form-input form-textarea-small"
            rows="3"
            placeholder="Shell command to run when a session is deleted..."
          ></textarea>
          <p class="form-help">
            Runs in the background after session deletion. Environment variables: CLAUDETOOLS_SESSION_ID, CLAUDETOOLS_PROJECT_ID, CLAUDETOOLS_SESSION_NAME
          </p>
        </div>
      </details>

      <div v-if="error" class="error-message">{{ error }}</div>

      <div class="form-actions">
        <button type="button" class="btn btn-danger" @click="handleDelete">Delete</button>
        <div class="form-actions-right">
          <router-link :to="`/projects/${route.params.id}/sessions`" class="btn">Cancel</router-link>
          <button type="submit" class="btn btn-primary" :disabled="saving">
            <span v-if="saving" class="loading-spinner"></span>
            Save
          </button>
        </div>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjectsStore } from '../stores/projects.js';
import { useUiStore } from '../stores/ui.js';
import PathChooser from '../components/PathChooser.vue';
import { DEFAULT_SYSTEM_PROMPT as defaultSystemPrompt } from '@claudetools/shared/constants';

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();
const uiStore = useUiStore();

const name = ref('');
const workingDirectory = ref('');
const systemPrompt = ref('');
const onSessionCreated = ref('');
const onSessionDeleted = ref('');
const saving = ref(false);
const error = ref(null);

onMounted(() => {
  projectsStore.fetchProject(route.params.id);
});

watch(() => projectsStore.currentProject, (project) => {
  if (project) {
    name.value = project.name;
    workingDirectory.value = project.workingDirectory;
    systemPrompt.value = project.systemPrompt || '';
    onSessionCreated.value = project.onSessionCreated || '';
    onSessionDeleted.value = project.onSessionDeleted || '';
  }
}, { immediate: true });

async function handleSubmit() {
  saving.value = true;
  error.value = null;

  try {
    await projectsStore.updateProject(route.params.id, {
      name: name.value,
      workingDirectory: workingDirectory.value,
      systemPrompt: systemPrompt.value || null,
      onSessionCreated: onSessionCreated.value || null,
      onSessionDeleted: onSessionDeleted.value || null,
    });
    uiStore.success('Project updated successfully');
    router.push(`/projects/${route.params.id}/sessions`);
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function handleDelete() {
  if (!confirm('Are you sure you want to delete this project?')) return;

  try {
    await projectsStore.deleteProject(route.params.id);
    uiStore.success('Project deleted successfully');
    router.push('/');
  } catch (err) {
    error.value = err.message;
  }
}
</script>

<style scoped>
h1 {
  margin-bottom: 2rem;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 3rem;
}

.form {
  max-width: 500px;
}

.form-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.form-actions-right {
  display: flex;
  gap: 0.5rem;
}

.error-message {
  color: var(--color-error);
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

.form-textarea-small {
  resize: vertical;
  min-height: 60px;
  font-family: monospace;
  font-size: 0.875rem;
  line-height: 1.5;
}
</style>
