<template>
  <div v-if="isOpen" class="modal-overlay" @click.self="close">
    <div class="modal">
      <div class="modal-header">
        <h2>{{ isEditing ? 'Edit Provider' : 'Add Provider' }}</h2>
        <button type="button" class="close-btn" @click="close" title="Close">×</button>
      </div>

      <div class="modal-body">
        <form @submit.prevent="save">
          <div class="form-group">
            <label for="provider-name">Provider Name*</label>
            <input
              id="provider-name"
              v-model="form.name"
              type="text"
              placeholder="e.g., AWS Bedrock"
              required
              maxlength="100"
            />
          </div>

          <div class="form-group">
            <label for="base-url">
              Base URL
              <span class="label-hint">(ANTHROPIC_BASE_URL)</span>
            </label>
            <input
              id="base-url"
              v-model="form.baseUrl"
              type="url"
              placeholder="https://bedrock-runtime.us-east-1.amazonaws.com"
            />
          </div>

          <div class="form-group">
            <label for="auth-token">
              Auth Token
              <span class="label-hint">(ANTHROPIC_AUTH_TOKEN)</span>
            </label>
            <div class="token-input-wrapper">
              <input
                id="auth-token"
                v-model="form.authToken"
                :type="showAuthToken ? 'text' : 'password'"
                placeholder="Your authentication token"
                @input="authTokenModified = true"
              />
              <button
                type="button"
                class="toggle-visibility-btn"
                @click="showAuthToken = !showAuthToken"
                :title="showAuthToken ? 'Hide' : 'Show'"
              >
                {{ showAuthToken ? 'Hide' : 'Show' }}
              </button>
            </div>
          </div>

          <!-- Models Section -->
          <div class="models-section">
            <div class="models-header">
              <span class="models-title">Models</span>
              <span class="models-hint">Assign tiers to map provider models to Opus / Sonnet / Haiku roles</span>
            </div>

            <div v-if="localModels.length > 0" class="models-list">
              <div class="model-row model-row-header">
                <span class="col-model-id">Model ID</span>
                <span class="col-display-name">Display Name</span>
                <span class="col-tier">Tier</span>
                <span class="col-actions"></span>
              </div>
              <div
                v-for="(model, index) in localModels"
                :key="index"
                class="model-row"
              >
                <input
                  v-model="model.modelId"
                  type="text"
                  placeholder="anthropic.claude-3-sonnet-…"
                  class="col-model-id model-input"
                />
                <input
                  v-model="model.displayName"
                  type="text"
                  placeholder="My Sonnet"
                  class="col-display-name model-input"
                />
                <select v-model="model.tier" class="col-tier model-input tier-select">
                  <option value="opus">Opus</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="haiku">Haiku</option>
                  <option value="custom">Custom</option>
                </select>
                <button
                  type="button"
                  class="col-actions remove-model-btn"
                  @click="removeLocalModel(index)"
                  title="Remove model"
                >
                  ×
                </button>
              </div>
            </div>
            <div v-else class="models-empty">
              No models added yet.
            </div>

            <button type="button" class="btn btn-sm btn-secondary add-model-btn" @click="addLocalModel">
              + Add Model
            </button>
          </div>

          <!-- Advanced Settings Section -->
          <details class="expandable-section">
            <summary class="section-header">Advanced Settings</summary>
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
                />
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
                    />
                    <input
                      v-model="form.additionalEnvVars[key]"
                      type="text"
                      placeholder="value"
                      class="env-value"
                    />
                    <button
                      type="button"
                      class="remove-env-btn"
                      @click="removeEnvVar(key)"
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                  <button type="button" class="btn btn-sm btn-secondary" @click="addEnvVar">
                    + Add Variable
                  </button>
                </div>
              </div>
            </div>
          </details>

          <div v-if="error" class="error-message">{{ error }}</div>

          <!-- Test Result -->
          <div v-if="testResult" :class="['test-result', testResult.success ? 'success' : 'failure']">
            <div class="test-result-header">
              <span class="test-icon">{{ testResult.success ? '✓' : '✗' }}</span>
              <span class="test-message">{{ testResult.message }}</span>
            </div>
            <div v-if="testResult.details" class="test-details">
              <div v-if="testResult.details.model" class="test-detail">
                Model: <code>{{ testResult.details.model }}</code>
              </div>
              <div v-if="testResult.details.code" class="test-detail">
                Error Code: <code>{{ testResult.details.code }}</code>
              </div>
            </div>
          </div>
        </form>
      </div>

      <div class="modal-footer">
        <button
          type="button"
          class="btn btn-secondary"
          @click="testConnection"
          :disabled="saving || testing || !canTest"
        >
          {{ testing ? 'Testing...' : 'Test Connection' }}
        </button>
        <div class="footer-actions">
          <button type="button" class="btn btn-secondary" @click="close" :disabled="saving">
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            @click="save"
            :disabled="saving || !isValid"
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
import { useProvidersStore } from '../stores/providers.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  isOpen: { type: Boolean, default: false },
  provider: { type: Object, default: null },
});

