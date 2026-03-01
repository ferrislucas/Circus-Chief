import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, ref, reactive } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import GeneralSettingsView from './GeneralSettingsView.vue';

// Mock settings store - make it reactive
let mockSettingsStore = reactive({
  generalSettings: {
    disableAnalytics: false,
  },
  loading: false,
  error: null,
  fetchGeneralSettings: vi.fn().mockResolvedValue(),
  updateGeneralSettings: vi.fn().mockResolvedValue({
    disableAnalytics: false,
  }),
  resetGeneralSettings: vi.fn().mockResolvedValue({
    disableAnalytics: false,
  }),
});

vi.mock('../stores/settings.js', () => ({
  useSettingsStore: () => mockSettingsStore,
}));

// Mock UI store
let mockUiStore = {
  success: vi.fn(),
  error: vi.fn(),
};

vi.mock('../stores/ui.js', () => ({
  useUiStore: () => mockUiStore,
}));

describe('GeneralSettingsView', () => {
  let wrapper;
  let pinia;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    mockSettingsStore.generalSettings = { disableAnalytics: false };
    mockSettingsStore.loading = false;
    mockSettingsStore.error = null;
    mockUiStore.success.mockReset();
    mockUiStore.error.mockReset();

    // Create fresh pinia instance
    pinia = createPinia();
    setActivePinia(pinia);

    // Mount component
    wrapper = mount(GeneralSettingsView, {
      global: {
        plugins: [pinia],
      },
    });
  });

  describe('component rendering', () => {
    it('renders the form when not loading', () => {
      expect(wrapper.find('.form').exists()).toBe(true);
      expect(wrapper.find('.loading-state').exists()).toBe(false);
    });

    it('renders loading state when loading', async () => {
      mockSettingsStore.loading = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.loading-state').exists()).toBe(true);
      expect(wrapper.find('.form').exists()).toBe(false);
      expect(wrapper.text()).toContain('Loading...');
    });

    it('renders checkbox label', () => {
      expect(wrapper.text()).toContain('Disable analytics tracking');
    });

    it('renders help text', () => {
      expect(wrapper.text()).toContain('When enabled, no usage analytics will be collected.');
    });

    it('renders Save Settings button', () => {
      const saveButton = wrapper.find('button[type="submit"]');
      expect(saveButton.exists()).toBe(true);
      expect(saveButton.text()).toContain('Save Settings');
    });

    it('renders Reset to Defaults button', () => {
      const resetButton = wrapper.find('button[type="button"]');
      expect(resetButton.exists()).toBe(true);
      expect(resetButton.text()).toContain('Reset to Defaults');
    });
  });

  describe('checkbox interaction', () => {
    it('renders checkbox with initial value from store', () => {
      const checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.exists()).toBe(true);
      expect(checkbox.element.checked).toBe(false);
    });

    it('updates local ref when checkbox is clicked', async () => {
      const checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.element.checked).toBe(false);

      await checkbox.setChecked(true);
      expect(checkbox.element.checked).toBe(true);

      await checkbox.setChecked(false);
      expect(checkbox.element.checked).toBe(false);
    });
  });

  describe('save functionality', () => {
    it('calls updateGeneralSettings with current checkbox value', async () => {
      const checkbox = wrapper.find('input[type="checkbox"]');
      await checkbox.setChecked(true);

      const form = wrapper.find('form');
      await form.trigger('submit');
      await flushPromises();

      expect(mockSettingsStore.updateGeneralSettings).toHaveBeenCalledWith({
        disableAnalytics: true,
      });
    });

    it('calls updateGeneralSettings with false when unchecked', async () => {
      const form = wrapper.find('form');
      await form.trigger('submit');
      await flushPromises();

      expect(mockSettingsStore.updateGeneralSettings).toHaveBeenCalledWith({
        disableAnalytics: false,
      });
    });

    it('shows success message on successful save', async () => {
      const form = wrapper.find('form');
      await form.trigger('submit');
      await flushPromises();

      expect(mockUiStore.success).toHaveBeenCalledWith('General settings saved successfully');
    });

    it('shows error message on save failure', async () => {
      mockSettingsStore.updateGeneralSettings.mockRejectedValue(new Error('Save failed'));

      const form = wrapper.find('form');
      await form.trigger('submit');
      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
      expect(wrapper.find('.error-message').text()).toBe('Save failed');
    });

    it('disables buttons while saving', async () => {
      mockSettingsStore.updateGeneralSettings.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ disableAnalytics: false }), 100))
      );

      const form = wrapper.find('form');
      form.trigger('submit');

      await nextTick();

      const saveButton = wrapper.find('button[type="submit"]');
      const resetButton = wrapper.find('button[type="button"]');

      expect(saveButton.attributes('disabled')).toBeDefined();
      expect(resetButton.attributes('disabled')).toBeDefined();

      await flushPromises();
    });

    it('shows "Saving..." text while saving', async () => {
      mockSettingsStore.updateGeneralSettings.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ disableAnalytics: false }), 100))
      );

      const form = wrapper.find('form');
      form.trigger('submit');

      await nextTick();

      const saveButton = wrapper.find('button[type="submit"]');
      expect(saveButton.text()).toContain('Saving...');

      await flushPromises();
    });

    it('clears error message on successful save after previous error', async () => {
      mockSettingsStore.updateGeneralSettings
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce({ disableAnalytics: false });

      const form = wrapper.find('form');

      // First attempt - fails
      await form.trigger('submit');
      await flushPromises();
      expect(wrapper.find('.error-message').exists()).toBe(true);

      // Second attempt - succeeds
      await form.trigger('submit');
      await flushPromises();
      expect(wrapper.find('.error-message').exists()).toBe(false);
    });
  });

  describe('reset functionality', () => {
    it('shows confirmation dialog when reset is clicked', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      const resetButton = wrapper.find('button[type="button"]');
      await resetButton.trigger('click');

      expect(confirmSpy).toHaveBeenCalledWith('Reset all general settings to defaults?');

      confirmSpy.mockRestore();
    });

    it('does not reset if user cancels confirmation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      const resetButton = wrapper.find('button[type="button"]');
      await resetButton.trigger('click');
      await flushPromises();

      expect(mockSettingsStore.resetGeneralSettings).not.toHaveBeenCalled();
    });

    it('calls resetGeneralSettings if user confirms', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const resetButton = wrapper.find('button[type="button"]');
      await resetButton.trigger('click');
      await flushPromises();

      expect(mockSettingsStore.resetGeneralSettings).toHaveBeenCalled();
    });

    it('shows success message on successful reset', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);

      const resetButton = wrapper.find('button[type="button"]');
      await resetButton.trigger('click');
      await flushPromises();

      expect(mockUiStore.success).toHaveBeenCalledWith('General settings reset to defaults');
    });

    it('shows error message on reset failure', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      mockSettingsStore.resetGeneralSettings.mockRejectedValue(new Error('Reset failed'));

      const resetButton = wrapper.find('button[type="button"]');
      await resetButton.trigger('click');
      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
      expect(wrapper.find('.error-message').text()).toBe('Reset failed');
    });

    it('disables buttons while resetting', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      mockSettingsStore.resetGeneralSettings.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ disableAnalytics: false }), 100))
      );

      const resetButton = wrapper.find('button[type="button"]');
      await resetButton.trigger('click');
      await nextTick();

      const saveButton = wrapper.find('button[type="submit"]');
      expect(saveButton.attributes('disabled')).toBeDefined();

      await flushPromises();
    });
  });

  describe('lifecycle hooks', () => {
    it('fetches general settings on mount', () => {
      expect(mockSettingsStore.fetchGeneralSettings).toHaveBeenCalled();
    });
  });

  describe('watching store changes', () => {
    it('handles store settings being null gracefully', async () => {
      mockSettingsStore.generalSettings = null;
      await wrapper.vm.$nextTick();

      // Should not throw error
      const checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.exists()).toBe(true);
    });
  });
});
