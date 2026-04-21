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
 * Create a store mock with sensible defaults. Callers pass overrides
 * (e.g. `buttons`, `loading`, `error`).
 */
function makeStore(overrides = {}) {
  const { _runsByButton: runsByButton = {}, ...rest } = overrides;
  return {
    buttons: [],
    runs: {},
    loading: false,
    error: null,
    fetchButtons: vi.fn().mockResolvedValue(undefined),
    fetchLatestRunsForProject: vi.fn().mockResolvedValue(undefined),
    getLatestRunForButtonInProject: vi.fn((buttonId) => runsByButton[buttonId] ?? null),
    deleteButton: vi.fn().mockResolvedValue(undefined),
    ...rest,
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
      global: { stubs: { RouterLink: true } },
    });

    expect(wrapper.text()).toContain('Loading command buttons');
    expect(wrapper.find('.loading-spinner').exists()).toBe(true);
  });

  it('renders error state', async () => {
    const mockStore = makeStore({ error: 'Failed to load buttons' });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: { stubs: { RouterLink: true } },
    });

    expect(wrapper.text()).toContain('Failed to load buttons');
  });

  it('renders empty state when no buttons', async () => {
    const mockStore = makeStore({ buttons: [] });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: { stubs: { RouterLink: true } },
    });

    expect(wrapper.text()).toContain('No command buttons configured yet');
  });

  it('renders buttons table with data', async () => {
    const mockStore = makeStore({
      buttons: [
        { id: '1', label: 'Run Tests', command: 'npm test', sortOrder: 0 },
        { id: '2', label: 'Build', command: 'npm run build', sortOrder: 1 },
      ],
    });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: { stubs: { RouterLink: true } },
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
          command:
            'this is a very long command that should be truncated because it exceeds the maximum length allowed for display',
          sortOrder: 0,
        },
      ],
    });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: { stubs: { RouterLink: true } },
    });

    const tableRows = wrapper.findAll('.table-row');
    expect(tableRows.length).toBeGreaterThan(0);
    const commandCell = tableRows[0].find('.col-command');
    expect(commandCell.text()).toContain('...');
  });

  it('shows delete confirmation dialog on delete click', async () => {
    const mockStore = makeStore({
      buttons: [{ id: '1', label: 'Run Tests', command: 'npm test', sortOrder: 0 }],
    });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: { stubs: { RouterLink: true } },
    });

    expect(wrapper.find('.modal-overlay').exists()).toBe(false);

    const deleteButton = wrapper.find('.table-row .btn-outline-danger');
    expect(deleteButton.exists()).toBe(true);
    await deleteButton.trigger('click');
    await flushAll(wrapper);

    expect(wrapper.find('.modal-overlay').exists()).toBe(true);
    expect(wrapper.text()).toContain('Delete Command Button');
    expect(wrapper.text()).toContain('Run Tests');
  });

  it('cancels delete when clicking cancel', async () => {
    const mockStore = makeStore({
      buttons: [{ id: '1', label: 'Run Tests', command: 'npm test', sortOrder: 0 }],
    });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: { stubs: { RouterLink: true } },
    });

    const deleteButton = wrapper.find('.table-row .btn-outline-danger');
    await deleteButton.trigger('click');
    await flushAll(wrapper);

    expect(wrapper.find('.modal-overlay').exists()).toBe(true);

    const modalFooter = wrapper.find('.modal-footer');
    const cancelButton = modalFooter.findAll('button').find((btn) => btn.text() === 'Cancel');
    expect(cancelButton).toBeDefined();
    await cancelButton.trigger('click');
    await flushAll(wrapper);

    expect(wrapper.find('.modal-overlay').exists()).toBe(false);
  });

  it('deletes button when confirmed', async () => {
    const deleteButtonFn = vi.fn().mockResolvedValue(undefined);
    const mockStore = makeStore({
      buttons: [{ id: '1', label: 'Run Tests', command: 'npm test', sortOrder: 0 }],
      deleteButton: deleteButtonFn,
    });
    vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

    const wrapper = mount(CommandButtonsPanel, {
      props: { projectId: 'test-project' },
      global: { stubs: { RouterLink: true } },
    });

    const deleteBtn = wrapper.find('.table-row .btn-outline-danger');
    await deleteBtn.trigger('click');
    await flushAll(wrapper);

    expect(wrapper.find('.modal-overlay').exists()).toBe(true);

    const modalFooter = wrapper.find('.modal-footer');
    const confirmButton = modalFooter.findAll('button').find((btn) => btn.text() === 'Delete');
    expect(confirmButton).toBeDefined();
    await confirmButton.trigger('click');
    await flushAll(wrapper);

    expect(deleteButtonFn).toHaveBeenCalledWith('test-project', '1');
  });

  describe('snapshot-on-mount fetching', () => {
    it('calls fetchButtons and fetchLatestRunsForProject on mount', async () => {
      const mockStore = makeStore({ buttons: [] });
      vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

      mount(CommandButtonsPanel, {
        props: { projectId: 'test-project' },
        global: { stubs: { RouterLink: true } },
      });
      await flushPromises();

      expect(mockStore.fetchButtons).toHaveBeenCalledWith('test-project');
      expect(mockStore.fetchLatestRunsForProject).toHaveBeenCalledWith('test-project');
    });
  });

  describe('Last Started / Last Ended columns', () => {
    it('renders the new header cells', async () => {
      const mockStore = makeStore({
        buttons: [{ id: '1', label: 'X', command: 'true', sortOrder: 0 }],
      });
      vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

      const wrapper = mount(CommandButtonsPanel, {
        props: { projectId: 'test-project' },
        global: { stubs: { RouterLink: true } },
      });

      const header = wrapper.find('.table-header');
      expect(header.text()).toContain('Last Started');
      expect(header.text()).toContain('Last Ended');
    });

    it('renders em-dash when the button has no matching run', async () => {
      const mockStore = makeStore({
        buttons: [{ id: 'b1', label: 'X', command: 'true', sortOrder: 0 }],
        _runsByButton: {}, // no runs
      });
      vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

      const wrapper = mount(CommandButtonsPanel, {
        props: { projectId: 'test-project' },
        global: { stubs: { RouterLink: true } },
      });

      const row = wrapper.findAll('.table-row')[0];
      expect(row.find('.col-started').text()).toBe('\u2014');
      expect(row.find('.col-ended').text()).toBe('\u2014');
    });

    it('renders formatted times when a matching run exists', async () => {
      const startedAt = new Date(2026, 0, 1, 14, 32, 5).getTime();
      const completedAt = startedAt + 42_000;
      const mockStore = makeStore({
        buttons: [{ id: 'b1', label: 'X', command: 'true', sortOrder: 0 }],
        _runsByButton: {
          b1: {
            runId: 'r1',
            buttonId: 'b1',
            sessionId: 's1',
            status: 'success',
            startedAt,
            completedAt,
            exitCode: 0,
          },
        },
      });
      vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

      const wrapper = mount(CommandButtonsPanel, {
        props: { projectId: 'test-project' },
        global: { stubs: { RouterLink: true } },
      });

      const row = wrapper.findAll('.table-row')[0];
      // Match "HH:MM:SS" — locale-stable format.
      expect(row.find('.col-started').text()).toMatch(/\d{2}:\d{2}:\d{2}/);
      expect(row.find('.col-ended').text()).toMatch(/\d{2}:\d{2}:\d{2}/);
      // <time> elements must carry accessibility attributes.
      expect(row.find('.col-started time').attributes('datetime')).toBeTruthy();
      expect(row.find('.col-started time').attributes('title')).toBeTruthy();
      expect(row.find('.col-started time').attributes('aria-label')).toContain('Last started');
      expect(row.find('.col-ended time').attributes('aria-label')).toContain('Last ended');
    });

    it('renders six cells per row (three original + two timestamp + actions)', async () => {
      const mockStore = makeStore({
        buttons: [{ id: 'b1', label: 'X', command: 'true', sortOrder: 0 }],
      });
      vi.mocked(useCommandButtonsStore).mockReturnValue(mockStore);

      const wrapper = mount(CommandButtonsPanel, {
        props: { projectId: 'test-project' },
        global: { stubs: { RouterLink: true } },
      });

      const header = wrapper.find('.table-header');
      expect(header.element.children.length).toBe(6);
      const row = wrapper.find('.table-row');
      expect(row.element.children.length).toBe(6);
    });
  });
});
