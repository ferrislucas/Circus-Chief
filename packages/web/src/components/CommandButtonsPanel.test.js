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

    // Find the data row (not the header)
    const tableRows = wrapper.findAll('.table-row');
    expect(tableRows.length).toBeGreaterThan(0);
    const commandCell = tableRows[0].find('.col-command');
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

    // Find and click delete button in the table row
    const deleteButton = wrapper.find('.table-row .btn-outline-danger');
    expect(deleteButton.exists()).toBe(true);
    await deleteButton.trigger('click');
    await nextTick();

    // Dialog appears
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    expect(wrapper.text()).toContain('Delete Command Button');
    expect(wrapper.text()).toContain('Run Tests');
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

    // Show dialog by clicking delete button in table row
    const deleteButton = wrapper.find('.table-row .btn-outline-danger');
    await deleteButton.trigger('click');
    await nextTick();

    // Modal should be visible
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);

    // Find and click cancel button in the modal
    const modalFooter = wrapper.find('.modal-footer');
    const cancelButton = modalFooter.findAll('button').find((btn) => btn.text() === 'Cancel');
    expect(cancelButton).toBeDefined();
    await cancelButton.trigger('click');
    await nextTick();

    // Dialog is gone
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
  });

  it('deletes button when confirmed', async () => {
    const deleteButtonFn = vi.fn().mockResolvedValue(undefined);
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
      deleteButton: deleteButtonFn,
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

    // Show dialog by clicking delete button in table row
    const deleteBtn = wrapper.find('.table-row .btn-outline-danger');
    await deleteBtn.trigger('click');
    await nextTick();

    // Modal should be visible
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);

    // Find and click confirm button in the modal
    const modalFooter = wrapper.find('.modal-footer');
    const confirmButton = modalFooter.findAll('button').find((btn) => btn.text() === 'Delete');
    expect(confirmButton).toBeDefined();
    await confirmButton.trigger('click');
    await flushPromises();

    // Verify delete was called
    expect(deleteButtonFn).toHaveBeenCalledWith('test-project', '1');
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
