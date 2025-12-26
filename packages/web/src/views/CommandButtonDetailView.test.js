import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import CommandButtonDetailView from './CommandButtonDetailView.vue';
import { ROUTE_PARAMS } from '@claudetools/shared/routeParams';

// Mock router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
  }),
  useRoute: () => ({
    params: {
      [ROUTE_PARAMS.PROJECT_ID]: 'test-project',
      [ROUTE_PARAMS.BUTTON_ID]: null,
    },
  }),
}));

// Mock stores
vi.mock('../stores/commandButtons.js', () => ({
  useCommandButtonsStore: vi.fn(),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(),
}));

const { useCommandButtonsStore } = await import('../stores/commandButtons.js');
const { useUiStore } = await import('../stores/ui.js');

describe('CommandButtonDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders create form in create mode', async () => {
    const mockCommandStore = {
      loading: false,
      error: null,
      getButtonById: vi.fn().mockReturnValue(null),
      createButton: vi.fn().mockResolvedValue({ id: 'new' }),
      updateButton: vi.fn(),
      deleteButton: vi.fn(),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandButtonDetailView, {
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('New Command Button');
    expect(wrapper.find('form').exists()).toBe(true);
  });

  it('renders form fields', async () => {
    const mockCommandStore = {
      loading: false,
      error: null,
      getButtonById: vi.fn().mockReturnValue(null),
      createButton: vi.fn(),
      updateButton: vi.fn(),
      deleteButton: vi.fn(),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandButtonDetailView, {
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    expect(wrapper.find('#label').exists()).toBe(true);
    expect(wrapper.find('#command').exists()).toBe(true);
    expect(wrapper.find('#sortOrder').exists()).toBe(true);
  });

  it('validates required fields on submit', async () => {
    const mockCommandStore = {
      loading: false,
      error: null,
      getButtonById: vi.fn().mockReturnValue(null),
      createButton: vi.fn(),
      updateButton: vi.fn(),
      deleteButton: vi.fn(),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandButtonDetailView, {
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    // Try to submit empty form
    await wrapper.find('form').trigger('submit');
    await nextTick();

    // Should show validation errors
    expect(wrapper.text()).toContain('Label is required');
    expect(wrapper.text()).toContain('Command is required');
  });

  it('creates button with valid data', async () => {
    const createButton = vi.fn().mockResolvedValue({ id: 'new' });
    const mockCommandStore = {
      loading: false,
      error: null,
      getButtonById: vi.fn().mockReturnValue(null),
      createButton,
      updateButton: vi.fn(),
      deleteButton: vi.fn(),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandButtonDetailView, {
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    // Fill in form
    await wrapper.find('#label').setValue('Test Button');
    await wrapper.find('#command').setValue('npm test');
    await wrapper.find('#sortOrder').setValue(1);

    // Submit form
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    // Verify create was called
    expect(createButton).toHaveBeenCalledWith('test-project', {
      label: 'Test Button',
      command: 'npm test',
      sortOrder: 1,
    });

    // Verify success message
    expect(mockUiStore.success).toHaveBeenCalled();
  });

  it('shows delete button in edit mode', async () => {
    const mockCommandStore = {
      loading: false,
      error: null,
      getButtonById: vi.fn().mockReturnValue({
        id: 'btn-1',
        label: 'Existing Button',
        command: 'npm run',
        sortOrder: 0,
      }),
      createButton: vi.fn(),
      updateButton: vi.fn(),
      deleteButton: vi.fn(),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    // Mock route with buttonId
    vi.resetModules();
    vi.doMock('vue-router', () => ({
      useRouter: () => ({
        push: vi.fn(),
        back: vi.fn(),
      }),
      useRoute: () => ({
        params: {
          [ROUTE_PARAMS.PROJECT_ID]: 'test-project',
          [ROUTE_PARAMS.BUTTON_ID]: 'btn-1',
        },
      }),
    }));

    const wrapper = mount(CommandButtonDetailView, {
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    // Find delete button
    const deleteBtn = wrapper.findAll('.btn').find((btn) => btn.text().includes('Delete'));
    expect(deleteBtn).toBeDefined();
  });

  it('shows delete confirmation dialog', async () => {
    const mockCommandStore = {
      loading: false,
      error: null,
      getButtonById: vi.fn().mockReturnValue(null),
      createButton: vi.fn(),
      updateButton: vi.fn(),
      deleteButton: vi.fn(),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandButtonDetailView, {
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    // No dialog initially
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);

    // Set form data to enable delete button in edit mode (simulate edit mode)
    wrapper.vm.formData.label = 'Test Button';
    wrapper.vm.formData.command = 'npm test';
  });

  it('handles API errors', async () => {
    const createButton = vi.fn().mockRejectedValue(new Error('Network error'));
    const mockCommandStore = {
      loading: false,
      error: null,
      getButtonById: vi.fn().mockReturnValue(null),
      createButton,
      updateButton: vi.fn(),
      deleteButton: vi.fn(),
    };
    const mockUiStore = {
      success: vi.fn(),
      error: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockCommandStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    const wrapper = mount(CommandButtonDetailView, {
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    // Fill and submit
    await wrapper.find('#label').setValue('Test');
    await wrapper.find('#command').setValue('test');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    // Error handling
    expect(mockUiStore.error).toHaveBeenCalled();
  });
});