const emit = defineEmits(['close', 'saved']);

const providersStore = useProvidersStore();
const uiStore = useUiStore();

const form = ref({
  name: '',
  baseUrl: null,
  authToken: null,
  apiTimeoutMs: null,
  additionalEnvVars: {},
});

// localModels: list of models to save with this provider.
// Each entry: { _serverId?: string, modelId: string, displayName: string, tier: string }
// _serverId = row ID from server (present for existing models; absent for new ones)
const localModels = ref([]);

const envVarKeys = ref([]);
const showAuthToken = ref(false);
const saving = ref(false);
const testing = ref(false);
const error = ref(null);
const testResult = ref(null);
const authTokenModified = ref(false); // Track if user has modified the auth token field

const isEditing = computed(() => !!props.provider);

const isValid = computed(() => {
  return form.value.name.trim().length > 0;
});

const canTest = computed(() => {
  // Can test if there's at least a base URL or auth token
  return form.value.baseUrl || form.value.authToken;
});

// Sync form when modal opens or provider changes
watch(
  () => [props.isOpen, props.provider],
  ([isOpen, provider]) => {
    if (isOpen) {
      if (provider) {
        // Edit mode - populate with existing data
        form.value = {
          name: provider.name,
          baseUrl: provider.baseUrl,
          authToken: provider.authToken === '••••••••' ? null : provider.authToken, // Don't populate redacted token
          apiTimeoutMs: provider.apiTimeoutMs,
          additionalEnvVars: provider.additionalEnvVars ? { ...provider.additionalEnvVars } : {},
        };
        envVarKeys.value = Object.keys(form.value.additionalEnvVars);
        authTokenModified.value = false; // Reset: user hasn't touched the token field yet

        // Populate local models from existing provider models
        localModels.value = (provider.models || []).map((m) => ({
          _serverId: m.id,
          modelId: m.modelId,
          displayName: m.displayName,
          tier: m.tier || 'custom',
        }));
      } else {
        // Create mode - reset form
        form.value = {
          name: '',
          baseUrl: null,
          authToken: null,
          apiTimeoutMs: null,
          additionalEnvVars: {},
        };
        envVarKeys.value = [];
        localModels.value = [];
        authTokenModified.value = true; // In create mode, always include authToken (even if null)
      }
      showAuthToken.value = false;
      error.value = null;
      testResult.value = null;
    }
  },
  { deep: true }
);

function close() {
  emit('close');
}

// ─── Model management ──────────────────────────────────────────────────────────

function addLocalModel() {
  localModels.value.push({ modelId: '', displayName: '', tier: 'custom' });
}

function removeLocalModel(index) {
  localModels.value.splice(index, 1);
}

// ─── Env vars ──────────────────────────────────────────────────────────────────

function addEnvVar() {
  const newKey = `ENV_VAR_${Object.keys(form.value.additionalEnvVars).length + 1}`;
  form.value.additionalEnvVars[newKey] = '';
  envVarKeys.value.push(newKey);
}

function removeEnvVar(key) {
  delete form.value.additionalEnvVars[key];
  envVarKeys.value = envVarKeys.value.filter((k) => k !== key);
}

function updateEnvVarKey(index, oldKey) {
  const newKey = envVarKeys.value[index];
  if (newKey !== oldKey && newKey.trim()) {
    const value = form.value.additionalEnvVars[oldKey];
    delete form.value.additionalEnvVars[oldKey];
    form.value.additionalEnvVars[newKey] = value;
  }
}

// ─── Test connection ───────────────────────────────────────────────────────────

async function testConnection() {
  testing.value = true;
  error.value = null;
  testResult.value = null;

  try {
    // Pick the sonnet-tiered local model (if any) as the test model
    const sonnetModel = localModels.value.find((m) => m.tier === 'sonnet');
    const config = {
      baseUrl: form.value.baseUrl || undefined,
      authToken: form.value.authToken || undefined,
      defaultSonnetModel: sonnetModel?.modelId || undefined,
      apiTimeoutMs: form.value.apiTimeoutMs || undefined,
    };

    testResult.value = await providersStore.testConnection(config);
  } catch (err) {
    error.value = err.message;
  } finally {
    testing.value = false;
  }
}

