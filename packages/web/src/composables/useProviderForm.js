import { ref, computed, watch } from 'vue';
import { useProvidersStore } from '../stores/providers.js';
import { useUiStore } from '../stores/ui.js';

export const PROVIDER_KINDS = Object.freeze(['anthropic', 'openai']);

/**
 * Create the default (empty) form state for a new provider.
 * @returns {Object} Default form values
 */
function createFormDefaults() {
  return {
    name: '',
    kind: 'anthropic',
    baseUrl: null,
    authToken: null,
    apiTimeoutMs: null,
    additionalEnvVars: {},
    commitAttributionOverride: null,
  };
}

/**
 * Build form state from an existing provider.
 * @param {Object} provider - The provider to build form data from
 * @returns {{ formData: Object, envKeys: string[], models: Object[], authModified: boolean }}
 */
function buildFormFromProvider(provider) {
  const formData = {
    name: provider.name,
    kind: provider.kind || 'anthropic',
    baseUrl: provider.baseUrl,
    authToken: provider.authToken === '••••••••' ? null : provider.authToken,
    apiTimeoutMs: provider.apiTimeoutMs,
    additionalEnvVars: provider.additionalEnvVars ? { ...provider.additionalEnvVars } : {},
    commitAttributionOverride: provider.commitAttributionOverride || null,
  };
  const envKeys = Object.keys(formData.additionalEnvVars);
  const models = (provider.models || []).map((m) => ({
    _serverId: m.id,
    modelId: m.modelId,
    displayName: m.displayName,
    tier: m.tier || 'custom',
  }));
  return { formData, envKeys, models, authModified: false };
}

/**
 * Create all reactive state refs used by the provider form.
 * @returns {Object} All reactive state refs
 */
function createFormState() {
  return {
    form: ref(createFormDefaults()),
    localModels: ref([]),
    envVarKeys: ref([]),
    showAuthToken: ref(false),
    saving: ref(false),
    testing: ref(false),
    error: ref(null),
    testResult: ref(null),
    authTokenModified: ref(false),
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
  const uiStore = useUiStore();
  const attributionOnlyRef = options.attributionOnlyRef;

  // ── Form state ────────────────────────────────────────────────
  const state = createFormState();
  const { form, localModels, envVarKeys, showAuthToken, saving, testing, error, testResult, authTokenModified } = state;

  // ── Computed ──────────────────────────────────────────────────
  const isEditing = computed(() => Boolean(providerRef.value));
  const isValid = computed(() => {
    if (attributionOnlyRef?.value) return true;
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
    },
    { deep: true },
  );

  // ── Model helpers ─────────────────────────────────────────────
  function addLocalModel() {
    localModels.value.push({ modelId: '', displayName: '', tier: 'custom' });
  }

  function removeLocalModel(index) {
    localModels.value.splice(index, 1);
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
    );
  }

  function buildModelData(model) {
    return {
      modelId: model.modelId.trim(),
      displayName: model.displayName.trim() || model.modelId.trim(),
      tier: model.tier || 'custom',
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

    await providersStore.fetchProviders();
  }

  // ── Save ──────────────────────────────────────────────────────
  function normalizeCommitAttributionOverride(value) {
    const trimmed = value?.trim() || '';
    return trimmed ? trimmed : null;
  }

  async function save() {
    saving.value = true;
    error.value = null;

    try {
      const data = {
        name: form.value.name.trim(),
        baseUrl: form.value.baseUrl?.trim() || null,
        apiTimeoutMs: form.value.apiTimeoutMs || null,
        additionalEnvVars:
          Object.keys(form.value.additionalEnvVars).length > 0
            ? form.value.additionalEnvVars
            : null,
        commitAttributionOverride: normalizeCommitAttributionOverride(
          form.value.commitAttributionOverride
        ),
      };

      if (attributionOnlyRef?.value) {
        await providersStore.updateProvider(providerRef.value.id, {
          commitAttributionOverride: data.commitAttributionOverride,
        });
        uiStore.success('Provider updated successfully');
        onSaved();
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
    isValid,
    canTest,
    addLocalModel,
    removeLocalModel,
    addEnvVar,
    removeEnvVar,
    updateEnvVarKey,
    testConnection,
    save,
  };
}
