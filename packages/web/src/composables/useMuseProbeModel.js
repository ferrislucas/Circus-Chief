import { computed, ref } from 'vue';
import { DEFAULT_MUSE_MODEL } from '@circuschief/shared';

export const MUSE_PROBE_DEFAULT_MODEL = DEFAULT_MUSE_MODEL;

/**
 * Kind-guard for the "Usage probe model" section (FR-9): rendered only in
 * the built-in provider settings modal for the `meta` provider. This single
 * predicate drives both the template and the test suite.
 */
export function showsMuseProbeModelSection(provider) {
  return Boolean(provider?.isBuiltIn) && provider?.kind === 'meta';
}

/**
 * Probe-model picker state for the built-in provider settings modal.
 * Options come from the meta provider's currently enabled models; a stored
 * value naming a since-disabled or removed model renders with the default
 * selected and saves the default on next Save (FR-9).
 */
export function useMuseProbeModel({ providerRef, builtInManageRef, localModelsRef, settingsStore }) {
  const probeModel = ref(MUSE_PROBE_DEFAULT_MODEL);

  // Visible only in built-in-manage mode for the `meta` provider (FR-9);
  // every other provider kind keeps byte-for-byte today's layout.
  const showProbeModelSection = computed(() => Boolean(builtInManageRef?.value)
    && showsMuseProbeModelSection(providerRef.value));
  const probeModelOptions = computed(() => localModelsRef.value
    .filter((model) => model.enabled !== false && model.modelId?.trim())
    .map((model) => ({
      modelId: model.modelId.trim(),
      displayName: model.displayName?.trim() || model.modelId.trim(),
    })));
  const effectiveProbeModel = computed(() => (probeModelOptions.value.some((option) => option.modelId === probeModel.value)
    ? probeModel.value
    : MUSE_PROBE_DEFAULT_MODEL));

  function resetProbeModel() {
    probeModel.value = MUSE_PROBE_DEFAULT_MODEL;
  }

  // Loads the stored probe model, coercing a stale value to the default so
  // the section renders with the default selected. Failures keep the
  // default so the modal always opens usable.
  async function loadProbeModel() {
    try {
      const stored = await settingsStore.fetchMuseProbeSettings();
      probeModel.value = stored?.probeModel || MUSE_PROBE_DEFAULT_MODEL;
    } catch {
      probeModel.value = MUSE_PROBE_DEFAULT_MODEL;
    }
    if (!probeModelOptions.value.some((option) => option.modelId === probeModel.value)) {
      probeModel.value = MUSE_PROBE_DEFAULT_MODEL;
    }
  }

  return {
    probeModel,
    probeModelOptions,
    effectiveProbeModel,
    showProbeModelSection,
    resetProbeModel,
    loadProbeModel,
  };
}
