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
          Link to the project's repository (e.g., GitHub, GitLab). This can be automatically populated from session summaries.
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
        <summary>Session Lifecycle Hooks</summary>
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

      <details class="advanced-settings">
        <summary>Session Defaults</summary>
        <p class="form-help">
          Set default values for new sessions created in this project. These values can be overridden when creating individual sessions.
        </p>

        <div class="form-group">
          <label
            class="form-label"
            for="defaultMode"
          >Mode</label>
          <select
            id="defaultMode"
            v-model="defaultMode"
            class="form-input"
          >
            <option value="">
              Use system default (standard)
            </option>
            <option value="plan">
              Plan
            </option>
            <option value="standard">
              Standard
            </option>
            <option value="yolo">
              YOLO
            </option>
          </select>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input
              v-model="defaultThinkingEnabled"
              type="checkbox"
            >
            Enable thinking (extended thinking) by default
          </label>
          <p class="form-help">
            Enable Claude's extended thinking capability for new sessions.
          </p>
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="defaultEffortLevel"
          >Default Effort Level</label>
          <select
            id="defaultEffortLevel"
            v-model="defaultEffortLevel"
            class="form-input"
          >
            <option value="">
              Auto (default)
            </option>
            <option value="low">
              Low
            </option>
            <option value="medium">
              Medium
            </option>
            <option value="high">
              High
            </option>
            <option value="max">
              Max
            </option>
          </select>
          <p class="form-help">
            Set the default effort level for new sessions. Controls how much effort Claude puts into responses.
          </p>
        </div>

        <div class="form-group">
          <label class="checkbox-label">
            <input
              v-model="defaultStartImmediately"
              type="checkbox"
            >
            Start sessions immediately
          </label>
          <p class="form-help">
            When enabled, sessions will start automatically. When disabled, sessions will be created in "waiting" state.
          </p>
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="defaultGitMode"
          >Git Mode</label>
          <select
            id="defaultGitMode"
            v-model="defaultGitMode"
            class="form-input"
          >
            <option value="">
              No git isolation
            </option>
            <option value="branch">
              Create branch for each session
            </option>
            <option value="worktree">
              Create worktree for each session
            </option>
          </select>
          <p class="form-help">
            Controls how git changes are isolated for each session.
          </p>
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="defaultGitBranch"
          >Default Git Branch</label>
          <input
            id="defaultGitBranch"
            v-model="defaultGitBranch"
            type="text"
            class="form-input"
            placeholder="e.g., feature/ai-implementation"
          >
          <p class="form-help">
            When using git branch mode, this is the branch name pattern for new sessions.
          </p>
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="defaultModel"
          >Model</label>
          <ModelSelector
            v-model="defaultModel"
            :allow-empty="true"
            empty-label="Use system default"
            select-class="form-input"
          />
          <p class="form-help">
            Choose the default Claude model for new sessions in this project.
          </p>
        </div>

        <button
          type="button"
          class="btn btn-secondary"
          :disabled="savingDefaults"
          @click="handleResetDefaults"
        >
          <span
            v-if="savingDefaults"
            class="loading-spinner"
          />
          Reset to System Defaults
        </button>
      </details>

      <details class="advanced-settings">
        <summary>Quick Responses</summary>
        <p class="form-help">
          Quick responses are shortcuts that can be inserted into the chat input. You can create project-specific or global responses.
        </p>
        <button
          type="button"
          class="btn btn-secondary"
          @click="quickResponseSettingsOpen = true"
        >
          Manage Quick Responses
        </button>
      </details>

      <details class="advanced-settings">
        <summary>Kanban Board</summary>
        <div class="form-group">
          <label class="checkbox-label">
            <input
              v-model="kanbanEnabled"
              type="checkbox"
            >
            Enable Kanban board
          </label>
          <p class="form-help">
            Enable a Kanban board to visually organize sessions into lanes. Sessions can be dragged between lanes, and lanes can trigger automated workflows.
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

    <!-- Quick Response Settings Modal -->
    <QuickResponseSettings
      :is-open="quickResponseSettingsOpen"
      :project-id="route.params.id"
      @close="quickResponseSettingsOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProjectsStore } from '../stores/projects.js';
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';
import { useQuickResponsesStore } from '../stores/quickResponses.js';
import { useUiStore } from '../stores/ui.js';
import PathChooser from '../components/PathChooser.vue';
import QuickResponseSettings from '../components/QuickResponseSettings.vue';
import ModelSelector from '../components/ModelSelector.vue';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_SESSION_TITLE_PROMPT } from '@claudetools/shared/constants';

