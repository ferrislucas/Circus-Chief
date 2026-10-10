import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import {
  MUSE_PROBE_DEFAULT_MODEL,
  showsMuseProbeModelSection,
  useMuseProbeModel,
} from './useMuseProbeModel.js';

function setup({ provider = null, builtInManage = false, models = [], storedProbeModel = 'muse-spark-1.3' } = {}) {
  const settingsStore = {
    fetchMuseProbeSettings: vi.fn().mockResolvedValue({ probeModel: storedProbeModel }),
  };
  const api = useMuseProbeModel({
    providerRef: ref(provider),
    builtInManageRef: ref(builtInManage),
    localModelsRef: ref(models),
    settingsStore,
  });
  return { api, settingsStore };
}

const META = { id: 'meta-default', kind: 'meta', isBuiltIn: true };
const MODELS = [
  { modelId: 'muse-spark-1.3', displayName: 'Muse Spark 1.3', enabled: true },
  { modelId: 'muse-spark-1.3-contributor', displayName: 'Muse Spark 1.3 Contributor', enabled: true },
];

describe('showsMuseProbeModelSection', () => {
  it('is true only for built-in meta providers', () => {
    expect(showsMuseProbeModelSection(META)).toBe(true);
    expect(showsMuseProbeModelSection({ ...META, kind: 'anthropic' })).toBe(false);
    expect(showsMuseProbeModelSection({ ...META, isBuiltIn: false })).toBe(false);
    expect(showsMuseProbeModelSection(null)).toBe(false);
    expect(MUSE_PROBE_DEFAULT_MODEL).toBe('muse-spark-1.3');
  });
});

describe('useMuseProbeModel', () => {
  it('hides the section outside built-in-manage meta mode', () => {
    expect(setup({ provider: META, builtInManage: false, models: MODELS }).api.showProbeModelSection.value).toBe(false);
    expect(setup({ provider: { ...META, kind: 'openai' }, builtInManage: true }).api.showProbeModelSection.value).toBe(false);
    expect(setup({ provider: META, builtInManage: true, models: MODELS }).api.showProbeModelSection.value).toBe(true);
  });

  it('lists enabled models as options', () => {
    const { api } = setup({ models: [...MODELS, { modelId: 'old', displayName: 'Old', enabled: false }] });

    expect(api.probeModelOptions.value).toEqual([
      { modelId: 'muse-spark-1.3', displayName: 'Muse Spark 1.3' },
      { modelId: 'muse-spark-1.3-contributor', displayName: 'Muse Spark 1.3 Contributor' },
    ]);
  });

  it('loads the stored model and coerces stale values to the default', async () => {
    const { api } = setup({ models: MODELS, storedProbeModel: 'muse-spark-1.3-contributor' });
    await api.loadProbeModel();
    expect(api.probeModel.value).toBe('muse-spark-1.3-contributor');

    const stale = setup({ models: [MODELS[0]], storedProbeModel: 'muse-spark-1.3-contributor' });
    await stale.api.loadProbeModel();
    expect(stale.api.probeModel.value).toBe('muse-spark-1.3');
    expect(stale.api.effectiveProbeModel.value).toBe('muse-spark-1.3');
  });

  it('keeps the default when loading fails', async () => {
    const { api, settingsStore } = setup({ models: MODELS });
    settingsStore.fetchMuseProbeSettings.mockRejectedValue(new Error('offline'));

    await api.loadProbeModel();

    expect(api.probeModel.value).toBe('muse-spark-1.3');
  });
});
