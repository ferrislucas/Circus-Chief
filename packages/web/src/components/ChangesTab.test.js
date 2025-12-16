import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import ChangesTab from './ChangesTab.vue';
import { api } from '../api/ApiClient.js';

vi.mock('../api/ApiClient.js', () => ({
  api: {
    getSessionChanges: vi.fn(),
    getSessionFile: vi.fn(),
  },
}));

// Mock md-editor-v3 since it doesn't work in vitest
vi.mock('md-editor-v3', () => ({
  MdPreview: {
    name: 'MdPreview',
    props: ['modelValue', 'theme', 'previewTheme', 'showCodeRowNumber'],
    template: '<div class="mock-md-preview">{{ modelValue }}</div>',
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
      staged: 'diff --git a/file.js b/file.js\n+new line',
      unstaged: '',
      untracked: [],
    });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Staged Changes');
    expect(wrapper.text()).toContain('file.js');
    expect(wrapper.text()).toContain('+new line');
  });

  it('displays unstaged changes when present', async () => {
    api.getSessionChanges.mockResolvedValue({
      staged: '',
      unstaged: 'diff --git a/other.js b/other.js\n-removed line',
      untracked: [],
    });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Unstaged Changes');
    expect(wrapper.text()).toContain('other.js');
    expect(wrapper.text()).toContain('-removed line');
  });

  it('displays both staged and unstaged changes', async () => {
    api.getSessionChanges.mockResolvedValue({
      staged: 'diff --git a/staged.js b/staged.js\nstaged content',
      unstaged: 'diff --git a/unstaged.js b/unstaged.js\nunstaged content',
      untracked: [],
    });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Staged Changes');
    expect(wrapper.text()).toContain('staged content');
    expect(wrapper.text()).toContain('Unstaged Changes');
    expect(wrapper.text()).toContain('unstaged content');
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

  describe('Markdown Preview', () => {
    it('shows preview button for markdown files in staged changes', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: 'diff --git a/README.md b/README.md\n+# Hello',
        unstaged: '',
        untracked: [],
      });

      const wrapper = mount(ChangesTab, {
        props: { sessionId: 'test-session' },
      });

      await flushPromises();

      const previewButton = wrapper.find('.preview-toggle');
      expect(previewButton.exists()).toBe(true);
      expect(previewButton.text()).toBe('Preview');
    });

    it('does not show preview button for non-markdown files', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: 'diff --git a/file.js b/file.js\n+console.log("hello")',
        unstaged: '',
        untracked: [],
      });

      const wrapper = mount(ChangesTab, {
        props: { sessionId: 'test-session' },
      });

      await flushPromises();

      const previewButton = wrapper.find('.preview-toggle');
      expect(previewButton.exists()).toBe(false);
    });

    it('shows preview button for untracked markdown files', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: ['docs/guide.md', 'src/index.js'],
      });

      const wrapper = mount(ChangesTab, {
        props: { sessionId: 'test-session' },
      });

      await flushPromises();

      const previewButtons = wrapper.findAll('.preview-toggle');
      expect(previewButtons.length).toBe(1); // Only one for the .md file
    });

    it('toggles preview when button is clicked', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: 'diff --git a/README.md b/README.md\n+# Hello',
        unstaged: '',
        untracked: [],
      });
      api.getSessionFile.mockResolvedValue({ content: '# Hello World', path: 'README.md' });

      const wrapper = mount(ChangesTab, {
        props: { sessionId: 'test-session' },
      });

      await flushPromises();

      const previewButton = wrapper.find('.preview-toggle');
      expect(previewButton.text()).toBe('Preview');

      await previewButton.trigger('click');
      await flushPromises();

      expect(api.getSessionFile).toHaveBeenCalledWith('test-session', 'README.md');
      expect(previewButton.text()).toBe('Show Diff');
    });

    it('shows markdown preview content after fetching', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: 'diff --git a/README.md b/README.md\n+# Hello',
        unstaged: '',
        untracked: [],
      });
      api.getSessionFile.mockResolvedValue({ content: '# Hello World', path: 'README.md' });

      const wrapper = mount(ChangesTab, {
        props: { sessionId: 'test-session' },
      });

      await flushPromises();

      await wrapper.find('.preview-toggle').trigger('click');
      await flushPromises();

      expect(wrapper.find('.mock-md-preview').exists()).toBe(true);
      expect(wrapper.find('.mock-md-preview').text()).toBe('# Hello World');
    });

    it('shows loading state while fetching preview', async () => {
      let resolveFile;
      api.getSessionChanges.mockResolvedValue({
        staged: 'diff --git a/README.md b/README.md\n+# Hello',
        unstaged: '',
        untracked: [],
      });
      api.getSessionFile.mockReturnValue(
        new Promise((resolve) => {
          resolveFile = resolve;
        })
      );

      const wrapper = mount(ChangesTab, {
        props: { sessionId: 'test-session' },
      });

      await flushPromises();

      await wrapper.find('.preview-toggle').trigger('click');
      await nextTick();

      expect(wrapper.find('.preview-loading').exists()).toBe(true);
      expect(wrapper.text()).toContain('Loading preview...');

      resolveFile({ content: '# Hello', path: 'README.md' });
      await flushPromises();
    });

    it('shows error when preview fetch fails', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: 'diff --git a/README.md b/README.md\n+# Hello',
        unstaged: '',
        untracked: [],
      });
      api.getSessionFile.mockRejectedValue(new Error('File not found'));

      const wrapper = mount(ChangesTab, {
        props: { sessionId: 'test-session' },
      });

      await flushPromises();

      await wrapper.find('.preview-toggle').trigger('click');
      await flushPromises();

      expect(wrapper.find('.preview-error').exists()).toBe(true);
      expect(wrapper.text()).toContain('File not found');
    });

    it('recognizes various markdown extensions', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: ['file.md', 'file.markdown', 'file.mdx', 'file.MD'],
      });

      const wrapper = mount(ChangesTab, {
        props: { sessionId: 'test-session' },
      });

      await flushPromises();

      const previewButtons = wrapper.findAll('.preview-toggle');
      expect(previewButtons.length).toBe(4); // All should have preview button
    });

    it('caches preview content on subsequent toggles', async () => {
      api.getSessionChanges.mockResolvedValue({
        staged: 'diff --git a/README.md b/README.md\n+# Hello',
        unstaged: '',
        untracked: [],
      });
      api.getSessionFile.mockResolvedValue({ content: '# Cached', path: 'README.md' });

      const wrapper = mount(ChangesTab, {
        props: { sessionId: 'test-session' },
      });

      await flushPromises();

      const previewButton = wrapper.find('.preview-toggle');

      // First click - should fetch
      await previewButton.trigger('click');
      await flushPromises();
      expect(api.getSessionFile).toHaveBeenCalledTimes(1);

      // Toggle back to diff
      await previewButton.trigger('click');
      await flushPromises();

      // Toggle to preview again - should not fetch again
      await previewButton.trigger('click');
      await flushPromises();
      expect(api.getSessionFile).toHaveBeenCalledTimes(1); // Still 1
    });
  });
});
