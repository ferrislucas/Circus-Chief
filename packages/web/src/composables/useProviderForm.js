import { ref, computed, watch } from 'vue';
import { useProvidersStore } from '../stores/providers.js';
import { useUiStore } from '../stores/ui.js';

/**
 * Create default empty form values.
 */
function createEmptyForm() {
  return {
    name: '',
    baseUrl: null,
    authToken: null,
    apiTimeoutMs: null,
    additionalEnvVars: {},
  };
}

/**
 * Populate form state from an existing provider.
 */
function populateFormFromProvider(provider) {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    authToken: provider.authToken === '••••••••' ? null : provider.authToken,
    apiTimeoutMs: provider.apiTimeoutMs,
    additionalEnvVars: provider.additionalEnvVars ? { ...provider.additionalEnvVars } : {},
  };
}

/**
 * Map provider models to local model objects for editing.
 */
function mapProviderModels(provider) {
  return (provider.models || []).map((m) => ({
    _serverId: m.id,
    modelId: m.modelId,
    displayName: m.displayName,
    tier: m.tier || 'custom',
  }));
}

/**
 * Build a model payload for API submission.
 */
function buildModelPayload(model) {
  return {
    modelId: model.modelId.trim(),
    displayName: model.displayName.trim() || model.modelId.trim(),
    tier: model.tier || 'custom',
  };
}

/**
 * Check if a model has changed compared to the original server model.
 */
function hasModelChanged(model, original) {
  return (
    model.modelId.trim() !== original.modelId ||
    model.displayName.trim() !== original.displayName ||
    model.tier !== original.tier
  );
}

/**
 * Reconcile a single model (create or update as needed).
 */
async function reconcileModel(providersStore, providerId, model, originalModelMap) {
  const isNew = !model._serverId && model.modelId.trim();
  if (isNew) {
    await providersStore.addModel(providerId, buildModelPayload(model));
    return;
  }
  const isExisting = model._serverId && originalModelMap.has(model._serverId);
  if (!isExisting) return;

  const original = originalModelMap.get(model._serverId);
  if (hasModelChanged(model, original)) {
    await providersStore.updateModel(providerId, model._serverId, buildModelPayload(model));
  }
}

/**
 * Reconcile all models: delete removed, create new, update changed.
 */
async function reconcileModels(providersStore, providerId, localModels, providerRef) {
  const serverModelIds = new Set(
    localModels.value.filter((m) => m._serverId).map((m) => m._serverId),
  );

  const originalModels = providerRef.value?.models || [];
  const originalModelMap = new Map(originalModels.map((m) => [m.id, m]));

  for (const serverModel of originalModels) {
    if (!serverModelIds.has(serverModel.id)) {
      await providersStore.removeModel(providerId, serverModel.id);
    }
  }

  for (const model of localModels.value) {
    await reconcileModel(providersStore, providerId, model, originalModelMap);
  }

  await providersStore.fetchProviders();
}

/**
 * Set up watcher that resets form when modal opens or provider changes.
 */
function setupFormWatcher(isOpenRef, providerRef, state) {
  watch(
    () => [isOpenRef.value, providerRef.value],
    ([isOpen, provider]) => {
      if (!isOpen) return;

      if (provider) {
        state.form.value = populateFormFromProvider(provider);
        state.envVarKeys.value = Object.keys(state.form.value.additionalEnvVars);
        state.authTokenModified.value = false;
        state.localModels.value = mapProviderModels(provider);
      } else {
        state.form.value = createEmptyForm();
        state.envVarKeys.value = [];
        state.localModels.value = [];
        state.authTokenModified.value = true;
      }

      state.showAuthToken.value = false;
      state.error.value = null;
      state.testResult.value = null;
    },
    { deep: true },
  );
}

/**
 * Build provider data payload from form values.
 */
