import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, ref, nextTick } from 'vue';
import { useProviderForm } from './useProviderForm.js';

// ── Mock stores ───────────────────────────────────────────────────────
const mockProvidersStore = {
  testConnection: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  fetchProviders: vi.fn(),
  addModel: vi.fn(),
  updateModel: vi.fn(),
  removeModel: vi.fn(),
};

const mockUiStore = {
  success: vi.fn(),
  error: vi.fn(),
};

vi.mock('../stores/providers.js', () => ({
  useProvidersStore: () => mockProvidersStore,
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: () => mockUiStore,
}));

// ── withSetup helper ──────────────────────────────────────────────────
function withSetup(composableFn) {
  let result;
  const Comp = defineComponent({
    setup() {
      result = composableFn();
      return {};
    },
    template: '<div/>',
  });
  const wrapper = mount(Comp);
  return { result, wrapper };
}

// ── Tests ─────────────────────────────────────────────────────────────
describe('useProviderForm', () => {
  let isOpenRef;
  let providerRef;
  let onSaved;

  beforeEach(() => {
    vi.clearAllMocks();
    isOpenRef = ref(false);
    providerRef = ref(null);
    onSaved = vi.fn();
  });

  function createForm(options = {}) {
    return withSetup(() => useProviderForm(isOpenRef, providerRef, onSaved, options));
  }

  // ── 1. Form initialization - default state (no provider) ─────────
  describe('Form initialization - default state (no provider)', () => {
    it('should initialize form with empty/null defaults', () => {
      const { result } = createForm();

      expect(result.form.value).toEqual({
        name: '',
        kind: 'anthropic',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: {},
        commitAttributionOverride: null,
      });
    });

    it('should initialize localModels as empty array', () => {
      const { result } = createForm();
      expect(result.localModels.value).toEqual([]);
    });

    it('should initialize envVarKeys as empty array', () => {
      const { result } = createForm();
      expect(result.envVarKeys.value).toEqual([]);
    });

    it('should initialize showAuthToken as false', () => {
      const { result } = createForm();
      expect(result.showAuthToken.value).toBe(false);
    });

    it('should initialize saving as false', () => {
      const { result } = createForm();
      expect(result.saving.value).toBe(false);
    });

    it('should initialize testing as false', () => {
      const { result } = createForm();
      expect(result.testing.value).toBe(false);
    });

    it('should initialize error as null', () => {
      const { result } = createForm();
      expect(result.error.value).toBe(null);
    });

    it('should initialize testResult as null', () => {
      const { result } = createForm();
      expect(result.testResult.value).toBe(null);
    });

    it('should initialize authTokenModified as false', () => {
      const { result } = createForm();
      expect(result.authTokenModified.value).toBe(false);
    });
  });

  // ── 2. Form initialization - editing existing provider ────────────
  describe('Form initialization - editing existing provider', () => {
    it('should populate form from provider when modal opens', async () => {
      const { result } = createForm();

      providerRef.value = {
        id: 'p1',
        name: 'My Provider',
        baseUrl: 'https://api.example.com',
        authToken: 'secret-token',
        apiTimeoutMs: 30000,
        additionalEnvVars: { API_KEY: 'abc123' },
        models: [],
      };
      isOpenRef.value = true;
      await nextTick();

      expect(result.form.value.name).toBe('My Provider');
      expect(result.form.value.baseUrl).toBe('https://api.example.com');
      expect(result.form.value.authToken).toBe('secret-token');
      expect(result.form.value.apiTimeoutMs).toBe(30000);
      expect(result.form.value.additionalEnvVars).toEqual({ API_KEY: 'abc123' });
    });

    it('should populate localModels from provider models', async () => {
      const { result } = createForm();

      providerRef.value = {
        id: 'p1',
        name: 'Test',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [
          { id: 'm1', modelId: 'gpt-4', displayName: 'GPT-4', tier: 'sonnet' },
          { id: 'm2', modelId: 'gpt-3.5', displayName: 'GPT-3.5', tier: 'custom' },
        ],
      };
      isOpenRef.value = true;
      await nextTick();

      expect(result.localModels.value).toEqual([
        { _serverId: 'm1', modelId: 'gpt-4', displayName: 'GPT-4', tier: 'sonnet' },
        { _serverId: 'm2', modelId: 'gpt-3.5', displayName: 'GPT-3.5', tier: 'custom' },
      ]);
    });

    it('should set authTokenModified to false when editing', async () => {
      const { result } = createForm();

      providerRef.value = {
        id: 'p1',
        name: 'Test',
        baseUrl: null,
        authToken: 'tok',
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [],
      };
      isOpenRef.value = true;
      await nextTick();

      expect(result.authTokenModified.value).toBe(false);
    });

    it('should set authToken to null when provider has masked token', async () => {
      const { result } = createForm();

      providerRef.value = {
        id: 'p1',
        name: 'Test',
        baseUrl: null,
        authToken: '••••••••',
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [],
      };
      isOpenRef.value = true;
      await nextTick();

      expect(result.form.value.authToken).toBe(null);
    });

    it('should populate envVarKeys from provider additionalEnvVars', async () => {
      const { result } = createForm();

      providerRef.value = {
        id: 'p1',
        name: 'Test',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: { KEY_A: 'val1', KEY_B: 'val2' },
        models: [],
      };
      isOpenRef.value = true;
      await nextTick();

      expect(result.envVarKeys.value).toEqual(['KEY_A', 'KEY_B']);
    });

    it('should handle provider with null additionalEnvVars', async () => {
      const { result } = createForm();

      providerRef.value = {
        id: 'p1',
        name: 'Test',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [],
      };
      isOpenRef.value = true;
      await nextTick();

      expect(result.form.value.additionalEnvVars).toEqual({});
      expect(result.envVarKeys.value).toEqual([]);
    });

    it('should default model tier to custom when not specified', async () => {
      const { result } = createForm();

      providerRef.value = {
        id: 'p1',
        name: 'Test',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [{ id: 'm1', modelId: 'model-x', displayName: 'Model X' }],
      };
      isOpenRef.value = true;
      await nextTick();

      expect(result.localModels.value[0].tier).toBe('custom');
    });
  });

  // ── 3. isEditing computed ─────────────────────────────────────────
  describe('isEditing computed', () => {
    it('should be false when providerRef is null', () => {
      const { result } = createForm();
      expect(result.isEditing.value).toBe(false);
    });

    it('should be true when providerRef has a value', async () => {
      const { result } = createForm();

      providerRef.value = { id: 'p1', name: 'Test', models: [] };
      await nextTick();

      expect(result.isEditing.value).toBe(true);
    });

    it('should revert to false when providerRef is set back to null', async () => {
      providerRef.value = { id: 'p1', name: 'Test', models: [] };
      const { result } = createForm();

      expect(result.isEditing.value).toBe(true);

      providerRef.value = null;
      await nextTick();

      expect(result.isEditing.value).toBe(false);
    });
  });

  // ── 4. isValid computed ───────────────────────────────────────────
  describe('isValid computed', () => {
    it('should be false when name is empty', () => {
      const { result } = createForm();
      expect(result.isValid.value).toBe(false);
    });

    it('should be false when name is only whitespace', () => {
      const { result } = createForm();
      result.form.value.name = '   ';
      expect(result.isValid.value).toBe(false);
    });

    it('should be true when name has content', () => {
      const { result } = createForm();
      result.form.value.name = 'My Provider';
      expect(result.isValid.value).toBe(true);
    });

    it('should be true when name has content after trimming', () => {
      const { result } = createForm();
      result.form.value.name = '  Padded  ';
      expect(result.isValid.value).toBe(true);
    });
  });

  // ── 5. canTest computed ───────────────────────────────────────────
  describe('canTest computed', () => {
    it('should be false when both baseUrl and authToken are falsy', () => {
      const { result } = createForm();
      expect(result.canTest.value).toBeFalsy();
    });

    it('should be truthy when baseUrl is set', () => {
      const { result } = createForm();
      result.form.value.baseUrl = 'https://api.example.com';
      expect(result.canTest.value).toBeTruthy();
    });

    it('should be truthy when authToken is set', () => {
      const { result } = createForm();
      result.form.value.authToken = 'my-token';
      expect(result.canTest.value).toBeTruthy();
    });

    it('should be truthy when both baseUrl and authToken are set', () => {
      const { result } = createForm();
      result.form.value.baseUrl = 'https://api.example.com';
      result.form.value.authToken = 'my-token';
      expect(result.canTest.value).toBeTruthy();
    });
  });

  // ── 6. addLocalModel / removeLocalModel ───────────────────────────
  describe('addLocalModel / removeLocalModel', () => {
    it('should add a new empty model to localModels', () => {
      const { result } = createForm();
      result.addLocalModel();
      expect(result.localModels.value).toEqual([
        { modelId: '', displayName: '', tier: 'custom' },
      ]);
    });

    it('should add multiple models', () => {
      const { result } = createForm();
      result.addLocalModel();
      result.addLocalModel();
      expect(result.localModels.value).toHaveLength(2);
    });

    it('should remove model at specified index', () => {
      const { result } = createForm();
      result.addLocalModel();
      result.addLocalModel();
      result.localModels.value[0].modelId = 'first';
      result.localModels.value[1].modelId = 'second';

      result.removeLocalModel(0);

      expect(result.localModels.value).toHaveLength(1);
      expect(result.localModels.value[0].modelId).toBe('second');
    });

    it('should remove the last model leaving an empty array', () => {
      const { result } = createForm();
      result.addLocalModel();

      result.removeLocalModel(0);

      expect(result.localModels.value).toEqual([]);
    });

    it('should not affect other models when removing from the middle', () => {
      const { result } = createForm();
      result.addLocalModel();
      result.addLocalModel();
      result.addLocalModel();
      result.localModels.value[0].modelId = 'a';
      result.localModels.value[1].modelId = 'b';
      result.localModels.value[2].modelId = 'c';

      result.removeLocalModel(1);

      expect(result.localModels.value.map((m) => m.modelId)).toEqual(['a', 'c']);
    });
  });

  // ── 7. addEnvVar / removeEnvVar / updateEnvVarKey ─────────────────
  describe('addEnvVar / removeEnvVar / updateEnvVarKey', () => {
    it('should add an env var with auto-generated key', () => {
      const { result } = createForm();
      result.addEnvVar();

      expect(result.envVarKeys.value).toEqual(['ENV_VAR_1']);
      expect(result.form.value.additionalEnvVars).toEqual({ ENV_VAR_1: '' });
    });

    it('should increment auto-generated key names', () => {
      const { result } = createForm();
      result.addEnvVar();
      result.addEnvVar();

      expect(result.envVarKeys.value).toEqual(['ENV_VAR_1', 'ENV_VAR_2']);
    });

    it('should remove an env var by key', () => {
      const { result } = createForm();
      result.addEnvVar();
      result.addEnvVar();

      result.removeEnvVar('ENV_VAR_1');

      expect(result.envVarKeys.value).toEqual(['ENV_VAR_2']);
      expect(result.form.value.additionalEnvVars).toEqual({ ENV_VAR_2: '' });
    });

    it('should remove the env var from additionalEnvVars object', () => {
      const { result } = createForm();
      result.addEnvVar();
      result.form.value.additionalEnvVars['ENV_VAR_1'] = 'some-value';

      result.removeEnvVar('ENV_VAR_1');

      expect(result.form.value.additionalEnvVars).toEqual({});
      expect('ENV_VAR_1' in result.form.value.additionalEnvVars).toBe(false);
    });

    it('should update env var key and transfer value', () => {
      const { result } = createForm();
      result.addEnvVar();
      result.form.value.additionalEnvVars['ENV_VAR_1'] = 'my-value';

      // Simulate the user renaming the key
      result.envVarKeys.value[0] = 'MY_CUSTOM_KEY';
      result.updateEnvVarKey(0, 'ENV_VAR_1');

      expect(result.form.value.additionalEnvVars['MY_CUSTOM_KEY']).toBe('my-value');
      expect('ENV_VAR_1' in result.form.value.additionalEnvVars).toBe(false);
    });

    it('should not update env var key when new key is the same as old key', () => {
      const { result } = createForm();
      result.addEnvVar();
      result.form.value.additionalEnvVars['ENV_VAR_1'] = 'val';

      // No rename -- key stays the same
      result.updateEnvVarKey(0, 'ENV_VAR_1');

      expect(result.form.value.additionalEnvVars['ENV_VAR_1']).toBe('val');
    });

    it('should not update env var key when new key is empty/whitespace', () => {
      const { result } = createForm();
      result.addEnvVar();
      result.form.value.additionalEnvVars['ENV_VAR_1'] = 'val';

      result.envVarKeys.value[0] = '   ';
      result.updateEnvVarKey(0, 'ENV_VAR_1');

      // Old key should remain untouched
      expect(result.form.value.additionalEnvVars['ENV_VAR_1']).toBe('val');
    });
  });

  // ── 8. testConnection ─────────────────────────────────────────────
  describe('testConnection', () => {
    it('should set testing to true during operation', async () => {
      let resolvePromise;
      mockProvidersStore.testConnection.mockImplementation(
        () => new Promise((resolve) => { resolvePromise = resolve; }),
      );

      const { result } = createForm();
      const promise = result.testConnection();

      expect(result.testing.value).toBe(true);

      resolvePromise({ success: true });
      await promise;

      expect(result.testing.value).toBe(false);
    });

    it('should set testResult on success', async () => {
      const testResultData = { success: true, models: ['m1'] };
      mockProvidersStore.testConnection.mockResolvedValue(testResultData);

      const { result } = createForm();
      await result.testConnection();

      expect(result.testResult.value).toEqual(testResultData);
      expect(result.error.value).toBe(null);
    });

    it('should set error on failure', async () => {
      mockProvidersStore.testConnection.mockRejectedValue(new Error('Connection refused'));

      const { result } = createForm();
      await result.testConnection();

      expect(result.error.value).toBe('Connection refused');
      expect(result.testResult.value).toBe(null);
    });

    it('should clear previous error and testResult before testing', async () => {
      mockProvidersStore.testConnection.mockResolvedValue({ success: true });

      const { result } = createForm();
      result.error.value = 'old error';
      result.testResult.value = { old: true };

      await result.testConnection();

      expect(result.error.value).toBe(null);
      expect(result.testResult.value).toEqual({ success: true });
    });

    it('should pass baseUrl and authToken to testConnection config', async () => {
      mockProvidersStore.testConnection.mockResolvedValue({ success: true });

      const { result } = createForm();
      result.form.value.baseUrl = 'https://api.example.com';
      result.form.value.authToken = 'token-123';

      await result.testConnection();

      expect(mockProvidersStore.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://api.example.com',
          authToken: 'token-123',
        }),
      );
    });

    it('should pass apiTimeoutMs when set', async () => {
      mockProvidersStore.testConnection.mockResolvedValue({ success: true });

      const { result } = createForm();
      result.form.value.baseUrl = 'https://api.example.com';
      result.form.value.apiTimeoutMs = 60000;

      await result.testConnection();

      expect(mockProvidersStore.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          apiTimeoutMs: 60000,
        }),
      );
    });

    it('should pass defaultSonnetModel when a sonnet-tier model exists', async () => {
      mockProvidersStore.testConnection.mockResolvedValue({ success: true });

      const { result } = createForm();
      result.form.value.baseUrl = 'https://api.example.com';
      result.localModels.value = [
        { modelId: 'claude-3-sonnet', displayName: 'Sonnet', tier: 'sonnet' },
      ];

      await result.testConnection();

      expect(mockProvidersStore.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultSonnetModel: 'claude-3-sonnet',
        }),
      );
    });

    it('should not pass defaultSonnetModel when no sonnet-tier model exists', async () => {
      mockProvidersStore.testConnection.mockResolvedValue({ success: true });

      const { result } = createForm();
      result.form.value.baseUrl = 'https://api.example.com';
      result.localModels.value = [
        { modelId: 'custom-model', displayName: 'Custom', tier: 'custom' },
      ];

      await result.testConnection();

      expect(mockProvidersStore.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultSonnetModel: undefined,
        }),
      );
    });

    it('should set testing to false even on error', async () => {
      mockProvidersStore.testConnection.mockRejectedValue(new Error('fail'));

      const { result } = createForm();
      await result.testConnection();

      expect(result.testing.value).toBe(false);
    });
  });

  // ── 9. save ───────────────────────────────────────────────────────
  describe('save', () => {
    describe('create new provider', () => {
      it('should call createProvider when not editing', async () => {
        const savedProvider = { id: 'new-p', name: 'New' };
        mockProvidersStore.createProvider.mockResolvedValue(savedProvider);
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'New Provider';

        await result.save();

        expect(mockProvidersStore.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'New Provider' }),
        );
      });

      it('should show success toast on create', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'new-p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';

        await result.save();

        expect(mockUiStore.success).toHaveBeenCalledWith('Provider created successfully');
      });

      it('should call onSaved callback after successful create', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'new-p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';

        await result.save();

        expect(onSaved).toHaveBeenCalled();
      });

      it('should include authToken when authTokenModified is true', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';
        result.form.value.authToken = 'my-secret';
        result.authTokenModified.value = true;

        await result.save();

        expect(mockProvidersStore.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({ authToken: 'my-secret' }),
        );
      });

      it('should not include authToken when authTokenModified is false', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';
        result.form.value.authToken = 'should-not-appear';
        result.authTokenModified.value = false;

        await result.save();

        const callArgs = mockProvidersStore.createProvider.mock.calls[0][0];
        expect(callArgs).not.toHaveProperty('authToken');
      });

      it('normalizes whitespace attribution override to null on create', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';
        result.form.value.commitAttributionOverride = '   ';

        await result.save();

        expect(mockProvidersStore.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({ commitAttributionOverride: null }),
        );
      });
    });

    describe('update existing provider', () => {
      it('should call updateProvider when editing', async () => {
        const existingProvider = {
          id: 'p1',
          name: 'Existing',
          baseUrl: null,
          authToken: null,
          apiTimeoutMs: null,
          additionalEnvVars: null,
          models: [],
        };

        providerRef.value = existingProvider;
        isOpenRef.value = true;

        const { result } = createForm();
        await nextTick();

        mockProvidersStore.updateProvider.mockResolvedValue({ id: 'p1' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        result.form.value.name = 'Updated Name';

        await result.save();

        expect(mockProvidersStore.updateProvider).toHaveBeenCalledWith(
          'p1',
          expect.objectContaining({ name: 'Updated Name' }),
        );
      });

      it('attribution-only update sends only commitAttributionOverride', async () => {
        providerRef.value = {
          id: 'p1',
          name: 'Built In',
          baseUrl: null,
          authToken: null,
          apiTimeoutMs: null,
          additionalEnvVars: null,
          commitAttributionOverride: null,
          models: [],
        };
        isOpenRef.value = true;
        const attributionOnlyRef = ref(true);

        const { result } = createForm({ attributionOnlyRef });
        await nextTick();

        mockProvidersStore.updateProvider.mockResolvedValue({ id: 'p1' });
        result.form.value.commitAttributionOverride = '  Codex <noreply@openai.com>  ';

        await result.save();

        expect(mockProvidersStore.updateProvider).toHaveBeenCalledWith('p1', {
          commitAttributionOverride: 'Codex <noreply@openai.com>',
        });
        expect(mockProvidersStore.fetchProviders).not.toHaveBeenCalled();
      });

      it('should show success toast on update', async () => {
        providerRef.value = {
          id: 'p1',
          name: 'Existing',
          baseUrl: null,
          authToken: null,
          apiTimeoutMs: null,
          additionalEnvVars: null,
          models: [],
        };
        isOpenRef.value = true;

        const { result } = createForm();
        await nextTick();

        mockProvidersStore.updateProvider.mockResolvedValue({ id: 'p1' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        await result.save();

        expect(mockUiStore.success).toHaveBeenCalledWith('Provider updated successfully');
      });

      it('should call onSaved callback after successful update', async () => {
        providerRef.value = {
          id: 'p1',
          name: 'Existing',
          baseUrl: null,
          authToken: null,
          apiTimeoutMs: null,
          additionalEnvVars: null,
          models: [],
        };
        isOpenRef.value = true;

        const { result } = createForm();
        await nextTick();

        mockProvidersStore.updateProvider.mockResolvedValue({ id: 'p1' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        await result.save();

        expect(onSaved).toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should set error on save failure', async () => {
        mockProvidersStore.createProvider.mockRejectedValue(new Error('Save failed'));

        const { result } = createForm();
        result.form.value.name = 'Test';

        await result.save();

        expect(result.error.value).toBe('Save failed');
      });

      it('should not call onSaved on failure', async () => {
        mockProvidersStore.createProvider.mockRejectedValue(new Error('Save failed'));

        const { result } = createForm();
        result.form.value.name = 'Test';

        await result.save();

        expect(onSaved).not.toHaveBeenCalled();
      });

      it('should set saving to false after failure', async () => {
        mockProvidersStore.createProvider.mockRejectedValue(new Error('fail'));

        const { result } = createForm();
        result.form.value.name = 'Test';

        await result.save();

        expect(result.saving.value).toBe(false);
      });
    });

    describe('saving state', () => {
      it('should set saving to true during operation', async () => {
        let resolvePromise;
        mockProvidersStore.createProvider.mockImplementation(
          () => new Promise((resolve) => { resolvePromise = resolve; }),
        );

        const { result } = createForm();
        result.form.value.name = 'Test';

        const promise = result.save();

        expect(result.saving.value).toBe(true);

        resolvePromise({ id: 'p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();
        await promise;

        expect(result.saving.value).toBe(false);
      });

      it('should clear error before saving', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.error.value = 'previous error';
        result.form.value.name = 'Test';

        await result.save();

        expect(result.error.value).toBe(null);
      });
    });

    describe('data formatting', () => {
      it('should trim name before saving', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = '  My Provider  ';

        await result.save();

        expect(mockProvidersStore.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'My Provider' }),
        );
      });

      it('should trim baseUrl before saving', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';
        result.form.value.baseUrl = '  https://api.example.com  ';

        await result.save();

        expect(mockProvidersStore.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({ baseUrl: 'https://api.example.com' }),
        );
      });

      it('should send null for empty baseUrl', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';
        result.form.value.baseUrl = '';

        await result.save();

        expect(mockProvidersStore.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({ baseUrl: null }),
        );
      });

      it('should send null for additionalEnvVars when empty', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';

        await result.save();

        expect(mockProvidersStore.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({ additionalEnvVars: null }),
        );
      });

      it('should send additionalEnvVars when populated', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';
        result.form.value.additionalEnvVars = { MY_VAR: 'value' };

        await result.save();

        expect(mockProvidersStore.createProvider).toHaveBeenCalledWith(
          expect.objectContaining({ additionalEnvVars: { MY_VAR: 'value' } }),
        );
      });
    });

    describe('model reconciliation', () => {
      it('should add new models during save', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'new-p' });
        mockProvidersStore.addModel.mockResolvedValue();
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';
        result.localModels.value = [
          { modelId: 'new-model', displayName: 'New Model', tier: 'custom' },
        ];

        await result.save();

        expect(mockProvidersStore.addModel).toHaveBeenCalledWith('new-p', {
          modelId: 'new-model',
          displayName: 'New Model',
          tier: 'custom',
        });
      });

      it('should remove deleted models during save', async () => {
        providerRef.value = {
          id: 'p1',
          name: 'Existing',
          baseUrl: null,
          authToken: null,
          apiTimeoutMs: null,
          additionalEnvVars: null,
          models: [
            { id: 'm1', modelId: 'old-model', displayName: 'Old', tier: 'custom' },
          ],
        };
        isOpenRef.value = true;

        const { result } = createForm();
        await nextTick();

        // Remove the model from local list
        result.localModels.value = [];

        mockProvidersStore.updateProvider.mockResolvedValue({ id: 'p1' });
        mockProvidersStore.removeModel.mockResolvedValue();
        mockProvidersStore.fetchProviders.mockResolvedValue();

        await result.save();

        expect(mockProvidersStore.removeModel).toHaveBeenCalledWith('p1', 'm1');
      });

      it('should update changed models during save', async () => {
        const { result } = createForm();

        providerRef.value = {
          id: 'p1',
          name: 'Existing',
          baseUrl: null,
          authToken: null,
          apiTimeoutMs: null,
          additionalEnvVars: null,
          models: [
            { id: 'm1', modelId: 'model-a', displayName: 'Model A', tier: 'custom' },
          ],
        };
        isOpenRef.value = true;
        await nextTick();

        // Change the model display name
        result.localModels.value[0].displayName = 'Model A Updated';

        mockProvidersStore.updateProvider.mockResolvedValue({ id: 'p1' });
        mockProvidersStore.updateModel.mockResolvedValue();
        mockProvidersStore.fetchProviders.mockResolvedValue();

        await result.save();

        expect(mockProvidersStore.updateModel).toHaveBeenCalledWith('p1', 'm1', {
          modelId: 'model-a',
          displayName: 'Model A Updated',
          tier: 'custom',
        });
      });

      it('should not update unchanged models', async () => {
        providerRef.value = {
          id: 'p1',
          name: 'Existing',
          baseUrl: null,
          authToken: null,
          apiTimeoutMs: null,
          additionalEnvVars: null,
          models: [
            { id: 'm1', modelId: 'model-a', displayName: 'Model A', tier: 'custom' },
          ],
        };
        isOpenRef.value = true;

        const { result } = createForm();
        await nextTick();

        // Don't change anything
        mockProvidersStore.updateProvider.mockResolvedValue({ id: 'p1' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        await result.save();

        expect(mockProvidersStore.updateModel).not.toHaveBeenCalled();
      });

      it('should skip new models with empty modelId', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'new-p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';
        result.localModels.value = [
          { modelId: '', displayName: '', tier: 'custom' },
        ];

        await result.save();

        expect(mockProvidersStore.addModel).not.toHaveBeenCalled();
      });

      it('should fetch providers after model reconciliation', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'new-p' });
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';

        await result.save();

        expect(mockProvidersStore.fetchProviders).toHaveBeenCalled();
      });

      it('should use modelId as displayName when displayName is empty', async () => {
        mockProvidersStore.createProvider.mockResolvedValue({ id: 'new-p' });
        mockProvidersStore.addModel.mockResolvedValue();
        mockProvidersStore.fetchProviders.mockResolvedValue();

        const { result } = createForm();
        result.form.value.name = 'Test';
        result.localModels.value = [
          { modelId: 'my-model', displayName: '', tier: 'custom' },
        ];

        await result.save();

        expect(mockProvidersStore.addModel).toHaveBeenCalledWith('new-p', {
          modelId: 'my-model',
          displayName: 'my-model',
          tier: 'custom',
        });
      });
    });
  });

  // ── 9.5 Phase 5: provider kind (anthropic vs openai) ─────────────
  describe('provider kind (Phase 5)', () => {
    it('defaults kind to "anthropic" on a fresh form', () => {
      const { result } = createForm();
      expect(result.form.value.kind).toBe('anthropic');
    });

    it('reads kind from an existing provider on edit', async () => {
      const { result } = createForm();
      providerRef.value = {
        id: 'p1',
        name: 'My OpenAI',
        kind: 'openai',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [],
      };
      isOpenRef.value = true;
      await nextTick();
      expect(result.form.value.kind).toBe('openai');
    });

    it('falls back to "anthropic" when editing a legacy provider without kind', async () => {
      const { result } = createForm();
      providerRef.value = {
        id: 'p1',
        name: 'Legacy',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [],
      };
      isOpenRef.value = true;
      await nextTick();
      expect(result.form.value.kind).toBe('anthropic');
    });

    it('isValid is false on create when kind is cleared', () => {
      const { result } = createForm();
      result.form.value.name = 'Valid Name';
      result.form.value.kind = '';
      expect(result.isValid.value).toBe(false);
    });

    it('isValid remains true on edit even without touching kind', async () => {
      const { result } = createForm();
      providerRef.value = {
        id: 'p1',
        name: 'Editable',
        kind: 'openai',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [],
      };
      isOpenRef.value = true;
      await nextTick();
      expect(result.isEditing.value).toBe(true);
      expect(result.isValid.value).toBe(true);
    });

    it('save() forwards kind=openai on create with the full shape', async () => {
      mockProvidersStore.createProvider.mockResolvedValue({ id: 'p' });
      mockProvidersStore.fetchProviders.mockResolvedValue();

      const { result } = createForm();
      result.form.value.name = 'Codex';
      result.form.value.kind = 'openai';
      result.form.value.additionalEnvVars = { EXTRA: 'x' };
      result.localModels.value = [
        { modelId: 'gpt-4o', displayName: 'GPT-4o', tier: 'custom' },
      ];

      await result.save();

      expect(mockProvidersStore.createProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'openai',
          name: 'Codex',
          additionalEnvVars: { EXTRA: 'x' },
        }),
      );
    });

    it('save() does NOT forward kind on update', async () => {
      providerRef.value = {
        id: 'p1',
        name: 'Existing',
        kind: 'anthropic',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [],
      };
      isOpenRef.value = true;

      const { result } = createForm();
      await nextTick();

      mockProvidersStore.updateProvider.mockResolvedValue({ id: 'p1' });
      mockProvidersStore.fetchProviders.mockResolvedValue();

      await result.save();

      const callArgs = mockProvidersStore.updateProvider.mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('kind');
    });

    it('testConnection() payload is an exact narrow shape including kind', async () => {
      mockProvidersStore.testConnection.mockResolvedValue({ success: true });

      const { result } = createForm();
      result.form.value.kind = 'openai';
      result.form.value.baseUrl = 'https://api.openai.com/v1';
      result.form.value.authToken = 'sk-xyz';
      result.form.value.apiTimeoutMs = 45000;
      result.form.value.additionalEnvVars = { SHOULD_NOT_LEAK: 'y' };
      result.localModels.value = [
        { modelId: 'gpt-4o', displayName: 'GPT-4o', tier: 'sonnet' },
        { modelId: 'other', displayName: 'other', tier: 'custom' },
      ];

      await result.testConnection();

      const callArgs = mockProvidersStore.testConnection.mock.calls[0][0];
      expect(callArgs).toEqual({
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authToken: 'sk-xyz',
        defaultSonnetModel: 'gpt-4o',
        apiTimeoutMs: 45000,
      });
      expect(callArgs).not.toHaveProperty('additionalEnvVars');
      expect(callArgs).not.toHaveProperty('models');
      expect(callArgs).not.toHaveProperty('name');
    });

    it('testConnection() defaults kind to anthropic when form.kind is unset', async () => {
      mockProvidersStore.testConnection.mockResolvedValue({ success: true });

      const { result } = createForm();
      result.form.value.kind = '';
      result.form.value.baseUrl = 'https://example.com';

      await result.testConnection();

      expect(mockProvidersStore.testConnection).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'anthropic' }),
      );
    });
  });

  // ── 10. Watcher behavior ──────────────────────────────────────────
  describe('Watcher behavior - reset form on modal open/close', () => {
    it('should reset form to defaults when modal opens with no provider', async () => {
      const { result } = createForm();

      // Manually dirty the form
      result.form.value.name = 'dirty';
      result.error.value = 'some error';
      result.testResult.value = { old: true };

      isOpenRef.value = true;
      await nextTick();

      expect(result.form.value.name).toBe('');
      expect(result.form.value.baseUrl).toBe(null);
      expect(result.form.value.authToken).toBe(null);
      expect(result.error.value).toBe(null);
      expect(result.testResult.value).toBe(null);
    });

    it('should set authTokenModified to true when creating new provider', async () => {
      const { result } = createForm();

      isOpenRef.value = true;
      await nextTick();

      expect(result.authTokenModified.value).toBe(true);
    });

    it('should reset showAuthToken when modal opens', async () => {
      const { result } = createForm();
      result.showAuthToken.value = true;

      providerRef.value = {
        id: 'p1',
        name: 'Test',
        baseUrl: null,
        authToken: null,
        apiTimeoutMs: null,
        additionalEnvVars: null,
        models: [],
      };
      isOpenRef.value = true;
      await nextTick();

      expect(result.showAuthToken.value).toBe(false);
    });

    it('should reset localModels when opening with no provider', async () => {
      const { result } = createForm();
      result.localModels.value = [{ modelId: 'stale', displayName: 'Stale', tier: 'custom' }];

      isOpenRef.value = true;
      await nextTick();

      expect(result.localModels.value).toEqual([]);
    });

    it('should reset envVarKeys when opening with no provider', async () => {
      const { result } = createForm();
      result.envVarKeys.value = ['STALE_KEY'];

      isOpenRef.value = true;
      await nextTick();

      expect(result.envVarKeys.value).toEqual([]);
    });

    it('should not reset form when modal is closed', async () => {
      const { result } = createForm();

      result.form.value.name = 'dirty';

      // Open then close the modal
      isOpenRef.value = true;
      await nextTick();

      result.form.value.name = 'set-while-open';
      isOpenRef.value = false;
      await nextTick();

      // name should remain as set since the watcher returns early when not open
      expect(result.form.value.name).toBe('set-while-open');
    });

    it('should populate form when provider changes while modal is open', async () => {
      const { result } = createForm();

      isOpenRef.value = true;
      await nextTick();

      providerRef.value = {
        id: 'p2',
        name: 'Another Provider',
        baseUrl: 'https://other.api.com',
        authToken: 'token-2',
        apiTimeoutMs: 5000,
        additionalEnvVars: { FOO: 'bar' },
        models: [{ id: 'm3', modelId: 'custom-m', displayName: 'Custom', tier: 'custom' }],
      };
      await nextTick();

      expect(result.form.value.name).toBe('Another Provider');
      expect(result.form.value.baseUrl).toBe('https://other.api.com');
      expect(result.localModels.value).toHaveLength(1);
      expect(result.envVarKeys.value).toEqual(['FOO']);
    });

    it('should clear error and testResult on modal open', async () => {
      const { result } = createForm();
      result.error.value = 'leftover error';
      result.testResult.value = { leftover: true };

      isOpenRef.value = true;
      await nextTick();

      expect(result.error.value).toBe(null);
      expect(result.testResult.value).toBe(null);
    });
  });
});
