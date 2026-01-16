import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';
import { setActivePinia, createPinia } from 'pinia';

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

// Mock the API - MUST be before imports that use it
vi.mock('../composables/useApi.js', () => ({
  api: {
    getCanvasItems: vi.fn().mockResolvedValue([]),
    uploadCanvasItem: vi.fn(),
    deleteCanvasItem: vi.fn(),
    getCanvasTrash: vi.fn().mockResolvedValue([]),
    recoverCanvasItem: vi.fn(),
    recoverCanvasFile: vi.fn(),
    permanentlyDeleteCanvasItem: vi.fn(),
  },
}));

// Mock vue-router
const mockPush = vi.fn();
const mockRoute = {
  query: {},
};
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Import AFTER mocks are set up
import CanvasTab from './CanvasTab.vue';
import { api } from '../composables/useApi.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useUiStore } from '../stores/ui.js';

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

  const CanvasTrashStub = defineComponent({
    name: 'CanvasTrash',
    props: ['sessionId'],
    emits: ['close'],
    template: '<div class="canvas-trash-stub">Trash for {{ sessionId }}</div>',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    canvasStore = useCanvasStore();
    uiStore = useUiStore();
    // Reset mock route
    mockRoute.query = {};
    mockPush.mockClear();
  });

  function mountComponent(props = { sessionId: 'test-session' }) {
    return mount(CanvasTab, {
      props,
      global: {
        stubs: {
          'canvas-file-list': CanvasFileListStub,
          'canvas-file-viewer': CanvasFileViewerStub,
          'canvas-trash': CanvasTrashStub,
          CanvasFileList: CanvasFileListStub,
          CanvasFileViewer: CanvasFileViewerStub,
          CanvasTrash: CanvasTrashStub,
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

      // Need a fresh pinia for the second mount to simulate actual remount behavior
      setActivePinia(createPinia());
      canvasStore = useCanvasStore();

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

      const wrapper = mountComponent();

      // Wait for next tick to allow component to render with loading state
      await flushAll(wrapper);

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

      await flushAll(wrapper);

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

  });

  describe('file upload', () => {
    it('renders upload button in list view', async () => {
      api.getCanvasItems.mockResolvedValue([
        { id: '1', filename: 'file1.png', createdAt: 1000 },
        { id: '2', filename: 'file2.png', createdAt: 2000 },
      ]);

      const wrapper = mountComponent();

      await flushAll(wrapper);

      const uploadButton = wrapper.find('label.btn-primary');
      expect(uploadButton.exists()).toBe(true);
      expect(uploadButton.text()).toContain('Upload File');
    });

    it('hides upload button when viewing a single file', async () => {
      api.getCanvasItems.mockResolvedValue([
        { id: '1', filename: 'file1.png', createdAt: 1000 },
      ]);

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // With only one file, shouldShowViewer is true
      const uploadButton = wrapper.find('label.btn-primary');
      expect(uploadButton.exists()).toBe(false);
    });

    it('hides upload button when viewing a specific file in list', async () => {
      api.getCanvasItems.mockResolvedValue([
        { id: '1', filename: 'file1.png', createdAt: 1000 },
        { id: '2', filename: 'file2.png', createdAt: 2000 },
      ]);

      mockRoute.query = { item: '1' };

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // With item query parameter, shouldShowViewer is true
      const uploadButton = wrapper.find('label.btn-primary');
      expect(uploadButton.exists()).toBe(false);
    });

    it('has hidden file input', async () => {
      api.getCanvasItems.mockResolvedValue([
        { id: '1', filename: 'file1.png', createdAt: 1000 },
        { id: '2', filename: 'file2.png', createdAt: 2000 },
      ]);

      const wrapper = mountComponent();

      await flushPromises();

      const fileInput = wrapper.find('input[type="file"]');
      expect(fileInput.exists()).toBe(true);
      expect(fileInput.element.style.display).toBe('none');
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
      await flushAll(wrapper);
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
      // Need fresh pinia to simulate real remount
      setActivePinia(createPinia());
      canvasStore = useCanvasStore();

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

  describe('trash toggle', () => {
    it('fetches trashed items on mount', async () => {
      api.getCanvasItems.mockResolvedValue([]);
      api.getCanvasTrash.mockResolvedValue([]);

      mountComponent();
      await flushPromises();

      expect(api.getCanvasTrash).toHaveBeenCalledWith('test-session');
    });

    it('hides trash toggle when trash is empty', async () => {
      api.getCanvasItems.mockResolvedValue([]);
      api.getCanvasTrash.mockResolvedValue([]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // When trashedItems is empty, the button should not exist
      const trashButton = wrapper.find('.trash-toggle');
      expect(trashButton.exists()).toBe(false);
    });
  });
});
