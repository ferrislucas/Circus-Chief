import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';

// Mock the API - MUST be before imports that use it
vi.mock('../api/ApiClient.js', () => ({
  api: {
    getSessionChanges: vi.fn().mockResolvedValue({ staged: '', unstaged: '', untracked: '' }),
    getSessionDefaultBranch: vi.fn().mockResolvedValue({ branch: null }),
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

    // Called with sessionId, compareMode ('local'), and branch (null)
    expect(api.getSessionChanges).toHaveBeenCalledWith('test-session', 'local', null);
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
    api.getSessionDefaultBranch.mockResolvedValue({ branch: null });

    const wrapper = mountComponent();

    await flushAll(wrapper);

    // Toolbar should NOT show when there are no changes and no defaultBranch
    expect(wrapper.find('.changes-toolbar').exists()).toBe(false);
    expect(wrapper.text()).toContain('No local git changes to show');
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

    // Wait for the async API call to complete and all Vue updates
    await flushPromises();
    await nextTick();
    await flushPromises(); // Extra flush for async response processing
    await flushAll(wrapper);

    // Verify the component state - untrackedFiles should be parsed correctly
    // This is the core functionality - parsing untracked files from diff output
    expect(wrapper.vm.untrackedFiles).toHaveLength(2);
    expect(wrapper.vm.untrackedFiles[0].displayPath).toBe('new-file.txt');
    expect(wrapper.vm.untrackedFiles[0].isNew).toBe(true);
    expect(wrapper.vm.untrackedFiles[0].additions).toBe(2);
    expect(wrapper.vm.untrackedFiles[1].displayPath).toBe('another-file.js');
    expect(wrapper.vm.untrackedFiles[1].isNew).toBe(true);
    expect(wrapper.vm.untrackedFiles[1].additions).toBe(1);

    // Verify hasChanges is truthy when untracked files are present
    expect(wrapper.vm.hasChanges).toBeTruthy();

    // Verify fileCount includes untracked files
    expect(wrapper.vm.fileCount).toBe(2);
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

    // Called with sessionId, compareMode ('local'), and branch (null)
    expect(api.getSessionChanges).toHaveBeenCalledWith('custom-session-id', 'local', null);
  });

  it('handles null staged/unstaged values', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });
    api.getSessionDefaultBranch.mockResolvedValue({ branch: null });

    const wrapper = mountComponent();

    await flushAll(wrapper);

    expect(wrapper.text()).toContain('No local git changes to show');
  });

  describe('branch comparison feature', () => {
    it('renders mode toggle buttons when changes are present', async () => {
      const stagedDiff = [
        'diff --git a/file.js b/file.js',
        'index 1234567..abcdefg 100644',
        '--- a/file.js',
        '+++ b/file.js',
        '@@ -1,2 +1,3 @@',
        ' const x = 1;',
        '+const y = 2;',
      ].join('\n');

      api.getSessionChanges.mockResolvedValue({ staged: stagedDiff, unstaged: '', untracked: '' });

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // The mode toggle should exist when there are changes
      expect(wrapper.find('.mode-toggle').exists()).toBe(true);
      expect(wrapper.text()).toContain('Local Changes');
    });

    it('has compareMode state defaulting to local', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // Verify compareMode ref exists and defaults to 'local'
      expect(wrapper.vm.compareMode).toBe('local');
    });

    it('has defaultBranch state', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // Verify defaultBranch ref exists (defaults to null)
      expect(wrapper.vm.defaultBranch).toBe(null);
    });

    it('has branchLabel computed property', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // Verify branchLabel computed exists (returns 'branch' when defaultBranch is null)
      expect(wrapper.vm.branchLabel).toBe('branch');
    });

    it('calls getSessionChanges with sessionId, compareMode, and branch', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      mountComponent({ sessionId: 'test-session' });

      await flushPromises();

      // Should call with sessionId, compareMode ('local'), and branch (null)
      expect(api.getSessionChanges).toHaveBeenCalledWith('test-session', 'local', null);
      expect(api.getSessionChanges).toHaveBeenCalledTimes(1);
    });

    it('passes compareMode and branch to API', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // Verify the API was called with all three parameters
      expect(api.getSessionChanges).toHaveBeenCalledWith('test-session', 'local', null);
      // Check the call signature - should have 3 arguments
      const calls = api.getSessionChanges.mock.calls;
      expect(calls[0]).toHaveLength(3); // sessionId, compareMode, branch
    });

    it('refetches on compareMode changes', async () => {
      const stagedDiff = [
        'diff --git a/file.js b/file.js',
        'index 1234567..abcdefg 100644',
        '--- a/file.js',
        '+++ b/file.js',
        '@@ -1,2 +1,3 @@',
        ' const x = 1;',
        '+const y = 2;',
      ].join('\n');

      api.getSessionChanges.mockResolvedValue({ staged: stagedDiff, unstaged: '', untracked: '' });

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // Clear the mock to verify additional calls are made
      api.getSessionChanges.mockClear();
      api.getSessionChanges.mockResolvedValue({ staged: stagedDiff, unstaged: '', untracked: '' });

      // Change the compareMode
      wrapper.vm.compareMode = 'branch';
      await flushAll(wrapper);

      // Additional API call should be made with new compareMode
      expect(api.getSessionChanges).toHaveBeenCalledWith('test-session', 'branch', null);
      expect(api.getSessionChanges).toHaveBeenCalledTimes(1);
    });

    it('toolbar shows mode toggle when there are changes', async () => {
      const stagedDiff = [
        'diff --git a/file.js b/file.js',
        'index 1234567..abcdefg 100644',
        '--- a/file.js',
        '+++ b/file.js',
        '@@ -1,2 +1,3 @@',
        ' const x = 1;',
        '+const y = 2;',
      ].join('\n');

      api.getSessionChanges.mockResolvedValue({ staged: stagedDiff, unstaged: '', untracked: '' });

      const wrapper = mountComponent();

      await flushAll(wrapper);

      const toolbar = wrapper.find('.changes-toolbar');
      expect(toolbar.exists()).toBe(true);

      // Should have mode toggle buttons + Expand/Collapse button
      const buttons = toolbar.findAll('button');
      // At least 2 buttons: Local Changes + Expand/Collapse All
      // (Compare to branch button only shows if defaultBranch is set)
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      expect(toolbar.text()).toContain('Local Changes');
      expect(toolbar.text()).toMatch(/Expand All|Collapse All/);
    });

    it('computes branchLabel from defaultBranch', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Set defaultBranch to 'origin/main'
      wrapper.vm.defaultBranch = 'origin/main';
      await nextTick();

      expect(wrapper.vm.branchLabel).toBe('main');

      // Set defaultBranch to 'origin/master'
      wrapper.vm.defaultBranch = 'origin/master';
      await nextTick();

      expect(wrapper.vm.branchLabel).toBe('master');
    });

    it('shows toolbar with compare button when no local changes but defaultBranch exists', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });
      api.getSessionDefaultBranch.mockResolvedValue({ branch: 'origin/main' });

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // Toolbar should show when there's a defaultBranch, even without local changes
      const toolbar = wrapper.find('.changes-toolbar');
      expect(toolbar.exists()).toBe(true);

      // Should have both mode toggle buttons
      const buttons = toolbar.findAll('button');
      expect(buttons.length).toBeGreaterThanOrEqual(2);
      expect(toolbar.text()).toContain('Local Changes');
      expect(toolbar.text()).toContain('Compare to main');

      // Should NOT show the Expand/Collapse button when there are no changes
      expect(toolbar.text()).not.toContain('Expand All');
      expect(toolbar.text()).not.toContain('Collapse All');
    });

    it('allows switching to branch compare mode when no local changes', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });
      api.getSessionDefaultBranch.mockResolvedValue({ branch: 'origin/main' });

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // Clear the mock to track the new call
      api.getSessionChanges.mockClear();
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      // Click the "Compare to main" button
      const compareButton = wrapper.findAll('.toggle-button')[1];
      await compareButton.trigger('click');
      await flushAll(wrapper);

      // Should have called API with 'branch' compare mode
      expect(api.getSessionChanges).toHaveBeenCalledWith('test-session', 'branch', 'origin/main');
      expect(wrapper.vm.compareMode).toBe('branch');
    });

    it('displays mode-aware empty state message', async () => {
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });
      api.getSessionDefaultBranch.mockResolvedValue({ branch: 'origin/main' });

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // Start in local mode
      expect(wrapper.vm.compareMode).toBe('local');
      expect(wrapper.text()).toContain('No local git changes to show');

      // Clear the mock and switch to branch mode
      api.getSessionChanges.mockClear();
      api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      wrapper.vm.compareMode = 'branch';
      await flushAll(wrapper);

      // Empty message should change for branch mode
      expect(wrapper.text()).toContain('No differences from main');
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
