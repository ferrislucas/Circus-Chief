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
    resolvePromise({ staged: '', unstaged: '' });
    await flushPromises();
  });

  it('fetches changes on mount', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '' });

    mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    expect(api.getSessionChanges).toHaveBeenCalledWith('test-session');
  });

  it('displays staged changes when present', async () => {
    api.getSessionChanges.mockResolvedValue({
      staged: 'diff --git a/file.js\n+new line',
      unstaged: '',
    });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Staged Changes');
    expect(wrapper.text()).toContain('diff --git a/file.js');
    expect(wrapper.text()).toContain('+new line');
  });

  it('displays unstaged changes when present', async () => {
    api.getSessionChanges.mockResolvedValue({
      staged: '',
      unstaged: 'diff --git b/other.js\n-removed line',
    });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Unstaged Changes');
    expect(wrapper.text()).toContain('diff --git b/other.js');
    expect(wrapper.text()).toContain('-removed line');
  });

  it('displays both staged and unstaged changes', async () => {
    api.getSessionChanges.mockResolvedValue({
      staged: 'staged content',
      unstaged: 'unstaged content',
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
    api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '' });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('No git changes to show');
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
    api.getSessionChanges.mockResolvedValue({ staged: '', unstaged: '' });

    mount(ChangesTab, {
      props: { sessionId: 'custom-session-id' },
    });

    await flushPromises();

    expect(api.getSessionChanges).toHaveBeenCalledWith('custom-session-id');
  });

  it('handles null staged/unstaged values', async () => {
    api.getSessionChanges.mockResolvedValue({ staged: null, unstaged: null });

    const wrapper = mount(ChangesTab, {
      props: { sessionId: 'test-session' },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('No git changes to show');
  });
});
