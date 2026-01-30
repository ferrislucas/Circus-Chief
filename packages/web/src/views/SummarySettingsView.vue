<template>
  <div v-if="settingsStore.loading" class="loading-state">
    <span class="loading-spinner"></span>
    Loading...
  </div>

  <form v-else @submit.prevent="handleSave" class="form card">
    <div class="form-group">
      <label class="checkbox-label">
        <input
          type="checkbox"
          v-model="disableSessionSummaries"
        />
        Disable session summaries
      </label>
      <p class="form-help">
        When enabled, automatic session summaries will not be generated. Session summaries provide an overview of what was accomplished.
      </p>
    </div>

    <div class="form-group">
      <label class="checkbox-label">
        <input
          type="checkbox"
          v-model="disableConversationSummaries"
        />
        Disable conversation summaries
      </label>
      <p class="form-help">
        When enabled, automatic conversation summaries will not be generated when switching between conversations.
      </p>
    </div>

    <div class="form-group">
      <label class="form-label" for="sessionTitlePrompt">Custom Session Title Prompt</label>
      <ResizableTextarea
        id="sessionTitlePrompt"
        v-model="sessionTitlePrompt"
        class="form-input form-textarea-small"
        :min-height="120"
        :max-height="400"
      />
      <p class="form-help">
        Customize how session titles are generated. Edit the prompt above or reset to defaults.
      </p>
    </div>

    <div v-if="error" class="error-message">{{ error }}</div>

    <div class="form-actions">
      <button type="button" class="btn btn-secondary" @click="handleReset" :disabled="saving">
        Reset to Defaults
      </button>
      <button type="submit" class="btn btn-primary" :disabled="saving">
        <span v-if="saving" class="loading-spinner"></span>
        {{ saving ? 'Saving...' : 'Save Settings' }}
      </button>
    </div>
  </form>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '../stores/settings.js';
import { useUiStore } from '../stores/ui.js';
import ResizableTextarea from '../components/ResizableTextarea.vue';

const settingsStore = useSettingsStore();
const uiStore = useUiStore();

const disableSessionSummaries = ref(false);
const disableConversationSummaries = ref(false);
const sessionTitlePrompt = ref('');
const saving = ref(false);
const error = ref(null);

onMounted(() => {
  settingsStore.fetchSummarySettings();
});

// Watch for changes to the store and update local refs
import { watch } from 'vue';
watch(() => settingsStore.summarySettings, (settings) => {
  if (settings) {
    disableSessionSummaries.value = settings.disableSessionSummaries;
    disableConversationSummaries.value = settings.disableConversationSummaries;
    // Use saved prompt, or fall back to default for editing
    sessionTitlePrompt.value = settings.sessionTitlePrompt || settings.defaultSessionTitlePrompt || '';
  }
}, { immediate: true });

async function handleSave() {
  saving.value = true;
  error.value = null;

  try {
    await settingsStore.updateSummarySettings({
      disableSessionSummaries: disableSessionSummaries.value,
      disableConversationSummaries: disableConversationSummaries.value,
      sessionTitlePrompt: sessionTitlePrompt.value,
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
