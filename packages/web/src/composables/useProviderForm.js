import { computed, watch } from 'vue';
import { useProvidersStore } from '../stores/providers.js';
import { useSettingsStore } from '../stores/settings.js';
import { useUiStore } from '../stores/ui.js';
import {
  COMMIT_ATTRIBUTION_VALIDATION_MESSAGE,
  parseCommitAttributionOverride,
} from '@circuschief/shared/contracts/providers';
import {
  MUSE_PROBE_DEFAULT_MODEL,
  showsMuseProbeModelSection,
  useMuseProbeModel,
} from './useMuseProbeModel.js';
import { localId } from '../utils/id.js';
import {
  buildFormFromProvider,
  createFormDefaults,
  createFormState,
  moveLocalModelAt,
  removeLocalModelAt,
} from './providerFormState.js';

export const PROVIDER_KINDS = Object.freeze(['anthropic', 'openai']);

export { MUSE_PROBE_DEFAULT_MODEL, showsMuseProbeModelSection };

function normalizeCommitAttributionOverride(value) {
  const result = parseCommitAttributionOverride(value);
  if (!result.success) {
    throw new Error(COMMIT_ATTRIBUTION_VALIDATION_MESSAGE);
  }
  return result.value;
}

function buildProviderData(form) {
  return {
    name: form.name.trim(),
    baseUrl: form.baseUrl?.trim() || null,
    apiTimeoutMs: form.apiTimeoutMs || null,
    additionalEnvVars:
      Object.keys(form.additionalEnvVars).length > 0
        ? form.additionalEnvVars
        : null,
    commitAttributionOverride: normalizeCommitAttributionOverride(
      form.commitAttributionOverride
    ),
  };
}

/**
 * Composable that manages all ProviderForm state and logic:
 * form data, validation, model list, env-var helpers, test-connection, save & reconcile.
 *
 * @param {import('vue').Ref<boolean>} isOpenRef - reactive ref for modal open state
 * @param {import('vue').Ref<Object|null>} providerRef - reactive ref for provider being edited (null = create)
 * @param {Function} onSaved - callback invoked after a successful save
 */
