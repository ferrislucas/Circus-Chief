import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNewSessionForm, buildSessionPayload } from './useNewSessionForm.js';

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