// ─── Save ──────────────────────────────────────────────────────────────────────

async function save() {
  saving.value = true;
  error.value = null;

  try {
    // Build provider payload (no model fields)
    const data = {
      name: form.value.name.trim(),
      baseUrl: form.value.baseUrl?.trim() || null,
      apiTimeoutMs: form.value.apiTimeoutMs || null,
      additionalEnvVars:
        Object.keys(form.value.additionalEnvVars).length > 0
          ? form.value.additionalEnvVars
          : null,
    };

    // Only include authToken if user has modified it
    if (authTokenModified.value) {
      data.authToken = form.value.authToken?.trim() || null;
    }

    let savedProvider;

    if (isEditing.value) {
      savedProvider = await providersStore.updateProvider(props.provider.id, data);
      uiStore.success('Provider updated successfully');
    } else {
      savedProvider = await providersStore.createProvider(data);
      uiStore.success('Provider created successfully');
    }

    // Reconcile models
    await reconcileModels(savedProvider.id);

    emit('saved');
  } catch (err) {
    error.value = err.message;
  } finally {
    saving.value = false;
  }
}

/**
 * Reconcile local model list with the server state.
 * - Delete server models that were removed locally
 * - Add new local models that don't yet have a server ID
 */
async function reconcileModels(providerId) {
  const serverModelIds = new Set(
    localModels.value.filter((m) => m._serverId).map((m) => m._serverId)
  );

  // Delete models that existed on the server but were removed locally
  const originalModels = props.provider?.models || [];
  for (const serverModel of originalModels) {
    if (!serverModelIds.has(serverModel.id)) {
      await providersStore.removeModel(providerId, serverModel.id);
    }
  }

  // Add new models (those without a _serverId)
  for (const model of localModels.value) {
    if (!model._serverId && model.modelId.trim()) {
      await providersStore.addModel(providerId, {
        modelId: model.modelId.trim(),
        displayName: model.displayName.trim() || model.modelId.trim(),
        tier: model.tier || 'custom',
      });
    }
  }

  // Re-fetch the provider so the store has fresh model data
  await providersStore.fetchProviders();
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
.form-group input[type='number'] {
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  color: var(--color-text);
  font-size: 0.875rem;
}

.form-group input:focus {
  outline: none;
  border-color: var(--color-primary);
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

/* ── Models section ─────────────────────────────────────────── */

.models-section {
  margin-bottom: 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  overflow: hidden;
}

.models-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
}

.models-title {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--color-text);
}

.models-hint {
  font-size: 0.8125rem;
  color: var(--color-text-soft);
}

.models-list {
  padding: 0.5rem 0.75rem;
}

.model-row {
  display: grid;
  grid-template-columns: 1fr 10rem 6.5rem 2rem;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.375rem;
}

.model-row-header {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-soft);
  margin-bottom: 0.25rem;
}

.model-row-header span {
  padding: 0 0.25rem;
}

.model-input {
  padding: 0.4rem 0.6rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  color: var(--color-text);
  font-size: 0.8125rem;
}

.model-input:focus {
  outline: none;
  border-color: var(--color-primary);
}

.tier-select {
  appearance: auto;
  cursor: pointer;
}

.remove-model-btn {
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  font-size: 1.125rem;
  cursor: pointer;
  padding: 0.2rem 0.4rem;
  line-height: 1;
  border-radius: 0.25rem;
  text-align: center;
}

.remove-model-btn:hover {
  color: var(--color-danger, #ef4444);
  border-color: var(--color-danger, #ef4444);
}

.models-empty {
  padding: 0.75rem 1rem;
  font-size: 0.8125rem;
  color: var(--color-text-soft);
  font-style: italic;
}

.add-model-btn {
  margin: 0.5rem 0.75rem 0.75rem;
}

/* ── Advanced / env vars ─────────────────────────────────────── */

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

.env-key {
  flex: 0 0 150px;
}

.env-value {
  flex: 1;
}

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

/* ── Status messages ─────────────────────────────────────────── */

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

.test-icon {
  font-size: 1.125rem;
}

.test-details {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid currentColor;
  opacity: 0.8;
}

.test-detail {
  margin-top: 0.25rem;
}

.test-detail code {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

/* ── Footer ──────────────────────────────────────────────────── */

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
</style>
