import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';

// Mock the API module
vi.mock('../composables/useApi.js', () => ({
  api: {
    getCanvasItems: vi.fn(),
    getCanvasTrash: vi.fn(),
    recoverCanvasItem: vi.fn(),
    recoverCanvasFile: vi.fn(),
    permanentlyDeleteCanvasItem: vi.fn(),
  },
}));

import CanvasTrash from './CanvasTrash.vue';
import { api } from '../composables/useApi.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useUiStore } from '../stores/ui.js';

// Global helper to flush all async updates
async function flushAll(wrapper) {
  await flushPromises();
  await nextTick();
  if (wrapper && wrapper.vm) {
    await wrapper.vm.$nextTick?.();
    await wrapper.vm.$forceUpdate();
    await nextTick();
  }
}

describe('CanvasTrash', () => {
  let canvasStore;
  let uiStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    canvasStore = useCanvasStore();
    uiStore = useUiStore();
    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  function mountComponent(props = { sessionId: 'test-session' }) {
    return mount(CanvasTrash, {
      props,
    });
  }

  describe('rendering', () => {
    it('shows loading spinner while fetching', async () => {
      let resolvePromise;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      api.getCanvasTrash.mockReturnValue(pendingPromise);

      const wrapper = mountComponent();

      expect(wrapper.find('.loading-state').exists()).toBe(true);
      expect(wrapper.text()).toContain('Loading trash');

      // Cleanup
      resolvePromise([]);
      await flushPromises();
    });

    it('shows empty state when trash is empty', async () => {
      api.getCanvasTrash.mockResolvedValue([]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.text()).toContain('Trash is empty');
    });

    it('renders list of grouped trashed items', async () => {
      api.getCanvasTrash.mockResolvedValue([
        { id: '1', filename: 'deleted.png', type: 'image', deletedAt: Date.now() - 1000 },
        { id: '2', filename: 'removed.txt', type: 'text', deletedAt: Date.now() - 2000 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const rows = wrapper.findAll('.trash-row');
      expect(rows).toHaveLength(2);
    });

    it('displays version count for each file', async () => {
      api.getCanvasTrash.mockResolvedValue([
        { id: '1', filename: 'multi.txt', type: 'text', deletedAt: Date.now() - 1000 },
        { id: '2', filename: 'multi.txt', type: 'text', deletedAt: Date.now() - 2000 },
        { id: '3', filename: 'multi.txt', type: 'text', deletedAt: Date.now() - 3000 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Should be grouped into 1 row with 3 versions
      const rows = wrapper.findAll('.trash-row');
      expect(rows).toHaveLength(1);
      expect(wrapper.text()).toContain('3 versions');
    });

    it('displays correct type icons', async () => {
      api.getCanvasTrash.mockResolvedValue([
        { id: '1', filename: 'test.png', type: 'image', deletedAt: Date.now() },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('.file-icon').text()).toContain('📷');
    });
  });

  describe('actions', () => {
    it('recover button calls recoverFile with filename', async () => {
      api.getCanvasTrash.mockResolvedValue([
        { id: '1', filename: 'recover.txt', type: 'text', deletedAt: Date.now() },
      ]);
      api.recoverCanvasFile.mockResolvedValue({ recovered: 1 });
      api.getCanvasItems.mockResolvedValue([]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const recoverButton = wrapper.find('.btn-success');
      await recoverButton.trigger('click');
      await flushAll(wrapper);

      expect(api.recoverCanvasFile).toHaveBeenCalledWith('test-session', 'recover.txt');
    });

    it('permanent delete shows confirmation dialog', async () => {
      api.getCanvasTrash.mockResolvedValue([
        { id: '1', filename: 'delete.txt', type: 'text', deletedAt: Date.now() },
      ]);
      api.permanentlyDeleteCanvasItem.mockResolvedValue();

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const deleteButton = wrapper.find('.btn-danger');
      await deleteButton.trigger('click');
      await flushAll(wrapper);

      expect(window.confirm).toHaveBeenCalled();
    });

    it('permanent delete removes all versions', async () => {
      const now = Date.now();
      api.getCanvasTrash.mockResolvedValue([
        { id: '1', filename: 'multi.txt', type: 'text', deletedAt: now - 1000 },
        { id: '2', filename: 'multi.txt', type: 'text', deletedAt: now - 2000 },
      ]);
      api.permanentlyDeleteCanvasItem.mockResolvedValue();

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const deleteButton = wrapper.find('.btn-danger');
      await deleteButton.trigger('click');
      await flushAll(wrapper);

      // Should delete both versions
      expect(api.permanentlyDeleteCanvasItem).toHaveBeenCalledTimes(2);
      expect(api.permanentlyDeleteCanvasItem).toHaveBeenCalledWith('test-session', '1');
      expect(api.permanentlyDeleteCanvasItem).toHaveBeenCalledWith('test-session', '2');
    });

    it('back button exists in header', async () => {
      api.getCanvasTrash.mockResolvedValue([
        { id: '1', filename: 'test.txt', type: 'text', deletedAt: Date.now() },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const backButton = wrapper.find('.trash-header .btn');
      expect(backButton.exists()).toBe(true);
      expect(backButton.text()).toContain('Back to Canvas');
    });
  });
});

