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
              <option value="google">
                Google (Gemini CLI)
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
            <p
              v-if="attributionValidationError"
              class="field-error"
            >
              {{ attributionValidationError }}
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
  attributionValidationError,
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

const baseUrlEnvName = computed(() => {
  if (form.value.kind === 'openai') return 'OPENAI_BASE_URL';
  if (form.value.kind === 'google') return 'Not used by Gemini CLI';
  return 'ANTHROPIC_BASE_URL';
});
const authTokenEnvName = computed(() => {
  if (form.value.kind === 'openai') return 'OPENAI_API_KEY';
  if (form.value.kind === 'google') return 'GEMINI_API_KEY';
  return 'ANTHROPIC_AUTH_TOKEN';
});
const baseUrlPlaceholder = computed(() => {
  if (form.value.kind === 'openai') return 'https://api.openai.com/v1';
  if (form.value.kind === 'google') return 'Leave blank \u2014 Gemini CLI uses its own endpoint';
  return 'https://bedrock-runtime.us-east-1.amazonaws.com';
});

function close() {
  emit('close');
}
</script>

<style scoped src="./ProviderForm.css"></style>
