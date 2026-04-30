import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, nextTick } from 'vue';
import SummarySettingsView from './SummarySettingsView.vue';

const mockSettingsStore = reactive({
  summarySettings: {
    disableSessionSummaries: false,
    sessionTitlePrompt: '',
    summaryModel: '',
    summaryProviderId: null,
    defaultSessionTitlePrompt: 'Default title prompt',
  },
  loading: false,
  error: null,
  fetchSummarySettings: vi.fn().mockResolvedValue(),
  updateSummarySettings: vi.fn().mockResolvedValue({}),
  resetSummarySettings: vi.fn().mockResolvedValue({}),
});

const mockUiStore = {
  success: vi.fn(),
};

vi.mock('../stores/settings.js', () => ({
  useSettingsStore: () => mockSettingsStore,
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: () => mockUiStore,
}));

vi.mock('../components/ResizableTextarea.vue', () => ({
  default: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
}));

vi.mock('../components/ModelSelector.vue', () => ({
  default: {
    props: {
      modelValue: { type: String, default: '' },
      providerId: { type: String, default: null },
      hideBuiltInDuplicates: { type: Boolean, default: true },
    },
    emits: ['update:modelValue', 'update:providerId', 'model-selected'],
    methods: {
      select(value) {
        const [providerId = null, modelId = ''] = value ? value.split('::') : [null, ''];
        this.$emit('update:modelValue', modelId);
        this.$emit('update:providerId', providerId);
        this.$emit('model-selected', {
          modelId,
          providerId,
          kind: providerId?.includes('openai') ? 'openai' : 'anthropic',
        });
      },
    },
    template: `
      <select
        id="model-select"
        data-testid="summary-model-select"
        :data-hide-built-in-duplicates="String(hideBuiltInDuplicates)"
        :value="modelValue ? providerId + '::' + modelValue : ''"
        @change="select($event.target.value)"
      >
        <option value="">Use default summary model</option>
        <option value="anthropic-default::claude-haiku-4-5-20251001">Haiku 4.5 (Anthropic Official)</option>
        <option value="custom-openai::gpt-5.4-mini">gpt-5.4-mini (Custom OpenAI)</option>
      </select>
    `,
  },
}));

describe('SummarySettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsStore.summarySettings = {
      disableSessionSummaries: false,
      sessionTitlePrompt: '',
      summaryModel: '',
      summaryProviderId: null,
      defaultSessionTitlePrompt: 'Default title prompt',
    };
    mockSettingsStore.loading = false;
    mockSettingsStore.updateSummarySettings.mockResolvedValue({});
    mockSettingsStore.resetSummarySettings.mockResolvedValue({});
    mockUiStore.success.mockReset();
  });

  function mountView() {
    return mount(SummarySettingsView);
  }

  it('loads auto mode initially', async () => {
    const wrapper = mountView();
    await nextTick();

    expect(mockSettingsStore.fetchSummarySettings).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="summary-model-select"]').element.value).toBe('');
    expect(wrapper.find('[data-testid="summary-model-select"]').attributes('data-hide-built-in-duplicates')).toBe('false');
  });

  it('loads explicit provider and model mode initially', async () => {
    mockSettingsStore.summarySettings = {
      disableSessionSummaries: false,
      sessionTitlePrompt: 'Saved prompt',
      summaryModel: 'gpt-5.4-mini',
      summaryProviderId: 'custom-openai',
      defaultSessionTitlePrompt: 'Default title prompt',
    };

    const wrapper = mountView();
    await nextTick();

    expect(wrapper.find('[data-testid="summary-model-select"]').element.value).toBe('custom-openai::gpt-5.4-mini');
    expect(wrapper.find('textarea').element.value).toBe('Saved prompt');
  });

  it('saves an explicit provider and model pair', async () => {
    const wrapper = mountView();
    await nextTick();

    await wrapper.find('[data-testid="summary-model-select"]').setValue('anthropic-default::claude-haiku-4-5-20251001');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(mockSettingsStore.updateSummarySettings).toHaveBeenCalledWith({
      disableSessionSummaries: false,
      sessionTitlePrompt: 'Default title prompt',
      summaryModel: 'claude-haiku-4-5-20251001',
      summaryProviderId: 'anthropic-default',
    });
    expect(mockUiStore.success).toHaveBeenCalledWith('Summary settings saved successfully');
  });

  it('switches back to auto mode with null provider', async () => {
    mockSettingsStore.summarySettings = {
      disableSessionSummaries: false,
      sessionTitlePrompt: 'Prompt',
      summaryModel: 'gpt-5.4-mini',
      summaryProviderId: 'custom-openai',
      defaultSessionTitlePrompt: 'Default title prompt',
    };
    const wrapper = mountView();
    await nextTick();

    await wrapper.find('[data-testid="summary-model-select"]').setValue('');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(mockSettingsStore.updateSummarySettings).toHaveBeenCalledWith({
      disableSessionSummaries: false,
      sessionTitlePrompt: 'Prompt',
      summaryModel: '',
      summaryProviderId: null,
    });
  });

  it('renders save failure without reporting success', async () => {
    mockSettingsStore.updateSummarySettings.mockRejectedValue(new Error('Save failed'));
    const wrapper = mountView();
    await nextTick();

    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.error-message').text()).toBe('Save failed');
    expect(mockUiStore.success).not.toHaveBeenCalled();
  });
});