function buildProviderPayload(form, authTokenModified) {
  const data = {
    name: form.value.name.trim(),
    baseUrl: form.value.baseUrl?.trim() || null,
    apiTimeoutMs: form.value.apiTimeoutMs || null,
    additionalEnvVars:
      Object.keys(form.value.additionalEnvVars).length > 0
        ? form.value.additionalEnvVars
        : null,
  };

  if (authTokenModified.value) {
    data.authToken = form.value.authToken?.trim() || null;
  }

  return data;
}

/**
 * Create env-var management functions.
 */
function createEnvVarHelpers(form, envVarKeys) {
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

  return { addEnvVar, removeEnvVar, updateEnvVarKey };
}

/**
 * Create test connection function.
 */
function createTestConnection(providersStore, state) {
  return async function testConnection() {
    state.testing.value = true;
    state.error.value = null;
    state.testResult.value = null;

    try {
      const sonnetModel = state.localModels.value.find((m) => m.tier === 'sonnet');
      const config = {
        baseUrl: state.form.value.baseUrl || undefined,
        authToken: state.form.value.authToken || undefined,
        defaultSonnetModel: sonnetModel?.modelId || undefined,
        apiTimeoutMs: state.form.value.apiTimeoutMs || undefined,
      };
      state.testResult.value = await providersStore.testConnection(config);
    } catch (err) {
      state.error.value = err.message;
    } finally {
      state.testing.value = false;
    }
  };
}

/**
 * Create save function.
 * @param {Object} deps - Dependencies { providersStore, uiStore }
 * @param {Object} state - Reactive state refs
 * @param {Object} ctx - Context { providerRef, onSaved }
 */
function createSaveFunction(deps, state, ctx) {
  const { providersStore, uiStore } = deps;
  const { providerRef, onSaved } = ctx;

  return async function save() {
    state.saving.value = true;
    state.error.value = null;

    try {
      const data = buildProviderPayload(state.form, state.authTokenModified);
      let savedProvider;

      if (state.isEditing.value) {
        savedProvider = await providersStore.updateProvider(providerRef.value.id, data);
        uiStore.success('Provider updated successfully');
      } else {
        savedProvider = await providersStore.createProvider(data);
        uiStore.success('Provider created successfully');
      }

      await reconcileModels(providersStore, savedProvider.id, state.localModels, providerRef);
      onSaved();
    } catch (err) {
      state.error.value = err.message;
    } finally {
      state.saving.value = false;
    }
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
export function useProviderForm(isOpenRef, providerRef, onSaved) {
  const providersStore = useProvidersStore();
  const uiStore = useUiStore();

  const form = ref(createEmptyForm());
  const localModels = ref([]);
  const envVarKeys = ref([]);
  const showAuthToken = ref(false);
  const saving = ref(false);
  const testing = ref(false);
  const error = ref(null);
  const testResult = ref(null);
  const authTokenModified = ref(false);

  const isEditing = computed(() => !!providerRef.value);
  const isValid = computed(() => form.value.name.trim().length > 0);
  const canTest = computed(() => form.value.baseUrl || form.value.authToken);

  const state = { form, localModels, envVarKeys, showAuthToken, saving, testing, error, testResult, authTokenModified, isEditing };

  setupFormWatcher(isOpenRef, providerRef, state);

  const { addEnvVar, removeEnvVar, updateEnvVarKey } = createEnvVarHelpers(form, envVarKeys);
  const testConnection = createTestConnection(providersStore, state);
  const save = createSaveFunction({ providersStore, uiStore }, state, { providerRef, onSaved });

  function addLocalModel() {
    localModels.value.push({ modelId: '', displayName: '', tier: 'custom' });
  }

  function removeLocalModel(index) {
    localModels.value.splice(index, 1);
  }

  return {
    form, localModels, envVarKeys, showAuthToken, saving, testing,
    error, testResult, authTokenModified, isEditing, isValid, canTest,
    addLocalModel, removeLocalModel, addEnvVar, removeEnvVar,
    updateEnvVarKey, testConnection, save,
  };
}
