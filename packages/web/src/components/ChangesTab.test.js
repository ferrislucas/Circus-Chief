import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ChangesTab from './ChangesTab.vue';
import { api } from '../api/ApiClient.js';

vi.mock('../api/ApiClient.js', () => ({
  api: {
    getSessionChanges: vi.fn(),
  },
}));

describe('ChangesTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows loading state while fetching', async () => {
    let resolvePromise;
    api.getSessionChanges.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    // Wait for component to update after onMounted sets loading = true
    await nextTick();

    expect(wrapper.text()).toContain('Loading changes...');

    // Clean up by resolving the promise
    resolvePromise({ staged: '', unstaged: '', untracked: [] });
    await flushPromises();
  });

  it('fetches changes on mount', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: [] });

    mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    expect(api.getSessionChanges).toHaveBeenCalledWith('test-session');
  });

  it('displays staged changes when present', async () => {
    api.getSessionChanges.mockResolvedValue({
      staged: `diff --git a/file.js b/file.js
index 1234567..abcdefg 100644
--- a/file.js
+++ b/file.js
@@ -1,3 +1,4 @@
 const x = 1;
+const newLine = 2;
 const y = 3;`,
      unstaged: '',
      untracked: [],
    });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Staged Changes');
    expect(wrapper.text()).toContain('file.js');
    expect(wrapper.text()).toContain('const newLine = 2;');
  });

  it('displays unstaged changes when present', async () => {
    api.getSessionChanges.mockResolvedValue({
      staged: '',
      unstaged: `diff --git a/other.js b/other.js
index 1234567..abcdefg 100644
--- a/other.js
+++ b/other.js
@@ -1,4 +1,3 @@
 const a = 1;
-const removedLine = 2;
 const b = 3;`,
      untracked: [],
    });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Unstaged Changes');
    expect(wrapper.text()).toContain('other.js');
    expect(wrapper.text()).toContain('const removedLine = 2;');
  });

  it('displays both staged and unstaged changes', async () => {
    api.getSessionChanges.mockResolvedValue({
      staged: `diff --git a/staged.js b/staged.js
index 1234567..abcdefg 100644
--- a/staged.js
+++ b/staged.js
@@ -1,2 +1,3 @@
 const x = 1;
+const stagedLine = 2;`,
      unstaged: `diff --git a/unstaged.js b/unstaged.js
index 1234567..abcdefg 100644
--- a/unstaged.js
+++ b/unstaged.js
@@ -1,2 +1,3 @@
 const a = 1;
+const unstagedLine = 2;`,
      untracked: [],
    });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Staged Changes');
    expect(wrapper.text()).toContain('staged.js');
    expect(wrapper.text()).toContain('Unstaged Changes');
    expect(wrapper.text()).toContain('unstaged.js');
  });

  it('displays empty state when no changes', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: [] });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('No git changes to show');
  });

  it('displays untracked files when present', async () => {
    api.getSessionChanges.mockResolvedValue({
      staged: '',
      unstaged: '',
      untracked: ['new-file.txt', 'another-file.js'],
    });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Untracked Files');
    expect(wrapper.text()).toContain('new-file.txt');
    expect(wrapper.text()).toContain('another-file.js');
  });

  it('displays error message on failure', async () => {
    api.getSessionChanges.mockRejectedValue(new Error('Network error'));

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Network error');
  });

  it('uses sessionId prop for API call', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: [] });

    mount(ChangesTab, {
      props: { sessionId: 'custom-session-id' },
    });

    await flushPromises();

    expect(api.getSessionChanges).toHaveBeenCalledWith('custom-session-id');
  });

  it('handles null staged/unstaged values', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: null, unstaged: null, untracked: null });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('No git changes to show');
  });
});
