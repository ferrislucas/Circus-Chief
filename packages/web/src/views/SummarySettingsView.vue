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
        Disable workspace summaries
      </label>
      <p class="form-help">
        When enabled, automatic workspace summaries will not be generated. Workspace summaries provide an overview of what was accomplished.
      </p>
    </div>

    <div class="form-group">
      <label
        class="form-label"
        for="model-select"
      >Summary Model</label>
      <ModelSelector
        v-model="summaryModel"
        v-model:provider-id="summaryProviderId"
        allow-empty
        empty-label="Use default summary model"
        :hide-built-in-duplicates="false"
        select-class="form-input"
        @model-selected="handleModelSelected"
      />
      <p class="form-help">
        Choose the model used when summaries are generated.
      </p>
      <SelectionConflictBanner
        :visible="selectionGuard.showBanner"
        :problem="selectionGuard.problem"
        conflict-text="These settings changed elsewhere while you were editing. Your edits are preserved."
        @use-canonical="useCanonicalModelSelection"
        @keep-mine="selectionGuard.keepMine"
      />
    </div>

    <div class="form-group">
      <label
        class="form-label"
        for="sessionTitlePrompt"
      >Custom Workspace Title Prompt</label>
      <ResizableTextarea
        id="sessionTitlePrompt"
        v-model="sessionTitlePrompt"
        class="form-input form-textarea-small"
        :min-height="120"
        :max-height="400"
      />
      <p class="form-help">
        Customize how workspace titles are generated.
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
        :disabled="saving || selectionGuard.invalid"
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
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { useSettingsStore } from '../stores/settings.js';
import { useUiStore } from '../stores/ui.js';
import ResizableTextarea from '../components/ResizableTextarea.vue';
import ModelSelector from '../components/ModelSelector.vue';
import SelectionConflictBanner from '../components/SelectionConflictBanner.vue';
import { api } from '../composables/useApi.js';
import { useCanonicalSync } from '../composables/useCanonicalSync.js';
import { reconcileFormFields, reconcileModelSelection } from '../composables/modelSelectionReconciliation.js';
import { normalizeModelProviderPair } from '../components/modelSelectorTiers.js';
import { useSelectionGuard } from '../composables/useSelectionGuard.js';

const settingsStore = useSettingsStore();
const uiStore = useUiStore();

const disableSessionSummaries = ref(false);
const sessionTitlePrompt = ref('');
const summaryModel = ref('');
const summaryProviderId = ref(null);
const saving = ref(false);
const error = ref(null);
const modelSelectionConflict = ref(false);
let lastCanonicalSelection = { model: null, providerId: null };
let lastCanonicalFields = null;

// One monotonic coordinator for initial load, websocket invalidation, and
// reconnect: a slow initial response can never overwrite a newer push.
const { refresh: refreshSettings } = useCanonicalSync({
  fetchCanonical: () => api.getSummarySettings(),
  applyCanonical: (settings) => { settingsStore.summarySettings = settings; },
  messageType: WS_MESSAGE_TYPES.SUMMARY_SETTINGS_UPDATED,
  selectPush: (message) => (message?.settings ? { notify: message.settings } : undefined),
});

// Shared conflict contract (see useSelectionGuard): an invalid selection
// blocks save until the user picks a current value or clears it.
const selectionGuard = useSelectionGuard(
  () => ({ model: summaryModel.value, providerId: summaryProviderId.value }),
  () => modelSelectionConflict.value,
  () => { modelSelectionConflict.value = false; }
);

onMounted(() => {
  refreshSettings();
});

// Canonical record projected onto the form shape (same normalization the
// first application uses, so later intakes compare apples to apples).
function toNonModelForm(settings) {
  return {
    disableSessionSummaries: settings.disableSessionSummaries,
    sessionTitlePrompt: settings.sessionTitlePrompt || settings.defaultSessionTitlePrompt || '',
  };
}

function applyNonModelForm(values) {
  disableSessionSummaries.value = values.disableSessionSummaries ?? false;
  sessionTitlePrompt.value = values.sessionTitlePrompt ?? '';
}

// Watch for changes to the store and update local refs
watch(() => settingsStore.summarySettings, (settings) => {
  if (settings) {
    // Per-field convergence (no first-load latch): untouched fields adopt the
    // new canonical values so external changes surface; fields the user
    // edited are kept, flagging a conflict only when upstream moved them
    // too. Snapshots always advance to the latest canonical.
    const fields = reconcileFormFields({
      current: {
        disableSessionSummaries: disableSessionSummaries.value,
        sessionTitlePrompt: sessionTitlePrompt.value,
      },
      previousCanonical: lastCanonicalFields,
      canonical: toNonModelForm(settings),
    });
    applyNonModelForm(fields.values);
    lastCanonicalFields = toNonModelForm(settings);
    const selection = reconcileModelSelection({
      current: { model: summaryModel.value, providerId: summaryProviderId.value },
      previousCanonical: lastCanonicalSelection,
      canonical: { model: settings.summaryModel || '', providerId: settings.summaryProviderId || null },
    });
    summaryModel.value = selection.model || '';
    summaryProviderId.value = selection.providerId;
    modelSelectionConflict.value = selection.conflict || fields.conflict;
    lastCanonicalSelection = { model: settings.summaryModel || '', providerId: settings.summaryProviderId || null };
  }
}, { immediate: true });

function handleModelSelected(selection) {
  summaryModel.value = selection.modelId || '';
  summaryProviderId.value = selection.providerId || null;
}

function useCanonicalModelSelection() {
  summaryModel.value = lastCanonicalSelection.model || '';
  summaryProviderId.value = lastCanonicalSelection.providerId;
  if (lastCanonicalFields) applyNonModelForm(lastCanonicalFields);
  modelSelectionConflict.value = false;
}

async function handleSave() {
  error.value = null;
  if (selectionGuard.invalid) {
    error.value = selectionGuard.problem?.message || 'The summary model selection is no longer available.';
    return;
  }
  saving.value = true;

  try {
    // A tier-bound summary model never persists a concrete provider hint.
    const pair = normalizeModelProviderPair(summaryModel.value || '', summaryProviderId.value);
    await settingsStore.updateSummarySettings({
      disableSessionSummaries: disableSessionSummaries.value,
      sessionTitlePrompt: sessionTitlePrompt.value,
      summaryModel: pair.model || '',
      summaryProviderId: pair.model ? pair.providerId : null,
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
