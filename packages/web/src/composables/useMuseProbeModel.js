import { computed, ref, watch } from 'vue';
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
  const probeModelLoading = ref(false);
  const probeModelReady = ref(false);
  let loadGeneration = 0;
  let applyingLoad = false;
  let userEditedDuringLoad = false;

  // A user edit landing while a load is in flight wins over the stale
  // response. Synchronous flush so an edit followed by a same-tick load
  // resolution is still observed as an edit.
  watch(probeModel, () => {
    if (probeModelLoading.value && !applyingLoad) userEditedDuringLoad = true;
  }, { flush: 'sync' });

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
  // default so the modal always opens usable. A response from a superseded
  // load, or one racing a user edit, is discarded so a slow fetch can never
  // revert a pending selection.
  async function loadProbeModel() {
    loadGeneration += 1;
    const generation = loadGeneration;
    probeModelLoading.value = true;
    probeModelReady.value = false;
    userEditedDuringLoad = false;
    let stored = null;
    try {
      stored = await settingsStore.fetchMuseProbeSettings();
    } catch {
      stored = null;
    }
    if (generation === loadGeneration && !userEditedDuringLoad) {
      applyingLoad = true;
      try {
        probeModel.value = stored?.probeModel || MUSE_PROBE_DEFAULT_MODEL;
        if (!probeModelOptions.value.some((option) => option.modelId === probeModel.value)) {
          probeModel.value = MUSE_PROBE_DEFAULT_MODEL;
        }
      } finally {
        applyingLoad = false;
      }
    }
    if (generation === loadGeneration) {
      probeModelLoading.value = false;
      probeModelReady.value = true;
    }
  }

  // Resolves once the latest load (if any) settles, so saving cannot
  // persist the initial default over a not-yet-loaded stored value.
  function awaitProbeModelReady() {
    if (probeModelReady.value) return Promise.resolve();
    return new Promise((resolve) => {
      const stopWatch = watch(probeModelReady, (ready) => {
        if (ready) {
          stopWatch();
          resolve();
        }
      });
    });
  }

  return {
    probeModel,
    probeModelOptions,
    effectiveProbeModel,
    showProbeModelSection,
    probeModelLoading,
    probeModelReady,
    resetProbeModel,
    loadProbeModel,
    awaitProbeModelReady,
  };
}
