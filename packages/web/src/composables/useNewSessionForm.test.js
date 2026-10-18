import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNewSessionForm, buildSessionPayload, applyTemplateToForm } from './useNewSessionForm.js';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock the shared package
vi.mock('@circuschief/shared', () => ({
  generateWorktreeBranch: vi.fn((prefix, prompt) => `branch-${prompt.slice(0, 10)}`),
  DEFAULT_RESCHEDULE_DELAY_MINUTES: 15,
  isTierRef: (v) => typeof v === 'string' && v.startsWith('tier::'),
}));

describe('useNewSessionForm', () => {
  const storageKey = { value: 'test-draft-key' };

  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('initial state', () => {
    it('initializes schedulingData.autoRescheduleEnabled to true', () => {
      const form = useNewSessionForm(storageKey);
      expect(form.schedulingData.value.autoRescheduleEnabled).toBe(true);
    });

    it('initializes other scheduling fields with expected defaults', () => {
      const form = useNewSessionForm(storageKey);
      expect(form.schedulingData.value.scheduledAt).toBeNull();
      expect(form.schedulingData.value.rescheduleDelayMinutes).toBe(15);
      expect(form.schedulingData.value.rescheduleOnTokenLimit).toBe(true);
      expect(form.schedulingData.value.rescheduleOnServiceError).toBe(true);
      expect(form.schedulingData.value.maxRescheduleCount).toBeNull();
      expect(form.schedulingData.value.maxTotalTokens).toBeNull();
      expect(form.schedulingData.value.rescheduleAtTokenCount).toBeNull();
    });
  });

  describe('applyProjectDefaults pair hygiene', () => {
    it('nulls the provider hint when defaults bind a tier ref', () => {
      const form = useNewSessionForm(storageKey);
      form.applyProjectDefaults({ model: 'tier::t-high', providerId: 'stale-provider' });
      expect(form.model.value).toBe('tier::t-high');
      expect(form.providerId.value).toBeNull();
    });

    it('keeps a concrete provider hint for concrete models', () => {
      const form = useNewSessionForm(storageKey);
      form.applyProjectDefaults({ model: 'gpt-5', providerId: 'openai-custom' });
      expect(form.model.value).toBe('gpt-5');
      expect(form.providerId.value).toBe('openai-custom');
    });
  });

  describe('resetSchedulingData', () => {
    it('restores autoRescheduleEnabled to true after being set to false', () => {
      const form = useNewSessionForm(storageKey);

      // Simulate user turning off auto-reschedule
      form.schedulingData.value.autoRescheduleEnabled = false;
      expect(form.schedulingData.value.autoRescheduleEnabled).toBe(false);

      form.resetSchedulingData();
      expect(form.schedulingData.value.autoRescheduleEnabled).toBe(true);
    });

    it('resets all scheduling fields to defaults', () => {
      const form = useNewSessionForm(storageKey);

      // Mutate scheduling data
      form.schedulingData.value = {
        scheduledAt: Date.now() + 3600000,
        autoRescheduleEnabled: false,
        rescheduleDelayMinutes: 60,
        rescheduleOnTokenLimit: false,
        rescheduleOnServiceError: false,
        maxRescheduleCount: 5,
        maxTotalTokens: 100000,
        rescheduleAtTokenCount: 50000,
      };

      form.resetSchedulingData();

      expect(form.schedulingData.value.scheduledAt).toBeNull();
      expect(form.schedulingData.value.autoRescheduleEnabled).toBe(true);
      expect(form.schedulingData.value.rescheduleDelayMinutes).toBe(15);
      expect(form.schedulingData.value.rescheduleOnTokenLimit).toBe(true);
      expect(form.schedulingData.value.rescheduleOnServiceError).toBe(true);
      expect(form.schedulingData.value.maxRescheduleCount).toBeNull();
      expect(form.schedulingData.value.maxTotalTokens).toBeNull();
      expect(form.schedulingData.value.rescheduleAtTokenCount).toBeNull();
    });
  });
});

describe('applyTemplateToForm', () => {
  const storageKey = { value: 'test-key' };
  const textareaRef = { value: null };

  it('sets providerId alongside a concrete template model', () => {
    const form = useNewSessionForm(storageKey);
    form.model.value = 'old-model';
    form.providerId.value = 'old-provider';

    applyTemplateToForm({ prompt: 'hi', model: 'new-model', providerId: 'prov-b' }, form, textareaRef);

    expect(form.model.value).toBe('new-model');
    expect(form.providerId.value).toBe('prov-b');
  });

  it('clears a stale providerId when the template has no providerId key', () => {
    const form = useNewSessionForm(storageKey);
    form.model.value = 'old-model';
    form.providerId.value = 'old-provider';

    applyTemplateToForm({ prompt: 'hi', model: 'new-model' }, form, textareaRef);

    expect(form.model.value).toBe('new-model');
    expect(form.providerId.value).toBeNull();
  });

  it('forces providerId to null for tier refs even when the template carries one', () => {
    const form = useNewSessionForm(storageKey);
    form.model.value = 'old-model';
    form.providerId.value = 'old-provider';

    applyTemplateToForm({ prompt: 'hi', model: 'tier::abc', providerId: 'prov-b' }, form, textareaRef);

    expect(form.model.value).toBe('tier::abc');
    expect(form.providerId.value).toBeNull();
  });

  it('leaves model and provider untouched when the template has no model', () => {
    const form = useNewSessionForm(storageKey);
    form.model.value = 'old-model';
    form.providerId.value = 'old-provider';

    applyTemplateToForm({ prompt: 'hi' }, form, textareaRef);

    expect(form.model.value).toBe('old-model');
    expect(form.providerId.value).toBe('old-provider');
  });
});

describe('buildSessionPayload', () => {
  const storageKey = { value: 'test-key' };

  it('includes autoRescheduleEnabled: true by default in payload', () => {
    const form = useNewSessionForm(storageKey);
    const payload = buildSessionPayload(form, { currentPrompt: 'test prompt' });
    expect(payload.autoRescheduleEnabled).toBe(true);
  });

  it('preserves explicit false when user has turned off auto-reschedule', () => {
    const form = useNewSessionForm(storageKey);
    form.schedulingData.value.autoRescheduleEnabled = false;

    const payload = buildSessionPayload(form, { currentPrompt: 'test prompt' });
    expect(payload.autoRescheduleEnabled).toBe(false);
  });

  it('includes all scheduling fields in the payload', () => {
    const form = useNewSessionForm(storageKey);
    form.schedulingData.value.rescheduleDelayMinutes = 30;
    form.schedulingData.value.maxRescheduleCount = 5;

    const payload = buildSessionPayload(form, { currentPrompt: 'test prompt' });

    expect(payload).toHaveProperty('autoRescheduleEnabled', true);
    expect(payload).toHaveProperty('rescheduleDelayMinutes', 30);
    expect(payload).toHaveProperty('rescheduleOnTokenLimit', true);
    expect(payload).toHaveProperty('rescheduleOnServiceError', true);
    expect(payload).toHaveProperty('maxRescheduleCount', 5);
    expect(payload).toHaveProperty('maxTotalTokens', null);
    expect(payload).toHaveProperty('rescheduleAtTokenCount', null);
  });
});
