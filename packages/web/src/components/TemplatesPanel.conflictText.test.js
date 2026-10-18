import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TemplatesPanel from './TemplatesPanel.vue';
import { useTemplatesStore } from '../stores/templates.js';
import { useUiStore } from '../stores/ui.js';
import { useProvidersStore } from '../stores/providers.js';

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('../stores/templates.js', () => ({
  useTemplatesStore: vi.fn(),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(),
}));

vi.mock('../stores/providers.js', () => ({
  useProvidersStore: vi.fn(),
}));

// Pure conflict: banner visible, no blocking problem — the banner must still
// render a real sentence instead of an empty paragraph.
vi.mock('../composables/useSelectionGuard.js', () => ({
  useSelectionGuard: () => ({
    problem: null,
    invalid: false,
    showBanner: true,
    keepMine: vi.fn(),
  }),
}));

vi.mock('./ModelSelector.vue', () => ({
  default: {
    name: 'ModelSelector',
    template: '<div class="model-selector-mock"></div>',
    props: ['modelValue'],
    emits: ['update:modelValue'],
  },
}));

describe('TemplatesPanel pure-conflict banner text', () => {
  let pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    useTemplatesStore.mockReturnValue({
      loading: false,
      projectTemplates: [],
      globalTemplates: [],
      getTemplateById: vi.fn(),
      fetchProjectTemplates: vi.fn(),
      createProjectTemplate: vi.fn(),
      createGlobalTemplate: vi.fn(),
    });
    useUiStore.mockReturnValue({ success: vi.fn(), error: vi.fn() });
    useProvidersStore.mockReturnValue({ providers: [] });
  });

  it('renders a non-empty paragraph on a pure conflict', async () => {
    const wrapper = mount(TemplatesPanel, {
      props: { projectId: 'proj-1' },
      global: {
        plugins: [pinia],
        stubs: { 'router-link': true },
      },
    });

    await wrapper.find('[data-testid="new-template-btn"]').trigger('click');

    const banner = wrapper.find('.conflict-banner');
    expect(banner.exists()).toBe(true);
    expect(banner.find('p').text().trim().length).toBeGreaterThan(0);
  });
});
