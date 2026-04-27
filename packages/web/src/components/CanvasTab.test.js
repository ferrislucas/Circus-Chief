import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent, reactive } from 'vue';
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

// Mock useConnectionStatus composable
vi.mock('../composables/useConnectionStatus.js', async () => {
  const { ref } = await import('vue');
  return {
    useConnectionStatus: () => ({
      isStale: ref(false),
      connectionStatus: ref('connected'),
      reconnectAttempt: ref(0),
    }),
  };
});

// Mock the API - MUST be before imports that use it
vi.mock('../composables/useApi.js', () => ({
  api: {
    getCanvasItems: vi.fn().mockResolvedValue([]),
    getAllCanvasItems: vi.fn().mockResolvedValue([]),
    getCanvasFileContent: vi.fn().mockResolvedValue({ content: null, data: null }),
    getCanvasItemContent: vi.fn().mockResolvedValue({ content: null, data: null }),
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
const mockReplace = vi.fn();
const mockRoute = {
  query: reactive({}),
};
vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
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
    props: ['items', 'sessionId'],
    emits: ['select'],
    template: '<div class="canvas-file-list-stub">{{ items.length }} items</div>',
  });

  const CanvasFileViewerStub = defineComponent({
    name: 'CanvasFileViewer',
    props: ['item', 'sessionId', 'versions', 'showBackButton'],
    emits: ['back', 'selectVersion', 'delete', 'deleteAll'],
    template: `<div class="canvas-file-viewer">
      <button v-if="showBackButton" class="breadcrumb-back">← Back to list</button>
      Viewing {{ item?.filename }}
    </div>`,
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
    // Reset mock route. NOTE: some tests replace `mockRoute.query` with a
    // plain `{ ... }` object literal before mount — that's fine because Vue
    // re-reads `route.query.item` on each render. Tests that need to mutate
    // `route.query.item` *after* mount (e.g. pin-clearing watcher tests)
    // must use a reactive object (`reactive({ item: '...' })`) so the
    // watcher observes the change.
    mockRoute.query = {};
    mockPush.mockClear();
    mockReplace.mockClear();
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
      api.getAllCanvasItems.mockResolvedValue([]);

      mountComponent();

      await flushPromises();

      expect(api.getAllCanvasItems).toHaveBeenCalledWith('test-session');
    });

    it('fetches canvas items with the correct sessionId', async () => {
      api.getAllCanvasItems.mockResolvedValue([]);

      mountComponent({ sessionId: 'custom-session-123' });

      await flushPromises();

      expect(api.getAllCanvasItems).toHaveBeenCalledWith('custom-session-123');
    });

    it('fetches fresh data each time component is mounted', async () => {
      api.getAllCanvasItems.mockResolvedValue([]);

      const wrapper1 = mountComponent();
      await flushPromises();

      wrapper1.unmount();

      // Need a fresh pinia for the second mount to simulate actual remount behavior
      setActivePinia(createPinia());
      canvasStore = useCanvasStore();

      const wrapper2 = mountComponent();
      await flushPromises();

      expect(api.getAllCanvasItems).toHaveBeenCalledTimes(2);
    });
  });

  describe('loading state', () => {
    it('shows loading state while fetching', async () => {
      let resolvePromise;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      api.getAllCanvasItems.mockReturnValue(pendingPromise);

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
      api.getAllCanvasItems.mockResolvedValue([]);

      const wrapper = mountComponent();

      await flushAll(wrapper);

      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.text()).toContain('No canvas items yet');
    });
  });

  describe('displaying items', () => {
    it('populates store with multiple items after fetch', async () => {
      api.getAllCanvasItems.mockResolvedValue([
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
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'file1.png', createdAt: 1000 },
        { id: '2', filename: 'file2.png', createdAt: 2000 },
      ]);

      const wrapper = mountComponent();

      await flushAll(wrapper);

      const uploadButton = wrapper.find('label.btn-primary');
      expect(uploadButton.exists()).toBe(true);
      expect(uploadButton.text()).toContain('Upload File');
    });

    it('shows list view with single file (no auto-open)', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'file1.png', createdAt: 1000 },
      ]);

      mountComponent();

      await flushPromises();

      // With the new behavior, list view is always shown by default
      // No auto-open behavior - viewer only shows with explicit selection
      // Verify store has the item
      expect(canvasStore.items).toHaveLength(1);
      expect(canvasStore.loading).toBe(false);
      // No route.query.item means viewer is not shown
      expect(mockRoute.query.item).toBeUndefined();
    });

    it('hides upload button when viewing a specific file in list', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'file1.png', createdAt: 1000 },
        { id: '2', filename: 'file2.png', createdAt: 2000 },
      ]);

      mockRoute.query = { item: '1' };

      const wrapper = mountComponent();

      await flushAll(wrapper);

      // Upload button should be hidden when viewing a specific file
      const uploadButton = wrapper.find('label.btn-primary');
      expect(uploadButton.exists()).toBe(false);
    });

    it('has hidden file input', async () => {
      api.getAllCanvasItems.mockResolvedValue([
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
      api.getAllCanvasItems.mockResolvedValue([]);

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
      api.getAllCanvasItems.mockResolvedValue([]);
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
      expect(api.uploadCanvasItem).toHaveBeenCalledWith('test-session', file);
    });
  });

  describe('navigation between tabs (the main fix)', () => {
    it('refreshes data when navigating to canvas tab (component remounts)', async () => {
      // First mount - simulates initial page load
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'initial.png', createdAt: 1000 },
      ]);

      const wrapper1 = mountComponent({ sessionId: 'session-1' });
      await flushPromises();

      expect(api.getAllCanvasItems).toHaveBeenCalledTimes(1);
      expect(api.getAllCanvasItems).toHaveBeenCalledWith('session-1');

      // Unmount (simulates navigating away to another tab)
      wrapper1.unmount();

      // Second mount - simulates navigating back to canvas tab
      // Need fresh pinia to simulate real remount
      setActivePinia(createPinia());
      canvasStore = useCanvasStore();

      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'initial.png', createdAt: 1000 },
        { id: '2', filename: 'new-item.png', createdAt: 2000 },
      ]);

      mountComponent({ sessionId: 'session-1' });
      await flushPromises();

      // Should have fetched again
      expect(api.getAllCanvasItems).toHaveBeenCalledTimes(2);

      // New data should be reflected
      expect(canvasStore.items).toHaveLength(2);
    });

    it('uses the session ID from props for fetch', async () => {
      api.getAllCanvasItems.mockResolvedValue([]);

      mountComponent({ sessionId: 'different-session' });

      await flushPromises();

      expect(api.getAllCanvasItems).toHaveBeenCalledWith('different-session');
    });
  });

  describe('trash toggle', () => {
    it('fetches trashed items on mount', async () => {
      api.getAllCanvasItems.mockResolvedValue([]);
      api.getCanvasTrash.mockResolvedValue([]);

      mountComponent();
      await flushPromises();

      expect(api.getCanvasTrash).toHaveBeenCalledWith('test-session');
    });

    it('hides trash toggle when trash is empty', async () => {
      api.getAllCanvasItems.mockResolvedValue([]);
      api.getCanvasTrash.mockResolvedValue([]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // When trashedItems is empty, the button should not exist
      const trashButton = wrapper.find('.trash-toggle');
      expect(trashButton.exists()).toBe(false);
    });
  });

  describe('viewer and list behavior', () => {
    it('shows list view by default when there is only one file (no auto-open)', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'doc.txt', type: 'text', content: 'Hello', createdAt: 1000 },
      ]);

      mountComponent();
      await flushPromises();

      // Store should have the item
      expect(canvasStore.items).toHaveLength(1);
      expect(canvasStore.loading).toBe(false);
      // With no route.query.item, viewer should NOT be shown (no auto-open)
      // This is verified by checking that shouldShowViewer would be false
      expect(mockRoute.query.item).toBeUndefined();
    });

    it('shows list view by default even with multiple versions of same file', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'doc.txt', type: 'text', content: 'V1', createdAt: 1000 },
        { id: '2', filename: 'doc.txt', type: 'text', content: 'V2', createdAt: 2000 },
        { id: '3', filename: 'doc.txt', type: 'text', content: 'V3', createdAt: 3000 },
      ]);

      mountComponent();
      await flushPromises();

      // Store should have the items
      expect(canvasStore.items).toHaveLength(3);
      expect(canvasStore.loading).toBe(false);
      // With no route.query.item, viewer should NOT be shown
      expect(mockRoute.query.item).toBeUndefined();
    });

    it('shows viewer only when item is explicitly selected via URL query', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'doc.txt', type: 'text', content: 'V1', createdAt: 1000 },
        { id: '2', filename: 'doc.txt', type: 'text', content: 'V2', createdAt: 2000 },
      ]);

      // Explicit selection via URL query
      mockRoute.query = { item: '2' };
      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Verify store is populated
      expect(canvasStore.items).toHaveLength(2);
      // Viewer should be shown with explicit selection
      expect(wrapper.find('.canvas-file-viewer').exists()).toBe(true);
      // Should show filename in viewer
      expect(wrapper.text()).toContain('doc.txt');
    });

    it('shows list view when there are multiple file groups', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'doc1.txt', type: 'text', content: 'A', createdAt: 1000 },
        { id: '2', filename: 'doc2.txt', type: 'text', content: 'B', createdAt: 2000 },
      ]);

      mountComponent();
      await flushPromises();

      // Store should have both items
      expect(canvasStore.items).toHaveLength(2);
      expect(canvasStore.loading).toBe(false);
      // With no route.query.item, viewer should NOT be shown
      expect(mockRoute.query.item).toBeUndefined();
    });

    it('shows viewer when item is explicitly selected from multiple file groups', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'doc1.txt', type: 'text', content: 'A', createdAt: 1000 },
        { id: '2', filename: 'doc2.txt', type: 'text', content: 'B', createdAt: 2000 },
      ]);

      // Set route query to select a specific item
      mockRoute.query = { item: '2' };
      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Verify store is populated
      expect(canvasStore.items).toHaveLength(2);
      // Viewer should be visible because an item was explicitly selected
      expect(wrapper.find('.canvas-file-viewer').exists()).toBe(true);
      expect(wrapper.text()).toContain('doc2.txt');
    });

    it('shows viewer when explicitly selected (no back button with single item)', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'doc.txt', type: 'text', content: 'Hello', createdAt: 1000 },
      ]);

      // Explicit selection required to show viewer
      mockRoute.query = { item: '1' };
      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Verify store is populated
      expect(canvasStore.items).toHaveLength(1);
      // Viewer should be shown with explicit selection
      expect(wrapper.find('.canvas-file-viewer').exists()).toBe(true);
      expect(wrapper.text()).toContain('doc.txt');
      // Back button should always be visible so users can navigate back to the list
      expect(wrapper.find('.breadcrumb-back').exists()).toBe(true);
    });

    it('shows back button when item is explicitly selected from multiple items', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'doc1.txt', type: 'text', content: 'A', createdAt: 1000 },
        { id: '2', filename: 'doc2.txt', type: 'text', content: 'B', createdAt: 2000 },
      ]);

      mockRoute.query = { item: '2' };
      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Verify store is populated
      expect(canvasStore.items).toHaveLength(2);
      // Back button should be present when viewing an item
      expect(wrapper.find('.breadcrumb-back').exists()).toBe(true);
      expect(wrapper.text()).toContain('← Back to list');
      expect(wrapper.text()).toContain('doc2.txt');
    });
  });

  describe('auto-navigation on WebSocket update', () => {
    it('auto-navigates to new version when viewed file is updated', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'doc.md', type: 'markdown', createdAt: 1000 },
      ]);
      mockRoute.query = { item: '1' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Simulate WebSocket delivering a new version
      canvasStore.addItem({ id: '2', filename: 'doc.md', type: 'markdown', createdAt: 2000 });
      await flushAll(wrapper);

      expect(mockReplace).toHaveBeenCalledWith({
        query: { item: '2' }
      });
    });

    it('does not auto-navigate when not viewing any file', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'doc.md', type: 'markdown', createdAt: 1000 },
      ]);
      mockRoute.query = {}; // No item selected

      const wrapper = mountComponent();
      await flushAll(wrapper);

      canvasStore.addItem({ id: '2', filename: 'doc.md', type: 'markdown', createdAt: 2000 });
      await flushAll(wrapper);

      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('does not auto-navigate when new item is for a different file', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'a.md', type: 'markdown', createdAt: 1000 },
      ]);
      mockRoute.query = { item: '1' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // New item is for a different file
      canvasStore.addItem({ id: '2', filename: 'b.md', type: 'markdown', createdAt: 2000 });
      await flushAll(wrapper);

      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('auto-navigates even when viewing an older version', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'doc.md', type: 'markdown', createdAt: 1000 },
        { id: '2', filename: 'doc.md', type: 'markdown', createdAt: 2000 },
      ]);
      mockRoute.query = { item: '1' }; // Viewing the older version

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // New version arrives
      canvasStore.addItem({ id: '3', filename: 'doc.md', type: 'markdown', createdAt: 3000 });
      await flushAll(wrapper);

      expect(mockReplace).toHaveBeenCalledWith({
        query: { item: '3' }
      });
    });
  });

  describe('version pin + dedupe', () => {
    it('selectedVersions is deduped (via stub prop)', async () => {
      // Seed the store with a duplicate item (same id) BEFORE fetch runs
      api.getAllCanvasItems.mockResolvedValue([
        { id: 'x', filename: 'f.md', type: 'markdown', createdAt: 1000 },
        { id: 'x', filename: 'f.md', type: 'markdown', createdAt: 1000 },
      ]);
      mockRoute.query = { item: 'x' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const viewer = wrapper.findComponent(CanvasFileViewerStub);
      expect(viewer.exists()).toBe(true);
      expect(viewer.props('versions').length).toBe(1);
    });

    it('unrelated canvas adds do NOT trigger router.replace', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'A.md', type: 'markdown', createdAt: 1000 },
      ]);
      mockRoute.query = { item: '1' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      mockReplace.mockClear();

      // Unrelated file arrives
      canvasStore.addItem({ id: '2', filename: 'B.md', type: 'markdown', createdAt: 2000 });
      await flushAll(wrapper);

      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('new version of the current file DOES trigger router.replace (no pin)', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'A.md', type: 'markdown', createdAt: 1000 },
      ]);
      mockRoute.query = { item: '1' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      mockReplace.mockClear();

      canvasStore.addItem({ id: '2', filename: 'A.md', type: 'markdown', createdAt: 2000 });
      await flushAll(wrapper);

      expect(mockReplace).toHaveBeenCalledWith({ query: { item: '2' } });
    });

    it('pinned version is NOT overridden by newer arrivals', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'A.md', type: 'markdown', createdAt: 1000 },
        { id: '2', filename: 'A.md', type: 'markdown', createdAt: 2000 },
      ]);
      mockRoute.query = { item: '2' }; // start on latest

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Simulate the user picking the older version via the dropdown. The
      // handler sets the pin because '1' !== latest id '2'. router.push is a
      // mock so the route doesn't actually change, but that is irrelevant to
      // this test — we only care about the pin's effect on the auto-nav
      // watcher.
      const viewer = wrapper.findComponent(CanvasFileViewerStub);
      await viewer.vm.$emit('selectVersion', '1');
      await flushAll(wrapper);

      mockReplace.mockClear();

      // A newer version arrives via WS while the pin is set.
      canvasStore.addItem({ id: '3', filename: 'A.md', type: 'markdown', createdAt: 3000 });
      await flushAll(wrapper);

      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('deep-linked older version survives initial fetch', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: 'old', filename: 'A.md', type: 'markdown', createdAt: 1000 },
        { id: 'new', filename: 'A.md', type: 'markdown', createdAt: 2000 },
      ]);
      mockRoute.query = { item: 'old' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // The empty→populated transition should NOT trigger router.replace
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('re-selecting the latest version clears the pin', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'A.md', type: 'markdown', createdAt: 1000 },
        { id: '2', filename: 'A.md', type: 'markdown', createdAt: 2000 },
      ]);
      mockRoute.query = { item: '2' };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const viewer = wrapper.findComponent(CanvasFileViewerStub);

      // Pin: pick the older version. The pin is set because '1' !== latest '2'.
      await viewer.vm.$emit('selectVersion', '1');
      await flushAll(wrapper);

      // Unpin: pick the current latest (id '2'). Because '2' === latest, the
      // handler clears userPinnedVersionId.
      await viewer.vm.$emit('selectVersion', '2');
      await flushAll(wrapper);

      mockReplace.mockClear();

      // Now a newer version arrives — should auto-nav since the pin is null.
      canvasStore.addItem({ id: '3', filename: 'A.md', type: 'markdown', createdAt: 3000 });
      await flushAll(wrapper);

      expect(mockReplace).toHaveBeenCalledWith({ query: { item: '3' } });
    });

    it('pin clears when the user switches to a different file (live route change)', async () => {
      // Arrange: seed store with versions of two files and pin an older
      // version of file A. Use a reactive query so the watcher observes
      // later mutations to route.query.item.
      api.getAllCanvasItems.mockResolvedValue([
        { id: 'a1', filename: 'A.md', type: 'markdown', createdAt: 1000 },
        { id: 'a2', filename: 'A.md', type: 'markdown', createdAt: 2000 },
        { id: 'b1', filename: 'B.md', type: 'markdown', createdAt: 1500 },
      ]);
      mockRoute.query = reactive({ item: 'a2' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Pin the older version of A.
      const viewer = wrapper.findComponent(CanvasFileViewerStub);
      await viewer.vm.$emit('selectVersion', 'a1');
      await flushAll(wrapper);

      // Act: live route change to a DIFFERENT file (no remount).
      mockRoute.query.item = 'b1';
      await flushAll(wrapper);

      mockReplace.mockClear();

      // A newer version of file B arrives. If the pin-clearing watcher
      // fired on the filename change, the pin is null and auto-nav fires.
      canvasStore.addItem({ id: 'b2', filename: 'B.md', type: 'markdown', createdAt: 2500 });
      await flushAll(wrapper);

      // Assert: auto-nav fired, proving the pin was cleared by the file switch.
      expect(mockReplace).toHaveBeenCalledWith({ query: { item: 'b2' } });
    });

    it('pin clears when the user goes back to the list view (route.query.item becomes undefined)', async () => {
      // Arrange: pin an older version of A.
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'A.md', type: 'markdown', createdAt: 1000 },
        { id: '2', filename: 'A.md', type: 'markdown', createdAt: 2000 },
      ]);
      mockRoute.query = reactive({ item: '2' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const viewer = wrapper.findComponent(CanvasFileViewerStub);
      await viewer.vm.$emit('selectVersion', '1');
      await flushAll(wrapper);

      // Act: leave the detail view by clearing route.query.item (list view).
      delete mockRoute.query.item;
      await flushAll(wrapper);

      // Return to the same file — pin should have been cleared on exit.
      mockRoute.query.item = '2';
      await flushAll(wrapper);

      mockReplace.mockClear();

      // A newer version of A arrives. If the null-branch of the
      // pin-clearing watcher ran when the user went back to the list, the
      // pin is now null and auto-nav fires.
      canvasStore.addItem({ id: '3', filename: 'A.md', type: 'markdown', createdAt: 3000 });
      await flushAll(wrapper);

      // Assert.
      expect(mockReplace).toHaveBeenCalledWith({ query: { item: '3' } });
    });

    it('pin is preserved when navigating between versions of the SAME file (live route change)', async () => {
      // Arrange: pin the older version of A.
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'A.md', type: 'markdown', createdAt: 1000 },
        { id: '2', filename: 'A.md', type: 'markdown', createdAt: 2000 },
      ]);
      mockRoute.query = reactive({ item: '2' });

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const viewer = wrapper.findComponent(CanvasFileViewerStub);
      await viewer.vm.$emit('selectVersion', '1');
      await flushAll(wrapper);

      // Act: live route change between versions of the SAME file.
      mockRoute.query.item = '2';
      await flushAll(wrapper);
      mockRoute.query.item = '1';
      await flushAll(wrapper);

      mockReplace.mockClear();

      // A newer version of A arrives. The pin-clearing watcher should NOT
      // have fired (same filename across version hops), so the pin is
      // still set and auto-nav is suppressed.
      canvasStore.addItem({ id: '3', filename: 'A.md', type: 'markdown', createdAt: 3000 });
      await flushAll(wrapper);

      // Assert.
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('switching to a different file (fresh mount) starts with no pin', async () => {
      // First mount: pin an older version of file A
      api.getAllCanvasItems.mockResolvedValue([
        { id: 'a1', filename: 'A.md', type: 'markdown', createdAt: 1000 },
        { id: 'a2', filename: 'A.md', type: 'markdown', createdAt: 2000 },
      ]);
      mockRoute.query = { item: 'a2' };

      let wrapper = mountComponent();
      await flushAll(wrapper);

      const viewer1 = wrapper.findComponent(CanvasFileViewerStub);
      await viewer1.vm.$emit('selectVersion', 'a1');
      await flushAll(wrapper);

      wrapper.unmount();

      // A real router navigation to a different file remounts CanvasTab
      // (same Pinia store). Simulate that.
      api.getAllCanvasItems.mockResolvedValue([
        { id: 'b1', filename: 'B.md', type: 'markdown', createdAt: 1500 },
      ]);
      mockRoute.query = { item: 'b1' };

      wrapper = mountComponent();
      await flushAll(wrapper);

      mockReplace.mockClear();

      // New version of B arrives — should auto-nav because the freshly
      // mounted component has no pin.
      canvasStore.addItem({ id: 'b2', filename: 'B.md', type: 'markdown', createdAt: 2500 });
      await flushAll(wrapper);

      expect(mockReplace).toHaveBeenCalledWith({ query: { item: 'b2' } });
    });
  });

  describe('connection status styling', () => {
    it('connection-stale class is NOT applied when connected', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'file1.png', createdAt: 1000 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const canvasTab = wrapper.find('.canvas-tab');
      expect(canvasTab.exists()).toBe(true);
      expect(canvasTab.classes()).not.toContain('connection-stale');
    });

    it('stale-badge is NOT shown when connected', async () => {
      api.getAllCanvasItems.mockResolvedValue([
        { id: '1', filename: 'file1.png', createdAt: 1000 },
      ]);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      expect(wrapper.find('[data-testid="stale-badge"]').exists()).toBe(false);
    });
  });
});
