import { ref, computed, watch } from 'vue';
import { useProvidersStore } from '../stores/providers.js';
import { useUiStore } from '../stores/ui.js';

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

  // ── Form state ────────────────────────────────────────────────
  const form = ref({
    name: '',
    baseUrl: null,
    authToken: null,
    apiTimeoutMs: null,
    additionalEnvVars: {},
  });

  const localModels = ref([]);
  const envVarKeys = ref([]);
  const showAuthToken = ref(false);
  const saving = ref(false);
  const testing = ref(false);
  const error = ref(null);
  const testResult = ref(null);
  const authTokenModified = ref(false);

  // ── Computed ──────────────────────────────────────────────────
  const isEditing = computed(() => !!providerRef.value);
  const isValid = computed(() => form.value.name.trim().length > 0);
  const canTest = computed(() => form.value.baseUrl || form.value.authToken);

  // ── Watcher: reset form when modal opens / provider changes ──
  watch(
    () => [isOpenRef.value, providerRef.value],
    ([isOpen, provider]) => {
      if (!isOpen) return;

      if (provider) {
        form.value = {
          name: provider.name,
          baseUrl: provider.baseUrl,
          authToken: provider.authToken === '••••••••' ? null : provider.authToken,
          apiTimeoutMs: provider.apiTimeoutMs,
          additionalEnvVars: provider.additionalEnvVars ? { ...provider.additionalEnvVars } : {},
        };
        envVarKeys.value = Object.keys(form.value.additionalEnvVars);
        authTokenModified.value = false;

        localModels.value = (provider.models || []).map((m) => ({
          _serverId: m.id,
          modelId: m.modelId,
          displayName: m.displayName,
          tier: m.tier || 'custom',
        }));
      } else {
        form.value = {
          name: '',
          baseUrl: null,
          authToken: null,
          apiTimeoutMs: null,
          additionalEnvVars: {},
        };
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

  // ── Reconcile models ─────────────────────────────────────────
  async function reconcileModels(providerId) {
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
      if (!model._serverId && model.modelId.trim()) {
        await providersStore.addModel(providerId, {
          modelId: model.modelId.trim(),
          displayName: model.displayName.trim() || model.modelId.trim(),
          tier: model.tier || 'custom',
        });
      } else if (model._serverId && originalModelMap.has(model._serverId)) {
        const original = originalModelMap.get(model._serverId);
        const changed =
          model.modelId.trim() !== original.modelId ||
          model.displayName.trim() !== original.displayName ||
          model.tier !== original.tier;

        if (changed) {
          await providersStore.updateModel(providerId, model._serverId, {
            modelId: model.modelId.trim(),
            displayName: model.displayName.trim() || model.modelId.trim(),
            tier: model.tier || 'custom',
          });
        }
      }
    }

    await providersStore.fetchProviders();
  }

  // ── Save ──────────────────────────────────────────────────────
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
      };

      if (authTokenModified.value) {
        data.authToken = form.value.authToken?.trim() || null;
      }

      let savedProvider;

      if (isEditing.value) {
        savedProvider = await providersStore.updateProvider(providerRef.value.id, data);
        uiStore.success('Provider updated successfully');
      } else {
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
