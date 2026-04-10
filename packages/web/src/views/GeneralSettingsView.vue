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
          v-model="disableAnalytics"
          type="checkbox"
        >
        Disable analytics tracking
      </label>
      <p class="form-help">
        When checked, no usage analytics will be collected. Changes take effect on next page load.
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
    </div>
  </form>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { useSettingsStore } from '../stores/settings.js';
import { useUiStore } from '../stores/ui.js';

const settingsStore = useSettingsStore();
const uiStore = useUiStore();

const disableAnalytics = ref(false);
const saving = ref(false);
const error = ref(null);

onMounted(() => {
  settingsStore.fetchGeneralSettings();
});

// Watch for changes to the store and update local refs
watch(() => settingsStore.generalSettings, (settings) => {
  if (settings) {
    disableAnalytics.value = settings.disableAnalytics;
  }
}, { immediate: true });

async function handleSave() {
  saving.value = true;
  error.value = null;

  try {
    await settingsStore.updateGeneralSettings({
      disableAnalytics: disableAnalytics.value,
    });
    uiStore.success('General settings saved successfully');
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
