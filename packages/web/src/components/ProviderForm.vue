<template>
  <div
    v-if="isOpen"
    class="modal-overlay"
    @click.self="close"
  >
    <div class="modal">
      <div class="modal-header">
        <h2>{{ attributionOnly ? 'Commit Attribution' : (isEditing ? 'Edit Provider' : 'Add Provider') }}</h2>
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
        <form @submit.prevent="save">
          <div
            v-if="!attributionOnly"
            class="form-group"
          >
            <label for="provider-name">Provider Name*</label>
            <input
              id="provider-name"
              v-model="form.name"
              type="text"
              placeholder="e.g., AWS Bedrock"
              required
              maxlength="100"
            >
          </div>

          <div
            v-if="!attributionOnly"
            class="form-group"
          >
            <label for="provider-kind">
              Compatibility*
              <span class="label-hint">Wire protocol &amp; env-var convention</span>
            </label>
            <select
              id="provider-kind"
              v-model="form.kind"
              :disabled="isEditing"
              :title="isEditing ? 'Compatibility cannot be changed after creation' : undefined"
              class="kind-select"
              required
            >
              <option value="anthropic">
                Anthropic (Claude Code)
              </option>
              <option value="openai">
                OpenAI / Codex
              </option>
            </select>
            <p
              v-if="isEditing"
              class="field-note"
            >
              Compatibility cannot be changed after creation.
            </p>
          </div>

          <div
            v-if="!attributionOnly"
            class="form-group"
          >
            <label for="base-url">
              Base URL
              <span class="label-hint">({{ baseUrlEnvName }})</span>
            </label>
            <input
              id="base-url"
              v-model="form.baseUrl"
              type="url"
              :placeholder="baseUrlPlaceholder"
            >
          </div>

          <div
            v-if="!attributionOnly"
            class="form-group"
          >
            <label for="auth-token">
              Auth Token
              <span class="label-hint">({{ authTokenEnvName }})</span>
            </label>
            <div class="token-input-wrapper">
              <input
                id="auth-token"
                v-model="form.authToken"
                :type="showAuthToken ? 'text' : 'password'"
                placeholder="Your authentication token"
                @input="authTokenModified = true"
              >
              <button
                type="button"
                class="toggle-visibility-btn"
                :title="showAuthToken ? 'Hide' : 'Show'"
                @click="showAuthToken = !showAuthToken"
              >
                {{ showAuthToken ? 'Hide' : 'Show' }}
              </button>
            </div>
          </div>

          <div class="form-group">
            <label for="commit-attribution-override">Commit attribution override</label>
            <textarea
              id="commit-attribution-override"
              v-model="form.commitAttributionOverride"
              rows="3"
              placeholder="Blank uses agent default"
            />
            <p class="field-note">
              Blank uses agent default.
            </p>
          </div>

          <ProviderModelsList
            v-if="!attributionOnly"
            :models="localModels"
            @add="addLocalModel"
            @remove="removeLocalModel"
          />

          <!-- Advanced Settings Section -->
          <details
            v-if="!attributionOnly"
            class="expandable-section"
          >
            <summary class="section-header">
              Advanced Settings
            </summary>
            <div class="section-content">
              <div class="form-group">
                <label for="api-timeout">API Timeout (ms)</label>
                <input
                  id="api-timeout"
                  v-model.number="form.apiTimeoutMs"
                  type="number"
                  placeholder="120000"
                  min="1000"
                  step="1000"
                >
              </div>

              <div class="form-group">
                <label>Additional Environment Variables</label>
                <div class="env-vars-list">
                  <div
                    v-for="(value, key, index) in form.additionalEnvVars"
                    :key="index"
                    class="env-var-row"
                  >
                    <input
                      v-model="envVarKeys[index]"
                      type="text"
                      placeholder="KEY"
                      class="env-key"
                      @blur="updateEnvVarKey(index, key)"
                    >
                    <input
                      v-model="form.additionalEnvVars[key]"
                      type="text"
                      placeholder="value"
                      class="env-value"
                    >
                    <button
                      type="button"
                      class="remove-env-btn"
                      title="Remove"
                      @click="removeEnvVar(key)"
                    >
                      ×
                    </button>
                  </div>
                  <button
                    type="button"
                    class="btn btn-sm btn-secondary"
                    @click="addEnvVar"
                  >
                    + Add Variable
                  </button>
                </div>
              </div>
            </div>
          </details>

          <div
            v-if="error"
            class="error-message"
          >
            {{ error }}
          </div>

          <!-- Test Result -->
          <div
            v-if="testResult"
            :class="['test-result', testResult.success ? 'success' : 'failure']"
          >
            <div class="test-result-header">
              <span class="test-icon">{{ testResult.success ? '✓' : '✗' }}</span>
              <span class="test-message">{{ testResult.message }}</span>
            </div>
            <div
              v-if="testResult.details"
              class="test-details"
            >
              <div
                v-if="testResult.details.model"
                class="test-detail"
              >
                Model: <code>{{ testResult.details.model }}</code>
              </div>
              <div
                v-if="testResult.details.code"
                class="test-detail"
              >
                Error Code: <code>{{ testResult.details.code }}</code>
              </div>
            </div>
          </div>
        </form>
      </div>

      <div class="modal-footer">
        <button
          v-if="!attributionOnly"
          type="button"
          class="btn btn-secondary"
          :disabled="saving || testing || !canTest"
          @click="testConnection"
        >
          {{ testing ? 'Testing...' : 'Test Connection' }}
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
            :disabled="saving || !isValid"
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
import { toRef, computed } from 'vue';
import { useProviderForm } from '../composables/useProviderForm.js';
import ProviderModelsList from './ProviderModelsList.vue';

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  provider: { type: Object, default: null },
  attributionOnly: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'saved']);

