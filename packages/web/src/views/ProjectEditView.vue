<template>
  <div class="container">
    <h1>Edit Project</h1>

    <div
      v-if="projectsStore.loading"
      class="loading-state"
    >
      <span class="loading-spinner" />
      Loading...
    </div>

    <form
      v-else-if="projectsStore.currentProject"
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
            :placeholder="workingDirectory + '/.worktrees'"
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
          Where git worktrees are created for sessions. Changing this only affects new sessions.
          <br>Effective path: <code>{{ worktreePath || (workingDirectory ? `${workingDirectory}/.worktrees` : '') }}/{sessionId}</code>
        </p>
      </div>

      <div class="form-group">
        <label
          class="form-label"
          for="repoUrl"
        >Repository URL</label>
        <input
          id="repoUrl"
          v-model="repoUrl"
          type="url"
          class="form-input"
          placeholder="https://github.com/username/repo"
        >
        <p class="form-help">
          Link to the project's repository (e.g., GitHub, GitLab). This can be automatically populated from workspace summaries.
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

      <details class="advanced-settings">
        <summary>Workspace Lifecycle Hooks</summary>
        <div class="form-group">
          <label
            class="form-label"
            for="onSessionCreated"
          >On Workspace Created</label>
          <textarea
            id="onSessionCreated"
            v-model="onSessionCreated"
            class="form-input form-textarea-small"
            rows="3"
            placeholder="Shell command to run when a workspace is created..."
          />
          <p class="form-help">
            Runs in the background after workspace creation. Environment variables: CIRCUSCHIEF_SESSION_ID, CIRCUSCHIEF_PROJECT_ID, CIRCUSCHIEF_SESSION_NAME
          </p>
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="onSessionDeleted"
          >On Workspace Deleted</label>
          <textarea
            id="onSessionDeleted"
            v-model="onSessionDeleted"
            class="form-input form-textarea-small"
            rows="3"
            placeholder="Shell command to run when a workspace is deleted..."
          />
          <p class="form-help">
            Runs in the background after workspace deletion. Environment variables: CIRCUSCHIEF_SESSION_ID, CIRCUSCHIEF_PROJECT_ID, CIRCUSCHIEF_SESSION_NAME
          </p>
        </div>
      </details>

      <ProjectSessionDefaults
        ref="sessionDefaultsRef"
        :project-id="route.params.id"
      />

      <div
        v-if="error"
        class="error-message"
      >
        {{ error }}
      </div>

      <div class="form-actions">
        <button
          type="button"
          class="btn btn-danger"
          @click="handleDelete"
        >
          Delete
        </button>
        <div class="form-actions-right">
          <router-link
            :to="`/projects/${route.params.id}/sessions`"
            class="btn"
          >
            Cancel
          </router-link>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="saving"
          >
            <span
              v-if="saving"
              class="loading-spinner"
            />
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
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';
import { useUiStore } from '../stores/ui.js';
import PathChooser from '../components/PathChooser.vue';
import ProjectSessionDefaults from '../components/ProjectSessionDefaults.vue';
import { DEFAULT_SYSTEM_PROMPT } from '@circuschief/shared/constants';
import { api } from '../api/index.js';
import '../components/InputWithButton.css';

const defaultSystemPrompt = DEFAULT_SYSTEM_PROMPT;

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();
const defaultsStore = useProjectDefaultsStore();
const uiStore = useUiStore();

const name = ref('');
const workingDirectory = ref('');
const worktreePath = ref('');
const repoUrl = ref('');
const systemPrompt = ref('');
const onSessionCreated = ref('');
const onSessionDeleted = ref('');
const detectingWorktreePath = ref(false);
const sessionDefaultsRef = ref(null);

const saving = ref(false);
const error = ref(null);

onMounted(() => {
  projectsStore.fetchProject(route.params.id);
});

watch(() => projectsStore.currentProject, (project) => {
  if (project) {
    name.value = project.name;
    workingDirectory.value = project.workingDirectory;
    worktreePath.value = project.worktreePath || '';
    repoUrl.value = project.repoUrl || '';
    systemPrompt.value = project.systemPrompt || defaultSystemPrompt;
    onSessionCreated.value = project.onSessionCreated || '';
    onSessionDeleted.value = project.onSessionDeleted || '';
  }
}, { immediate: true });

async function detectWorktreePath() {
  if (!workingDirectory.value) return;
  detectingWorktreePath.value = true;
  try {
    const result = await api.detectWorktreePath(workingDirectory.value);
    worktreePath.value = result.worktreePath;
  } catch {
    // Silently fail — user can manually enter the path
  } finally {
    detectingWorktreePath.value = false;
  }
}

async function handleSubmit() {
  saving.value = true;
  error.value = null;

  try {
    // Capture child form state before updateProject toggles loading and
    // temporarily unmounts the form via the view-level loading state.
    const defaultsData = sessionDefaultsRef.value?.collectNonDefaultValues();

    // Update project
    // Save null if value equals default (to avoid storing redundant data)
    await projectsStore.updateProject(route.params.id, {
      name: name.value,
      workingDirectory: workingDirectory.value,
      worktreePath: worktreePath.value || null,
      repoUrl: repoUrl.value || null,
      systemPrompt: systemPrompt.value === defaultSystemPrompt ? null : systemPrompt.value,
      onSessionCreated: onSessionCreated.value || null,
      onSessionDeleted: onSessionDeleted.value || null,
    });

    // Update defaults collected from child component
    if (defaultsData && Object.keys(defaultsData).length > 0) {
      await defaultsStore.updateDefaults(route.params.id, defaultsData);
    }

    uiStore.success('Repository updated');
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
    uiStore.success('Repository removed');
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

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-weight: 500;
}

.checkbox-label input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}

.form-input[type="select"],
select.form-input {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23999' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  padding-right: 2.5rem;
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