export function useProviderForm(isOpenRef, providerRef, onSaved, options = {}) {
  const providersStore = useProvidersStore();
  const settingsStore = useSettingsStore();
  const uiStore = useUiStore();
  const builtInManageRef = options.builtInManageRef;

  // ── Form state ────────────────────────────────────────────────
  const state = createFormState();
  const { form, localModels, envVarKeys, showAuthToken, saving, testing, error, testResult, authTokenModified } = state;
  const {
    probeModel,
    probeModelOptions,
    effectiveProbeModel,
    showProbeModelSection,
    resetProbeModel,
    loadProbeModel,
    awaitProbeModelReady,
  } = useMuseProbeModel({ providerRef, builtInManageRef, localModelsRef: localModels, settingsStore });

  // ── Computed ──────────────────────────────────────────────────
  const isEditing = computed(() => Boolean(providerRef.value));
  const attributionValidationError = computed(() => {
    const result = parseCommitAttributionOverride(form.value.commitAttributionOverride);
    return result.success ? null : result.error;
  });
  const isValid = computed(() => {
    if (attributionValidationError.value) return false;
    if (form.value.name.trim().length === 0) return false;
    // `kind` is required on create; on edit the server enforces immutability
    // and we simply surface the existing value, so no extra validation needed.
    if (!isEditing.value && !PROVIDER_KINDS.includes(form.value.kind)) return false;
    return true;
  });
  const canTest = computed(() => form.value.baseUrl || form.value.authToken);

  // ── Watcher: reset form when modal opens / provider changes ──
  watch(
    () => [isOpenRef.value, providerRef.value],
    ([isOpen, provider]) => {
      if (!isOpen) return;

      if (provider) {
        const result = buildFormFromProvider(provider);
        form.value = result.formData;
        envVarKeys.value = result.envKeys;
        localModels.value = result.models;
        authTokenModified.value = result.authModified;
      } else {
        form.value = createFormDefaults();
        envVarKeys.value = [];
        localModels.value = [];
        authTokenModified.value = true;
      }

      showAuthToken.value = false;
      error.value = null;
      testResult.value = null;
      resetProbeModel();
      if (provider && showsMuseProbeModelSection(provider)) {
        void loadProbeModel();
      }
    },
    { deep: true },
  );

  // ── Model helpers ─────────────────────────────────────────────
  // New rows get a stable client-side key so `ProviderModelsList`'s `v-for`
  // can key on `model._serverId || model._localKey` instead of the row's
  // array index (index keys make Vue patch focused rows in place on reorder).
  function addLocalModel() {
    error.value = null;
    try {
      localModels.value.push({
        _localKey: localId('model'),
        modelId: '',
        displayName: '',
        tier: 'custom',
        enabled: true,
      });
    } catch {
      error.value = 'Unable to add model. Please try again.';
    }
  }

  // ── Env-var helpers ───────────────────────────────────────────
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

  // ── Test connection ───────────────────────────────────────────
  async function testConnection() {
    testing.value = true;
    error.value = null;
    testResult.value = null;

    try {
      const sonnetModel = localModels.value.find((m) => m.tier === 'sonnet');
      // Narrow payload — do NOT bundle additionalEnvVars or models here.
      const config = {
        kind: form.value.kind || 'anthropic',
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

  // ── Model reconciliation helpers ─────────────────────────────
  function hasModelChanged(model, original) {
    return (
      model.modelId.trim() !== original.modelId ||
      model.displayName.trim() !== original.displayName ||
      model.tier !== original.tier
      || model.enabled !== original.enabled
    );
  }

  function buildModelData(model) {
    return {
      modelId: model.modelId.trim(),
      displayName: model.displayName.trim() || model.modelId.trim(),
      tier: model.tier || 'custom',
      enabled: model.enabled !== false,
    };
  }

  async function processLocalModel(model, providerId, originalModelMap) {
    // New model (no server ID) - add it
    if (!model._serverId && model.modelId.trim()) {
      await providersStore.addModel(providerId, buildModelData(model));
      return;
    }
    // Existing model - check if changed and update
    const original = originalModelMap.get(model._serverId);
    if (original && hasModelChanged(model, original)) {
      await providersStore.updateModel(providerId, model._serverId, buildModelData(model));
    }
  }

  // ── Reconcile models ─────────────────────────────────────────
  async function reconcileModels(providerId) {
    const serverModelIds = new Set(
      localModels.value.filter((m) => m._serverId).map((m) => m._serverId),
    );

    const originalModels = providerRef.value?.models || [];
    const originalModelMap = new Map(originalModels.map((m) => [m.id, m]));

    // Remove deleted models
    for (const serverModel of originalModels) {
      if (!serverModelIds.has(serverModel.id)) {
        await providersStore.removeModel(providerId, serverModel.id);
      }
    }

    // Add or update models
    for (const model of localModels.value) {
      await processLocalModel(model, providerId, originalModelMap);
    }

    const order = localModels.value.filter((model) => model._serverId).map((model) => model._serverId);
    if (order.length && typeof providersStore.reorderModels === 'function') {
      await providersStore.reorderModels(providerId, order);
    }

    await providersStore.fetchProviders();
  }

  // ── Save ──────────────────────────────────────────────────────
  function saveLimitedProvider(data) {
    const builtInManage = builtInManageRef?.value && providerRef.value?.isBuiltIn;
    if (!builtInManage) return null;

    return providersStore.updateProvider(providerRef.value.id, {
      commitAttributionOverride: data.commitAttributionOverride,
    }).then(async () => {
      await reconcileModels(providerRef.value.id);
      if (showProbeModelSection.value) {
        // Never persist the initial default over a stored value whose
        // load is still in flight.
        await awaitProbeModelReady();
        await settingsStore.updateMuseProbeSettings({ probeModel: effectiveProbeModel.value });
      }
      uiStore.success('Provider updated successfully');
      onSaved();
    });
  }

  async function save() {
    saving.value = true;
    error.value = null;

    try {
      const data = buildProviderData(form.value);
      const limitedSave = saveLimitedProvider(data);
      if (limitedSave) {
        await limitedSave;
        return;
      }

      if (authTokenModified.value) {
        data.authToken = form.value.authToken?.trim() || null;
      }

      let savedProvider;

      if (isEditing.value) {
        // `kind` is immutable server-side; the store also strips it as
        // defense-in-depth. Do not forward it on updates.
        savedProvider = await providersStore.updateProvider(providerRef.value.id, data);
        uiStore.success('Provider updated successfully');
      } else {
        // `kind` is required on create.
        data.kind = form.value.kind || 'anthropic';
        savedProvider = await providersStore.createProvider(data);
        uiStore.success('Provider created successfully');
      }

      await reconcileModels(savedProvider.id);
      onSaved();
    } catch (err) {
      error.value = err.message;
    } finally {
      saving.value = false;
    }
  }

  return {
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
    probeModel,
    probeModelOptions,
    effectiveProbeModel,
    showProbeModelSection,
    addLocalModel,
    removeLocalModel: (index) => removeLocalModelAt(localModels, index),
    moveLocalModel: (index, delta) => moveLocalModelAt(localModels, index, delta),
    addEnvVar,
    removeEnvVar,
    updateEnvVarKey,
    testConnection,
    save,
  };
}