const defaultSystemPrompt = DEFAULT_SYSTEM_PROMPT;
const defaultSessionTitlePrompt = DEFAULT_SESSION_TITLE_PROMPT;

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();
const defaultsStore = useProjectDefaultsStore();
const quickResponsesStore = useQuickResponsesStore();
const uiStore = useUiStore();

const name = ref('');
const workingDirectory = ref('');
const repoUrl = ref('');
const systemPrompt = ref('');
const onSessionCreated = ref('');
const onSessionDeleted = ref('');
const kanbanEnabled = ref(false);

// Session defaults refs
const defaultMode = ref('');
const defaultThinkingEnabled = ref(false);
const defaultEffortLevel = ref('');
const defaultStartImmediately = ref(true);
const defaultGitMode = ref('');
const defaultGitBranch = ref('');
const defaultModel = ref('');

const saving = ref(false);
const savingDefaults = ref(false);
const error = ref(null);
const quickResponseSettingsOpen = ref(false);

onMounted(() => {
  projectsStore.fetchProject(route.params.id);
  defaultsStore.fetchDefaults(route.params.id);
  quickResponsesStore.fetchForProject(route.params.id);
});

watch(() => projectsStore.currentProject, (project) => {
  if (project) {
    name.value = project.name;
    workingDirectory.value = project.workingDirectory;
    repoUrl.value = project.repoUrl || '';
    systemPrompt.value = project.systemPrompt || defaultSystemPrompt;
    onSessionCreated.value = project.onSessionCreated || '';
    onSessionDeleted.value = project.onSessionDeleted || '';
    kanbanEnabled.value = project.kanbanEnabled || false;
  }
}, { immediate: true });

watch(() => defaultsStore.getDefaultsForProject(route.params.id), (defaults) => {
  if (defaults) {
    defaultMode.value = defaults.mode || '';
    defaultThinkingEnabled.value = defaults.thinkingEnabled || false;
    defaultEffortLevel.value = defaults.effortLevel ?? '';
    defaultStartImmediately.value = defaults.startImmediately !== false;
    defaultGitMode.value = defaults.gitMode || '';
    defaultGitBranch.value = defaults.gitBranch || '';
    defaultModel.value = defaults.model || '';
  }
}, { immediate: true });

function collectNonDefaultValues() {
  const data = {};
  if (defaultMode.value) data.mode = defaultMode.value;
  if (defaultThinkingEnabled.value) data.thinkingEnabled = true;
  if (defaultEffortLevel.value) data.effortLevel = defaultEffortLevel.value;
  if (!defaultStartImmediately.value) data.startImmediately = false;
  if (defaultGitMode.value) data.gitMode = defaultGitMode.value;
  if (defaultGitBranch.value) data.gitBranch = defaultGitBranch.value;
  if (defaultModel.value) data.model = defaultModel.value;
  return data;
}

async function handleSubmit() {
  saving.value = true;
  error.value = null;

  try {
    // Update project
    // Save null if value equals default (to avoid storing redundant data)
    await projectsStore.updateProject(route.params.id, {
      name: name.value,
      workingDirectory: workingDirectory.value,
      repoUrl: repoUrl.value || null,
      systemPrompt: systemPrompt.value === defaultSystemPrompt ? null : systemPrompt.value,
      onSessionCreated: onSessionCreated.value || null,
      onSessionDeleted: onSessionDeleted.value || null,
      kanbanEnabled: kanbanEnabled.value,
    });

    // Update defaults - collect non-default values
    const defaultsData = collectNonDefaultValues();

    if (Object.keys(defaultsData).length > 0) {
      await defaultsStore.updateDefaults(route.params.id, defaultsData);
    }

    uiStore.success('Project updated successfully');
    router.push(`/projects/${route.params.id}/sessions`);
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function handleResetDefaults() {
  if (!confirm('Reset all session defaults to system defaults?')) return;

  savingDefaults.value = true;
  error.value = null;

  try {
    await defaultsStore.resetDefaults(route.params.id);
    defaultMode.value = '';
    defaultThinkingEnabled.value = false;
    defaultEffortLevel.value = '';
    defaultStartImmediately.value = true;
    defaultGitMode.value = '';
    defaultGitBranch.value = '';
    defaultModel.value = '';
    uiStore.success('Session defaults reset to system defaults');
  } catch (err) {
    error.value = err.message;
  } finally {
    savingDefaults.value = false;
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
