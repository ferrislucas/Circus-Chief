<template>
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
        Enable the agent's extended thinking capability for new sessions.
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
        Set the default effort level for new sessions. Controls how much effort the agent puts into responses.
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
        v-model:provider-id="defaultProviderId"
        :allow-empty="true"
        empty-label="Use system default"
        select-class="form-input"
      />
      <p class="form-help">
        Choose the default model for new sessions in this project.
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
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';
import { useUiStore } from '../stores/ui.js';
import ModelSelector from './ModelSelector.vue';

const props = defineProps({
  projectId: { type: String, required: true },
});

const defaultsStore = useProjectDefaultsStore();
const uiStore = useUiStore();

const defaultMode = ref('');
const defaultThinkingEnabled = ref(false);
const defaultEffortLevel = ref('');
const defaultStartImmediately = ref(true);
const defaultGitMode = ref('');
const defaultGitBranch = ref('');
const defaultModel = ref('');
const defaultProviderId = ref(null);
const savingDefaults = ref(false);

onMounted(() => {
  defaultsStore.fetchDefaults(props.projectId);
});

watch(() => defaultsStore.getDefaultsForProject(props.projectId), (defaults) => {
  if (defaults) {
    defaultMode.value = defaults.mode || '';
    defaultThinkingEnabled.value = defaults.thinkingEnabled || false;
    defaultEffortLevel.value = defaults.effortLevel ?? '';
    defaultStartImmediately.value = defaults.startImmediately !== false;
    defaultGitMode.value = defaults.gitMode || '';
    defaultGitBranch.value = defaults.gitBranch || '';
    defaultModel.value = defaults.model || '';
    defaultProviderId.value = defaults.providerId || null;
  }
}, { immediate: true });

function collectNonDefaultValues() {
  return {
    mode: defaultMode.value || null,
    thinkingEnabled: defaultThinkingEnabled.value,
    effortLevel: defaultEffortLevel.value || null,
    startImmediately: defaultStartImmediately.value,
    gitMode: defaultGitMode.value || null,
    gitBranch: defaultGitBranch.value || null,
    model: defaultModel.value || null,
    providerId: defaultModel.value ? (defaultProviderId.value || null) : null,
  };
}

async function handleResetDefaults() {
  if (!confirm('Reset all session defaults to system defaults?')) return;

  savingDefaults.value = true;

  try {
    await defaultsStore.resetDefaults(props.projectId);
    defaultMode.value = '';
    defaultThinkingEnabled.value = false;
    defaultEffortLevel.value = '';
    defaultStartImmediately.value = true;
    defaultGitMode.value = '';
    defaultGitBranch.value = '';
    defaultModel.value = '';
    defaultProviderId.value = null;
    uiStore.success('Session defaults reset to system defaults');
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    savingDefaults.value = false;
  }
}

defineExpose({ collectNonDefaultValues });
</script>

<style scoped>
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

.form-help {
  margin-top: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-muted);
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
</style>
