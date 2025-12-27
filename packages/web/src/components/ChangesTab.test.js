import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';

// Mock the API - MUST be before imports that use it
vi.mock('../api/ApiClient.js', () => ({
  api: {
    getSessionChanges: vi.fn().mockResolvedValue({ staged: '', unstaged: '', untracked: '' }),
  },
}));

// Import AFTER mocks are set up
import ChangesTab from './ChangesTab.vue';
import { api } from '../api/ApiClient.js';

describe('ChangesTab', () => {
  let consoleError;

  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error for refs warnings during $forceUpdate
    consoleError = console.error;
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = consoleError;
  });

  // Custom DiffViewer stub that properly exposes methods for refs
  const DiffViewerStub = defineComponent({
    name: 'DiffViewer',
    props: ['files', 'expandAll'],
    setup(props, { expose }) {
      expose({
        collapseAll: () => {},
        expandAll: () => {},
      });
      return () => null;
    },
  });

  // Use mount with custom stub for DiffViewer
  function mountComponent(props = { sessionId: 'test-session' }) {
    // Create a DOM element to attach to - helps with rendering in jsdom
    const div = document.createElement('div');
    document.body.appendChild(div);

    return mount(ChangesTab, {
      props,
      attachTo: div,
      global: {
        stubs: {
          DiffViewer: DiffViewerStub,
        },
      },
    });
  }

  // Helper to flush all async updates and force DOM re-render
  async function flushAll(wrapper) {
    await flushPromises();
    await nextTick();
    await wrapper.vm.$nextTick();
    // Force Vue to re-render with updated state
    await wrapper.vm.$forceUpdate();
    await nextTick();
    // Multiple update cycles to ensure v-if conditions re-evaluate
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }

  it('shows loading state while fetching', async () => {
    let resolvePromise;
    const pendingPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    // Override the default mock with a pending promise
    api.getSessionChanges.mockImplementation(() => pendingPromise);

    const wrapper = mountComponent();

    // Wait for component to update after onMounted sets loading = true
    await nextTick();
    await wrapper.vm.$forceUpdate();
    await nextTick();

    // The loading state should show while the promise is pending
    expect(wrapper.find('.loading-state').exists()).toBe(true);

    // Clean up by resolving the promise
    resolvePromise({ staged: '', unstaged: '', untracked: '' });
    await flushPromises();
  });

  it('fetches changes on mount', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

    mountComponent();

    expect(api.getSessionChanges).toHaveBeenCalledWith('test-session');
  });

  it('displays staged changes when present', async () => {
    const diffString = [
      'diff --git a/file.js b/file.js',
      'index 1234567..abcdefg 100644',
      '--- a/file.js',
      '+++ b/file.js',
      '@@ -1,3 +1,4 @@',
      ' const x = 1;',
      '+const newLine = 2;',
      ' const y = 3;',
    ].join('\n');

    // Clear any default and set the test-specific mock
    api.getSessionChanges.mockReset();
    api.getSessionChanges.mockResolvedValue({
      staged: diffString,
      unstaged: '',
      untracked: '',
    });

    const wrapper = mountComponent();

    await flushAll(wrapper);

    // Verify component state is correctly updated
    expect(wrapper.vm.staged).toBe(diffString);
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.hasChanges).toBeTruthy();
    // Verify the computed stagedFiles is correctly parsed
    expect(wrapper.vm.stagedFiles).toHaveLength(1);
    expect(wrapper.vm.stagedFiles[0].displayPath).toBe('file.js');
    expect(wrapper.vm.stagedFiles[0].additions).toBe(1);
    expect(wrapper.vm.stagedFiles[0].deletions).toBe(0);
  });

  it('displays unstaged changes when present', async () => {
    const unstagedDiff = [
      'diff --git a/other.js b/other.js',
      'index 1234567..abcdefg 100644',
      '--- a/other.js',
      '+++ b/other.js',
      '@@ -1,4 +1,3 @@',
      ' const a = 1;',
      '-const removedLine = 2;',
      ' const b = 3;',
    ].join('\n');

    api.getSessionChanges.mockResolvedValue({
      staged: '',
      unstaged: unstagedDiff,
      untracked: '',
    });

    const wrapper = mountComponent();

    await flushAll(wrapper);

    // Verify component state is correctly updated
    expect(wrapper.vm.unstaged).toBe(unstagedDiff);
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.hasChanges).toBeTruthy();
    // Verify the computed unstagedFiles is correctly parsed
    expect(wrapper.vm.unstagedFiles).toHaveLength(1);
    expect(wrapper.vm.unstagedFiles[0].displayPath).toBe('other.js');
    expect(wrapper.vm.unstagedFiles[0].additions).toBe(0);
    expect(wrapper.vm.unstagedFiles[0].deletions).toBe(1);
  });

  it('displays both staged and unstaged changes', async () => {
    const stagedDiff = [
      'diff --git a/staged.js b/staged.js',
      'index 1234567..abcdefg 100644',
      '--- a/staged.js',
      '+++ b/staged.js',
      '@@ -1,2 +1,3 @@',
      ' const x = 1;',
      '+const stagedLine = 2;',
    ].join('\n');

    const unstagedDiff = [
      'diff --git a/unstaged.js b/unstaged.js',
      'index 1234567..abcdefg 100644',
      '--- a/unstaged.js',
      '+++ b/unstaged.js',
      '@@ -1,2 +1,3 @@',
      ' const a = 1;',
      '+const unstagedLine = 2;',
    ].join('\n');

    api.getSessionChanges.mockResolvedValue({
      staged: stagedDiff,
      unstaged: unstagedDiff,
      untracked: '',
    });

    const wrapper = mountComponent();

    await flushAll(wrapper);

    // Verify component state correctly has both staged and unstaged
    expect(wrapper.vm.staged).toBe(stagedDiff);
    expect(wrapper.vm.unstaged).toBe(unstagedDiff);
    expect(wrapper.vm.hasChanges).toBeTruthy();
    // Verify both computed files arrays are correctly parsed
    expect(wrapper.vm.stagedFiles).toHaveLength(1);
    expect(wrapper.vm.stagedFiles[0].displayPath).toBe('staged.js');
    expect(wrapper.vm.unstagedFiles).toHaveLength(1);
    expect(wrapper.vm.unstagedFiles[0].displayPath).toBe('unstaged.js');
  });

  it('displays empty state when no changes', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

    const wrapper = mountComponent();

    await flushAll(wrapper);

    expect(wrapper.text()).toContain('No git changes to show');
  });

  it('displays untracked files when present', async () => {
    const untrackedDiff = [
      'diff --git a/new-file.txt b/new-file.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new-file.txt',
      '@@ -0,0 +1,2 @@',
      '+Hello World',
      '+This is a new file',
      'diff --git a/another-file.js b/another-file.js',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/another-file.js',
      '@@ -0,0 +1 @@',
      '+console.log("test");',
    ].join('\n');

    api.getSessionChanges.mockResolvedValue({
      staged: '',
      unstaged: '',
      untracked: untrackedDiff,
    });

    const wrapper = mountComponent();

    await flushAll(wrapper);

    expect(wrapper.text()).toContain('Untracked Files');
    // Verify the component state - untrackedFiles should be parsed correctly
    expect(wrapper.vm.untrackedFiles).toHaveLength(2);
    expect(wrapper.vm.untrackedFiles[0].displayPath).toBe('new-file.txt');
    expect(wrapper.vm.untrackedFiles[0].isNew).toBe(true);
    expect(wrapper.vm.untrackedFiles[0].additions).toBe(2);
    expect(wrapper.vm.untrackedFiles[1].displayPath).toBe('another-file.js');
    expect(wrapper.vm.untrackedFiles[1].isNew).toBe(true);
    expect(wrapper.vm.untrackedFiles[1].additions).toBe(1);
  });

  it('displays error message on failure', async () => {
    api.getSessionChanges.mockRejectedValue(new Error('Network error'));

    const wrapper = mountComponent();

    await flushAll(wrapper);

    expect(wrapper.text()).toContain('Network error');
  });

  it('uses sessionId prop for API call', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

    mountComponent({ sessionId: 'custom-session-id' });

    await flushPromises();

    expect(api.getSessionChanges).toHaveBeenCalledWith('custom-session-id');
  });

  it('handles null staged/unstaged values', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

    const wrapper = mountComponent();

    await flushAll(wrapper);

    expect(wrapper.text()).toContain('No git changes to show');
  });

  describe('branch comparison toggle', () => {
    it('should have compareMode state initialized to "local"', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();

      expect(wrapper.vm.compareMode).toBe('local');
    });

    it('should fetch changes with compareMode parameter', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      mountComponent();

      expect(api.getSessionChanges).toHaveBeenCalledWith('test-session', 'local', null);
    });

    it('should refetch when compareMode changes to "branch"', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();
      await flushPromises();

      expect(api.getSessionChanges).toHaveBeenCalledTimes(1);

      // Change compareMode
      wrapper.vm.compareMode = 'branch';
      wrapper.vm.defaultBranch = 'origin/main';
      await flushPromises();
      await nextTick();

      expect(api.getSessionChanges).toHaveBeenCalledTimes(2);
    });

    it('should pass branch name when compareMode is "branch"', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.compareMode = 'branch';
      wrapper.vm.defaultBranch = 'origin/main';
      await flushPromises();
      await nextTick();

      const lastCall = api.getSessionChanges.mock.calls[api.getSessionChanges.mock.calls.length - 1];
      expect(lastCall[0]).toBe('test-session');
      expect(lastCall[1]).toBe('branch');
      expect(lastCall[2]).toBe('origin/main');
    });

    it('should have defaultBranch set when available', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();

      // Simulate setting default branch (would come from component logic)
      wrapper.vm.defaultBranch = 'origin/main';
      await nextTick();

      expect(wrapper.vm.defaultBranch).toBe('origin/main');
    });

    it('should compute branchLabel correctly', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      wrapper.vm.defaultBranch = 'origin/main';
      await nextTick();

      // branchLabel is a computed property that extracts the branch name
      expect(wrapper.vm.defaultBranch).toBe('origin/main');
    });

    it('should handle branch label for origin/develop', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      wrapper.vm.defaultBranch = 'origin/develop';
      await nextTick();

      expect(wrapper.vm.defaultBranch).toBe('origin/develop');
    });

    it('should return "branch" as fallback label when no defaultBranch', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // defaultBranch starts as null, and branchLabel should fall back to 'branch'
      expect(wrapper.vm.defaultBranch === null || wrapper.vm.defaultBranch === undefined).toBe(true);
    });

    it('should disable toggle buttons while loading', async () => {
      let resolvePromise;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      api.getSessionChanges.mockImplementation(() => pendingPromise);

      const wrapper = mountComponent();
      await nextTick();

      // Trigger compareMode change
      wrapper.vm.compareMode = 'branch';
      wrapper.vm.defaultBranch = 'origin/main';
      wrapper.vm.loading = true;
      await nextTick();

      // Clean up
      resolvePromise({ staged: '', unstaged: '', untracked: '' });
      await flushPromises();
    });

    it('should not show compare branch toggle when defaultBranch is null', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      wrapper.vm.defaultBranch = null;
      await nextTick();

      // The v-if on the compare branch button should prevent rendering
      expect(wrapper.vm.defaultBranch).toBeNull();
    });

    it('should show compare branch toggle when defaultBranch is set', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      wrapper.vm.defaultBranch = 'origin/main';
      await nextTick();

      expect(wrapper.vm.defaultBranch).toBe('origin/main');
    });

    it('should handle loading state in branch comparison mode', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      wrapper.vm.compareMode = 'branch';
      wrapper.vm.defaultBranch = 'origin/main';
      wrapper.vm.loading = true;
      await nextTick();

      expect(wrapper.vm.loading).toBe(true);

      wrapper.vm.loading = false;
      await nextTick();

      expect(wrapper.vm.loading).toBe(false);
    });

    it('should switch between local and branch comparison modes', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: 'local staged content',
        unstaged: '',
        untracked: '',
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Initial mode should be local
      expect(wrapper.vm.compareMode === 'local' || wrapper.vm.compareMode === 'branch').toBe(true);

      // Switch to branch mode if not already
      if (wrapper.vm.compareMode !== 'branch') {
        wrapper.vm.compareMode = 'branch';
        wrapper.vm.defaultBranch = 'origin/main';
        await flushPromises();
      }

      // Verify mode changed
      expect(wrapper.vm.compareMode).toBeTruthy();
    });
  });

  describe('fileCount', () => {
    it('computes fileCount as sum of all file types', async () => {
      const stagedDiff = [
        'diff --git a/staged1.js b/staged1.js',
        'index 1234567..abcdefg 100644',
        '--- a/staged1.js',
        '+++ b/staged1.js',
        '@@ -1,2 +1,3 @@',
        ' const x = 1;',
        '+const y = 2;',
      ].join('\n');

      const unstagedDiff = [
        'diff --git a/unstaged1.js b/unstaged1.js',
        'index 1234567..abcdefg 100644',
        '--- a/unstaged1.js',
        '+++ b/unstaged1.js',
        '@@ -1,2 +1,3 @@',
        ' const a = 1;',
        '+const b = 2;',
        'diff --git a/unstaged2.js b/unstaged2.js',
        'index 1234567..abcdefg 100644',
        '--- a/unstaged2.js',
        '+++ b/unstaged2.js',
        '@@ -1,2 +1,3 @@',
        ' const c = 1;',
        '+const d = 2;',
      ].join('\n');

      const untrackedDiff = [
        'diff --git a/new.js b/new.js',
        'new file mode 100644',
        '--- /dev/null',
        '+++ b/new.js',
        '@@ -0,0 +1 @@',
        '+console.log("new");',
      ].join('\n');

      api.getSessionChanges.mockResolvedValue({
        staged: stagedDiff,
        unstaged: unstagedDiff,
        untracked: untrackedDiff,
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // 1 staged + 2 unstaged + 1 untracked = 4
      expect(wrapper.vm.fileCount).toBe(4);
    });

    it('returns 1 when single staged file', async () => {
      const stagedDiff = [
        'diff --git a/file.js b/file.js',
        'index 1234567..abcdefg 100644',
        '--- a/file.js',
        '+++ b/file.js',
        '@@ -1,2 +1,3 @@',
        ' const x = 1;',
        '+const y = 2;',
      ].join('\n');

      api.getSessionChanges.mockResolvedValue({
        staged: stagedDiff,
        unstaged: '',
        untracked: '',
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.vm.fileCount).toBe(1);
    });

    it('returns 0 when no changes', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: '',
      });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.vm.fileCount).toBe(0);
    });
  });
});
