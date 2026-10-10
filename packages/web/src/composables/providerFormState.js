import { ref } from 'vue';

/**
 * Reactive state builders and pure list helpers for the provider form.
 * Lives here (not in useProviderForm.js) so that file stays under the
 * project's max-lines budget. Helpers take the refs they operate on
 * explicitly and only call methods on them — never assign — so the
 * `no-param-reassign` gate stays green; the composable binds them in its
 * return object.
 */

/**
 * Create the default (empty) form state for a new provider.
 * @returns {Object} Default form values
 */
export function createFormDefaults() {
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
export function buildFormFromProvider(provider) {
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
    enabled: m.enabled !== false,
    sortOrder: m.sortOrder ?? null,
  }));
  return { formData, envKeys, models, authModified: false };
}

/**
 * Create all reactive state refs used by the provider form.
 * @returns {Object} All reactive state refs
 */
export function createFormState() {
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

export function removeLocalModelAt(localModels, index) {
  localModels.value.splice(index, 1);
}

export function moveLocalModelAt(localModels, index, delta) {
  const destination = index + delta;
  if (destination < 0 || destination >= localModels.value.length) return;
  const [model] = localModels.value.splice(index, 1);
  localModels.value.splice(destination, 0, model);
}
