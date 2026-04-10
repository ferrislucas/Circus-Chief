<template>
  <div
    v-if="isOpen"
    class="modal-overlay"
    @click.self="close"
  >
    <div class="modal">
      <div class="modal-header">
        <h2>Token Cost Weights</h2>
        <button
          type="button"
          class="close-btn"
          title="Close"
          @click="close"
        >
          ×
        </button>
      </div>

      <div class="modal-body">
        <p class="description">
          Configure how different token types are weighted when calculating the cost score.
          Weights are relative to input tokens (1.0 = same cost as input).
        </p>

        <div class="weights-form">
          <div class="weight-field">
            <label for="input-weight">Input Tokens</label>
            <div class="input-row">
              <input
                id="input-weight"
                v-model.number="localWeights.input"
                type="number"
                step="0.1"
                min="0"
                class="weight-input"
              >
              <span class="hint">(base rate)</span>
            </div>
          </div>

          <div class="weight-field">
            <label for="output-weight">Output Tokens</label>
            <div class="input-row">
              <input
                id="output-weight"
                v-model.number="localWeights.output"
                type="number"
                step="0.1"
                min="0"
                class="weight-input"
              >
              <span class="hint">({{ outputMultiplier }})</span>
            </div>
          </div>

          <div class="weight-field">
            <label for="cache-read-weight">Cache Read Tokens</label>
            <div class="input-row">
              <input
                id="cache-read-weight"
                v-model.number="localWeights.cacheRead"
                type="number"
                step="0.01"
                min="0"
                class="weight-input"
              >
              <span class="hint">({{ cacheReadDiscount }})</span>
            </div>
          </div>

          <div class="weight-field">
            <label for="cache-creation-weight">Cache Creation Tokens</label>
            <div class="input-row">
              <input
                id="cache-creation-weight"
                v-model.number="localWeights.cacheCreation"
                type="number"
                step="0.01"
                min="0"
                class="weight-input"
              >
              <span class="hint">({{ cacheCreationPremium }})</span>
            </div>
          </div>
        </div>

        <div
          v-if="error"
          class="error-message"
        >
          {{ error }}
        </div>
      </div>

      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="saving"
          @click="resetToDefaults"
        >
          Reset to Defaults
        </button>
        <div class="footer-actions">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="saving"
            @click="close"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="saving || !hasChanges"
            @click="save"
          >
            {{ saving ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useSettingsStore } from '../stores/settings.js';
import { useUiStore } from '../stores/ui.js';
import { DEFAULT_TOKEN_COST_WEIGHTS } from '@claudetools/shared';

const props = defineProps({
  isOpen: { type: Boolean, default: false },
});

const emit = defineEmits(['close']);

const settingsStore = useSettingsStore();
const uiStore = useUiStore();

const localWeights = ref({ ...DEFAULT_TOKEN_COST_WEIGHTS });
const saving = ref(false);
const error = ref(null);

// Computed descriptions
const outputMultiplier = computed(() => {
  const mult = localWeights.value.output / (localWeights.value.input || 1);
  return `${mult.toFixed(1)}× input`;
});

const cacheReadDiscount = computed(() => {
  const discount = (1 - localWeights.value.cacheRead / (localWeights.value.input || 1)) * 100;
  return discount >= 0 ? `${discount.toFixed(0)}% discount` : `${Math.abs(discount).toFixed(0)}% premium`;
});

const cacheCreationPremium = computed(() => {
  const premium = (localWeights.value.cacheCreation / (localWeights.value.input || 1) - 1) * 100;
  return premium >= 0 ? `${premium.toFixed(0)}% premium` : `${Math.abs(premium).toFixed(0)}% discount`;
});

const hasChanges = computed(() => (
    localWeights.value.input !== settingsStore.tokenCostWeights.input ||
    localWeights.value.output !== settingsStore.tokenCostWeights.output ||
    localWeights.value.cacheRead !== settingsStore.tokenCostWeights.cacheRead ||
    localWeights.value.cacheCreation !== settingsStore.tokenCostWeights.cacheCreation
  ));

// Sync local weights when modal opens
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    localWeights.value = { ...settingsStore.tokenCostWeights };
    error.value = null;
  }
});

function close() {
  emit('close');
}

async function save() {
  saving.value = true;
  error.value = null;
  try {
    await settingsStore.updateTokenCostWeights(localWeights.value);
    uiStore.success('Token weights updated');
    close();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

async function resetToDefaults() {
  saving.value = true;
  error.value = null;
  try {
    await settingsStore.resetTokenCostWeights();
    localWeights.value = { ...DEFAULT_TOKEN_COST_WEIGHTS };
    uiStore.success('Token weights reset to defaults');
    close();
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  width: 100%;
  max-width: 450px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
  border-radius: 0.25rem;
}

.close-btn:hover {
  color: var(--color-text);
  background: var(--color-background-soft);
}

.modal-body {
  padding: 1.25rem;
  overflow-y: auto;
}

.description {
  color: var(--color-text-soft);
  font-size: 0.875rem;
  margin: 0 0 1.5rem;
  line-height: 1.5;
}

.weights-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.weight-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.weight-field label {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--color-text);
}

.input-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.weight-input {
  width: 100px;
  padding: 0.5rem 0.75rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 0.875rem;
}

.weight-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.hint {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.error-message {
  margin-top: 1rem;
  padding: 0.75rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.25rem;
  color: var(--color-danger, #ef4444);
  font-size: 0.875rem;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--color-border);
  background: var(--color-background-soft);
}

.footer-actions {
  display: flex;
  gap: 0.75rem;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--color-primary);
  background: var(--color-background-soft);
}

.btn-primary {
  background: var(--color-primary);
  border: 1px solid var(--color-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}
</style>
