import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import CommandButtonsPanel from './CommandButtonsPanel.vue';

// Mock router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock store
vi.mock('../stores/commandButtons.js', () => ({
  useCommandButtonsStore: vi.fn(),
}));

const { useCommandButtonsStore } = await import('../stores/commandButtons.js');

describe('CommandButtonsPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders loading state', async () => {
    const mockStore = {
      buttons: [],
      loading: true,
      error: null,
      fetchButtons: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('Loading command buttons');
    expect(wrapper.find('.loading-spinner').exists()).toBe(true);
  });

  it('renders error state', async () => {
    const mockStore = {
      buttons: [],
      loading: false,
      error: 'Failed to load buttons',
      fetchButtons: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('Failed to load buttons');
  });

  it('renders empty state when no buttons', async () => {
    const mockStore = {
      buttons: [],
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('No command buttons configured yet');
  });

  it('renders buttons table with data', async () => {
    const mockStore = {
      buttons: [
        {
          id: '1',
          label: 'Run Tests',
          command: 'npm test',
          sortOrder: 0,
        },
        {
          id: '2',
          label: 'Build',
          command: 'npm run build',
          sortOrder: 1,
        },
      ],
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('Run Tests');
    expect(wrapper.text()).toContain('Build');
    expect(wrapper.text()).toContain('npm test');
    expect(wrapper.text()).toContain('npm run build');
  });

  it('truncates long commands', async () => {
    const mockStore = {
      buttons: [
        {
          id: '1',
          label: 'Long Command',
          command: 'this is a very long command that should be truncated because it exceeds the maximum length allowed for display',
          sortOrder: 0,
        },
      ],
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    const commandCell = wrapper.find('.col-command');
    expect(commandCell.text()).toContain('...');
  });

  it('shows delete confirmation dialog on delete click', async () => {
    const mockStore = {
      buttons: [
        {
          id: '1',
          label: 'Run Tests',
          command: 'npm test',
          sortOrder: 0,
        },
      ],
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      deleteButton: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    // No dialog initially
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);

    // Click delete button
    await wrapper.find('.btn-outline-danger').trigger('click');
    await nextTick();

    // Dialog appears
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    expect(wrapper.text()).toContain('Delete Command Button');
  });

  it('cancels delete when clicking cancel', async () => {
    const mockStore = {
      buttons: [
        {
          id: '1',
          label: 'Run Tests',
          command: 'npm test',
          sortOrder: 0,
        },
      ],
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      deleteButton: vi.fn(),
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    // Show dialog
    await wrapper.find('.btn-outline-danger').trigger('click');
    await nextTick();

    // Click cancel
    const cancelButton = wrapper.findAll('.btn').find((btn) => btn.text() === 'Cancel');
    await cancelButton.trigger('click');
    await nextTick();

    // Dialog is gone
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
  });

  it('deletes button when confirmed', async () => {
    const deleteButton = vi.fn().mockResolvedValue(undefined);
    const mockStore = {
      buttons: [
        {
          id: '1',
          label: 'Run Tests',
          command: 'npm test',
          sortOrder: 0,
        },
      ],
      loading: false,
      error: null,
      fetchButtons: vi.fn(),
      deleteButton,
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    // Show dialog and confirm
    await wrapper.find('.btn-outline-danger').trigger('click');
    await nextTick();
    const confirmButton = wrapper.findAll('.btn').find((btn) => btn.text() === 'Delete');
    await confirmButton.trigger('click');
    await flushPromises();

    // Verify delete was called
    expect(deleteButton).toHaveBeenCalledWith('test-project', '1');
  });

  it('fetches buttons on mount', async () => {
    const fetchButtons = vi.fn().mockResolvedValue(undefined);
    const mockStore = {
      buttons: [],
      loading: false,
      error: null,
      fetchButtons,
    };
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    await flushPromises();
    expect(fetchButtons).toHaveBeenCalledWith('test-project');
  });
});
