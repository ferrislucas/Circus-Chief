import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import CommandButtonsPanel from './CommandButtonsPanel.vue';

// Global helper to flush all async updates and force DOM re-render
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    // Force Vue to re-render with updated state
    await wrapper.vm.$forceUpdate();
    await nextTick();
    // Multiple update cycles to ensure all conditions re-evaluate
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

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

/**
 * Create a mock store with getButtonsByProjectId that filters by projectId
 */
function makeStore(overrides = {}) {
  const buttons = overrides.buttons ?? [];
  return {
    buttons,
    loading: false,
    error: null,
    fetchButtons: vi.fn().mockResolvedValue(undefined),
    deleteButton: vi.fn().mockResolvedValue(undefined),
    getButtonsByProjectId: vi.fn((projectId) => buttons.filter((b) => b.projectId === projectId)),
    ...overrides,
  };
}

describe('CommandButtonsPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders loading state', async () => {
    const mockStore = makeStore({ loading: true });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('Loading Circus Commands');
    expect(wrapper.find('.loading-spinner').exists()).toBe(true);
  });

  it('renders error state', async () => {
    const mockStore = makeStore({ error: 'Failed to load buttons' });
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
    const mockStore = makeStore();
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    expect(wrapper.text()).toContain('No Circus Commands configured yet');
  });

  it('renders buttons table with data', async () => {
    const mockStore = makeStore({
      buttons: [
        {
          id: '1',
          label: 'Run Tests',
          command: 'npm test',
          sortOrder: 0,
          projectId: 'test-project',
        },
        {
          id: '2',
          label: 'Build',
          command: 'npm run build',
          sortOrder: 1,
          projectId: 'test-project',
        },
      ],
    });
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
    const mockStore = makeStore({
      buttons: [
        {
          id: '1',
          label: 'Long Command',
          command: 'this is a very long command that should be truncated because it exceeds the maximum length allowed for display',
          sortOrder: 0,
          projectId: 'test-project',
        },
      ],
    });
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
    const mockStore = makeStore({
      buttons: [
        {
          id: '1',
          label: 'Run Tests',
          command: 'npm test',
          sortOrder: 0,
          projectId: 'test-project',
        },
      ],
    });
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
    await flushAll(wrapper);

    // Dialog appears
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    expect(wrapper.text()).toContain('Delete Circus Command');
    expect(wrapper.text()).toContain('Run Tests');
  });

  it('cancels delete when clicking cancel', async () => {
    const mockStore = makeStore({
      buttons: [
        {
          id: '1',
          label: 'Run Tests',
          command: 'npm test',
          sortOrder: 0,
          projectId: 'test-project',
        },
      ],
    });
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
    await flushAll(wrapper);

    // Modal should be visible
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);

    // Find and click cancel button in the modal
    const modalFooter = wrapper.find('.modal-footer');
    const cancelButton = modalFooter.findAll('button').find((btn) => btn.text() === 'Cancel');
    expect(cancelButton).toBeDefined();
    await cancelButton.trigger('click');
    await flushAll(wrapper);

    // Dialog is gone
    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
  });

  it('deletes button when confirmed', async () => {
    const deleteButtonFn = vi.fn().mockResolvedValue(undefined);
    const mockStore = makeStore({
      buttons: [
        {
          id: '1',
          label: 'Run Tests',
          command: 'npm test',
          sortOrder: 0,
          projectId: 'test-project',
        },
      ],
      deleteButton: deleteButtonFn,
    });
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
    await flushAll(wrapper);

    // Modal should be visible
    expect(wrapper.find('.modal-overlay').exists()).toBe(true);

    // Find and click confirm button in the modal
    const modalFooter = wrapper.find('.modal-footer');
    const confirmButton = modalFooter.findAll('button').find((btn) => btn.text() === 'Delete');
    expect(confirmButton).toBeDefined();
    await confirmButton.trigger('click');
    await flushAll(wrapper);

    // Verify delete was called
    expect(deleteButtonFn).toHaveBeenCalledWith('test-project', '1');
  });

  it('fetches buttons for its projectId on mount', async () => {
    const fetchButtons = vi.fn().mockResolvedValue(undefined);
    const mockStore = makeStore({
      buttons: [
        { id: '1', label: 'Test', command: 'npm test', sortOrder: 1, projectId: 'test-project' },
      ],
      fetchButtons,
    });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    await flushPromises();
    // fetchButtons should be called with the projectId on mount
    expect(fetchButtons).toHaveBeenCalledWith('test-project');
    // And it should display the data from the store
    expect(wrapper.text()).toContain('Test');
  });

  it('re-fetches buttons when projectId prop changes', async () => {
    const fetchButtons = vi.fn().mockResolvedValue(undefined);
    const mockStore = makeStore({ fetchButtons });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'project-a' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    await flushPromises();
    expect(fetchButtons).toHaveBeenCalledWith('project-a');

    // Change projectId prop
    await wrapper.setProps({ projectId: 'project-b' });
    await flushPromises();

    expect(fetchButtons).toHaveBeenCalledWith('project-b');
  });

  it('renders only commands whose projectId matches the prop', async () => {
    const buttons = [
      { id: '1', label: 'Project A Command', command: 'cmd-a', sortOrder: 0, projectId: 'project-a' },
      { id: '2', label: 'Project B Command', command: 'cmd-b', sortOrder: 0, projectId: 'project-b' },
    ];
    const mockStore = makeStore({ buttons });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'project-a' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    // Only project-a command should appear
    expect(wrapper.text()).toContain('Project A Command');
    expect(wrapper.text()).not.toContain('Project B Command');
  });

  it('empty state uses filtered project commands, not global store length', async () => {
    // Store has a button for project-b, but panel is for project-a
    const buttons = [
      { id: '1', label: 'Project B Command', command: 'cmd-b', sortOrder: 0, projectId: 'project-b' },
    ];
    const mockStore = makeStore({ buttons });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'project-a' },
      global: {
        stubs: {
          RouterLink: true,
        },
      },
    });

    // Should show empty state for project-a even though store has a button for project-b
    expect(wrapper.text()).toContain('No Circus Commands configured yet');
    expect(wrapper.text()).not.toContain('Project B Command');
  });
});