const {
  form,
  localModels,
  envVarKeys,
  showAuthToken,
  saving,
  testing,
  error,
  testResult,
  authTokenModified,
  isEditing,
  isValid,
  canTest,
  addLocalModel,
  removeLocalModel,
  addEnvVar,
  removeEnvVar,
  updateEnvVarKey,
  testConnection,
  save,
} = useProviderForm(
  toRef(props, 'isOpen'),
  toRef(props, 'provider'),
  () => emit('saved'),
  { attributionOnlyRef: toRef(props, 'attributionOnly') },
);

const baseUrlEnvName = computed(() =>
  form.value.kind === 'openai' ? 'OPENAI_BASE_URL' : 'ANTHROPIC_BASE_URL',
);
const authTokenEnvName = computed(() =>
  form.value.kind === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_AUTH_TOKEN',
);
const baseUrlPlaceholder = computed(() =>
  form.value.kind === 'openai'
    ? 'https://api.openai.com/v1'
    : 'https://bedrock-runtime.us-east-1.amazonaws.com',
);

function close() {
  emit('close');
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
  max-width: 680px;
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

.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--color-text);
}

.label-hint {
  font-weight: 400;
  color: var(--color-text-soft);
  font-size: 0.8125rem;
}

.form-group input[type='text'],
.form-group input[type='url'],
.form-group input[type='password'],
.form-group input[type='number'],
.form-group textarea,
.form-group select.kind-select {
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  color: var(--color-text);
  font-size: 0.875rem;
}

.form-group textarea {
  min-height: 4.75rem;
  resize: vertical;
  line-height: 1.45;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select.kind-select:focus {
  outline: none;
  border-color: var(--color-primary);
}

.form-group select.kind-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.field-note {
  margin: 0.375rem 0 0 0;
  font-size: 0.75rem;
  color: var(--color-text-soft);
  font-style: italic;
}

.token-input-wrapper {
  display: flex;
  gap: 0.5rem;
}

.token-input-wrapper input {
  flex: 1;
}

.toggle-visibility-btn {
  padding: 0.5rem 1rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  color: var(--color-text);
  font-size: 0.8125rem;
  cursor: pointer;
  white-space: nowrap;
}

.toggle-visibility-btn:hover {
  background: var(--color-background-soft);
}

/* -- Advanced / env vars -- */

.expandable-section {
  margin-bottom: 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
}

.section-header {
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  cursor: pointer;
  user-select: none;
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--color-text);
}

.section-header:hover {
  background: var(--color-background-mute);
}

.section-content {
  padding: 1rem;
}

.env-vars-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.env-var-row {
  display: flex;
  gap: 0.5rem;
}

.env-key,
.env-value {
  padding: 0.5rem 0.75rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  color: var(--color-text);
  font-size: 0.875rem;
  font-family: var(--font-mono);
}

.env-key { flex: 0 0 150px; }
.env-value { flex: 1; }

.env-key:focus,
.env-value:focus {
  outline: none;
  border-color: var(--color-primary);
}

.remove-env-btn {
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  line-height: 1;
  border-radius: 0.25rem;
}

.remove-env-btn:hover {
  color: var(--color-danger, #ef4444);
  border-color: var(--color-danger, #ef4444);
}

/* -- Status messages -- */

.error-message {
  margin-top: 1rem;
  padding: 0.75rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.25rem;
  color: var(--color-danger, #ef4444);
  font-size: 0.875rem;
}

.test-result {
  margin-top: 1rem;
  padding: 0.75rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
}

.test-result.success {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  color: var(--color-success, #22c55e);
}

.test-result.failure {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--color-danger, #ef4444);
}

.test-result-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
}

.test-icon { font-size: 1.125rem; }

.test-details {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid currentColor;
  opacity: 0.8;
}

.test-detail { margin-top: 0.25rem; }

.test-detail code {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

/* -- Footer -- */

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

.btn-sm {
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
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

@media (max-width: 520px) {
  .modal-overlay {
    align-items: stretch;
    justify-content: stretch;
  }

  .modal {
    max-width: none;
    max-height: none;
    min-height: 100vh;
    border-radius: 0;
    border-left: 0;
    border-right: 0;
  }

  .modal-body {
    padding: 1rem;
  }

  .modal-footer {
    align-items: stretch;
    flex-direction: column;
    gap: 0.75rem;
  }

  .footer-actions {
    justify-content: space-between;
    width: 100%;
  }

  .footer-actions .btn,
  .modal-footer > .btn {
    flex: 1;
  }

  .env-var-row,
  .token-input-wrapper {
    flex-direction: column;
  }

  .env-key {
    flex: 1;
  }
}
</style>
