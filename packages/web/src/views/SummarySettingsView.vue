<template>
  <div
    v-if="settingsStore.loading"
    class="loading-state"
  >
    <span class="loading-spinner" />
    Loading...
  </div>

  <form
    v-else
    class="form card"
    @submit.prevent="handleSave"
  >
    <div class="form-group">
      <label class="checkbox-label">
        <input
          v-model="disableSessionSummaries"
          type="checkbox"
        >
        Disable session summaries
      </label>
      <p class="form-help">
        When enabled, automatic session summaries will not be generated. Session summaries provide an overview of what was accomplished.
      </p>
    </div>

    <div class="form-group">
      <label
        class="form-label"
        for="model-select"
      >Summary Model</label>
      <ModelSelector
        v-model="summaryModel"
        :provider-id="summaryProviderId"
        allow-empty
        empty-label="Use default summary model"
        select-class="form-input"
        @model-selected="handleModelSelected"
      />
      <p class="form-help">
        Choose the model used when summaries are generated.
      </p>
    </div>

    <div class="form-group">
      <label
        class="form-label"
        for="sessionTitlePrompt"
      >Custom Session Title Prompt</label>
      <ResizableTextarea
        id="sessionTitlePrompt"
        v-model="sessionTitlePrompt"
        class="form-input form-textarea-small"
        :min-height="120"
        :max-height="400"
      />
      <p class="form-help">
        Customize how session titles are generated.
      </p>
    </div>

    <div
      v-if="error"
      class="error-message"
    >
      {{ error }}
    </div>

    <div class="form-actions">
      <button
        type="submit"
        class="btn btn-primary"
        :disabled="saving"
      >
        <span
          v-if="saving"
          class="loading-spinner"
        />
        {{ saving ? 'Saving...' : 'Save Settings' }}
      </button>
      <button
        type="button"
        class="btn btn-secondary"
        :disabled="saving"
        @click="handleReset"
      >
        Reset to Defaults
      </button>
    </div>
  </form>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { useSettingsStore } from '../stores/settings.js';
import { useUiStore } from '../stores/ui.js';
import ResizableTextarea from '../components/ResizableTextarea.vue';
import ModelSelector from '../components/ModelSelector.vue';

const settingsStore = useSettingsStore();
const uiStore = useUiStore();

const disableSessionSummaries = ref(false);
const sessionTitlePrompt = ref('');
const summaryModel = ref('');
const summaryProviderId = ref(null);
const saving = ref(false);
const error = ref(null);

onMounted(() => {
  settingsStore.fetchSummarySettings();
});

// Watch for changes to the store and update local refs
watch(() => settingsStore.summarySettings, (settings) => {
  if (settings) {
    disableSessionSummaries.value = settings.disableSessionSummaries;
    summaryModel.value = settings.summaryModel || '';
    summaryProviderId.value = settings.summaryProviderId || null;
    // Use saved prompt, or fall back to default for editing
    sessionTitlePrompt.value = settings.sessionTitlePrompt || settings.defaultSessionTitlePrompt || '';
  }
}, { immediate: true });

function handleModelSelected(selection) {
  summaryModel.value = selection.modelId || '';
  summaryProviderId.value = selection.providerId || null;
}

async function handleSave() {
  saving.value = true;
  error.value = null;

  try {
    await settingsStore.updateSummarySettings({
      disableSessionSummaries: disableSessionSummaries.value,
      sessionTitlePrompt: sessionTitlePrompt.value,
      summaryModel: summaryModel.value || '',
      summaryProviderId: summaryModel.value ? summaryProviderId.value : null,
    });
    uiStore.success('Summary settings saved successfully');
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function handleReset() {
  if (!confirm('Reset all summary settings to defaults?')) return;

  saving.value = true;
  error.value = null;

  try {
    await settingsStore.resetSummarySettings();
    uiStore.success('Summary settings reset to defaults');
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 3rem;
}

.form {
  max-width: 600px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.error-message {
  color: var(--color-error);
  margin-bottom: 1rem;
}

.form-textarea-small {
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
</style>
