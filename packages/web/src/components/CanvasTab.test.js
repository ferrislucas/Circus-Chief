import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useCanvasStore } from '../stores/canvas.js';
import { useUiStore } from '../stores/ui.js';

// Mock the API - MUST be before imports that use it
vi.mock('../composables/useApi.js', () => ({
  api: {
    getCanvasItems: vi.fn().mockResolvedValue([]),
    uploadCanvasItem: vi.fn(),
    deleteCanvasItem: vi.fn(),
  },
}));

// Import AFTER mocks are set up
import CanvasTab from './CanvasTab.vue';
import { api } from '../composables/useApi.js';

describe('CanvasTab', () => {
  let canvasStore;
  let uiStore;

  // Stub child components
  const CanvasFileListStub = defineComponent({
    name: 'CanvasFileList',
    props: ['items'],
    emits: ['select'],
    template: '<div class="canvas-file-list-stub">{{ items.length }} items</div>',
  });

  const CanvasFileViewerStub = defineComponent({
    name: 'CanvasFileViewer',
    props: ['item', 'versions', 'showBackButton'],
    emits: ['back', 'selectVersion', 'delete', 'deleteAll'],
    template: '<div class="canvas-file-viewer-stub">Viewing {{ item?.filename }}</div>',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    canvasStore = useCanvasStore();
    uiStore = useUiStore();
  });

  function mountComponent(props = { sessionId: 'test-session' }) {
    return mount(CanvasTab, {
      props,
      global: {
        stubs: {
          CanvasFileList: CanvasFileListStub,
          CanvasFileViewer: CanvasFileViewerStub,
        },
      },
    });
  }

  describe('data fetching on mount', () => {
    it('fetches canvas items on mount', async () => {
      api.getCanvasItems.mockResolvedValue([]);

      mountComponent();

      await flushPromises();

      expect(api.getCanvasItems).toHaveBeenCalledWith('test-session');
    });

    it('fetches canvas items with the correct sessionId', async () => {
      api.getCanvasItems.mockResolvedValue([]);

      mountComponent({ sessionId: 'custom-session-123' });

      await flushPromises();

      expect(api.getCanvasItems).toHaveBeenCalledWith('custom-session-123');
    });

    it('fetches fresh data each time component is mounted', async () => {
      api.getCanvasItems.mockResolvedValue([]);

      const wrapper1 = mountComponent();
      await flushPromises();

      wrapper1.unmount();

      const wrapper2 = mountComponent();
      await flushPromises();

      expect(api.getCanvasItems).toHaveBeenCalledTimes(2);
    });
  });

  describe('loading state', () => {
    it('shows loading state while fetching', async () => {
      let resolvePromise;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      api.getCanvasItems.mockReturnValue(pendingPromise);

      // Set loading to true manually since we're controlling the promise
      canvasStore.loading = true;

      const wrapper = mountComponent();

      await nextTick();

      expect(wrapper.find('.loading-state').exists()).toBe(true);
      expect(wrapper.text()).toContain('Loading canvas items...');

      // Cleanup
      resolvePromise([]);
      await flushPromises();
    });
  });

  describe('empty state', () => {
    it('shows empty state when no canvas items', async () => {
      api.getCanvasItems.mockResolvedValue([]);

      const wrapper = mountComponent();

      await flushPromises();
      await nextTick();

      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.text()).toContain('No canvas items yet');
    });
  });

  describe('displaying items', () => {
    it('populates store with multiple items after fetch', async () => {
      api.getCanvasItems.mockResolvedValue([
        { id: '1', filename: 'file1.png', createdAt: 1000 },
        { id: '2', filename: 'file2.png', createdAt: 2000 },
      ]);

      mountComponent();

      await flushPromises();

      // Verify the store has the items
      expect(canvasStore.items).toHaveLength(2);
      expect(canvasStore.groupedItems).toHaveLength(2);
    });

    it('auto-selects when only one item exists', async () => {
      api.getCanvasItems.mockResolvedValue([
        { id: '1', filename: 'single-file.png', createdAt: 1000 },
      ]);

      mountComponent();

      await flushPromises();
      await nextTick();

      // Verify the store has the item
      expect(canvasStore.items).toHaveLength(1);
      // The watcher should auto-select when only one item
      expect(canvasStore.selectedItemId).toBe('1');
    });
  });

  describe('file upload', () => {
    it('renders upload button', async () => {
      api.getCanvasItems.mockResolvedValue([]);

      const wrapper = mountComponent();

      await flushPromises();

      const uploadButton = wrapper.find('button.btn-primary');
      expect(uploadButton.exists()).toBe(true);
      expect(uploadButton.text()).toBe('Upload File');
    });

    it('has hidden file input', async () => {
      api.getCanvasItems.mockResolvedValue([]);

      const wrapper = mountComponent();

      await flushPromises();

      const fileInput = wrapper.find('input[type="file"]');
      expect(fileInput.exists()).toBe(true);
      expect(fileInput.attributes('hidden')).toBeDefined();
    });
  });

  describe('drag and drop', () => {
    it('handles dragover event', async () => {
      api.getCanvasItems.mockResolvedValue([]);

      const wrapper = mountComponent();

      await flushPromises();

      const container = wrapper.find('.canvas-tab');

      // Trigger dragover
      await container.trigger('dragover');

      // The dragover handler should be called (sets isDragOver = true)
      // We can verify by checking the class is added
      await nextTick();
      expect(container.classes()).toContain('drag-over');
    });

    it('handles drop event', async () => {
      api.getCanvasItems.mockResolvedValue([]);
      api.uploadCanvasItem.mockResolvedValue({
        id: 'new-item',
        filename: 'dropped.png',
        createdAt: Date.now(),
      });

      const wrapper = mountComponent();

      await flushPromises();

      const container = wrapper.find('.canvas-tab');

      // Create a mock file
      const file = new File(['test'], 'dropped.png', { type: 'image/png' });
      const dataTransfer = { files: [file] };

      // Trigger drop
      await container.trigger('drop', { dataTransfer });

      await flushPromises();

      // Verify upload was called
      expect(api.uploadCanvasItem).toHaveBeenCalledWith('test-session', file, 'dropped.png');
    });
  });

  describe('navigation between tabs (the main fix)', () => {
    it('refreshes data when navigating to canvas tab (component remounts)', async () => {
      // First mount - simulates initial page load
      api.getCanvasItems.mockResolvedValue([
        { id: '1', filename: 'initial.png', createdAt: 1000 },
      ]);

      const wrapper1 = mountComponent({ sessionId: 'session-1' });
      await flushPromises();

      expect(api.getCanvasItems).toHaveBeenCalledTimes(1);
      expect(api.getCanvasItems).toHaveBeenCalledWith('session-1');

      // Unmount (simulates navigating away to another tab)
      wrapper1.unmount();

      // Second mount - simulates navigating back to canvas tab
      api.getCanvasItems.mockResolvedValue([
        { id: '1', filename: 'initial.png', createdAt: 1000 },
        { id: '2', filename: 'new-item.png', createdAt: 2000 },
      ]);

      mountComponent({ sessionId: 'session-1' });
      await flushPromises();

      // Should have fetched again
      expect(api.getCanvasItems).toHaveBeenCalledTimes(2);

      // New data should be reflected
      expect(canvasStore.items).toHaveLength(2);
    });

    it('uses the session ID from props for fetch', async () => {
      api.getCanvasItems.mockResolvedValue([]);

      mountComponent({ sessionId: 'different-session' });

      await flushPromises();

      expect(api.getCanvasItems).toHaveBeenCalledWith('different-session');
    });
  });
});
