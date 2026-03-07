import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import { useCanvasStore } from '../stores/canvas.js';
import { useUiStore } from '../stores/ui.js';

// Mock the API module before importing component
vi.mock('../composables/useApi.js', () => ({
  api: {
    getCanvasItems: vi.fn().mockResolvedValue([]),
    getAllCanvasItems: vi.fn().mockResolvedValue([]),
    getCanvasFileContent: vi.fn().mockResolvedValue({ content: null, data: null }),
    uploadCanvasItem: vi.fn(),
    deleteCanvasItem: vi.fn(),
    getCanvasTrash: vi.fn().mockResolvedValue([]),
    recoverCanvasItem: vi.fn(),
    recoverCanvasFile: vi.fn(),
    permanentlyDeleteCanvasItem: vi.fn(),
  },
}));

import CanvasFileViewer from './CanvasFileViewer.vue';

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

// Stub for MarkdownViewer
const MarkdownViewerStub = defineComponent({
  name: 'MarkdownViewer',
  props: ['content'],
  template: '<div class="markdown-viewer-stub">{{ content }}</div>',
});

describe('CanvasFileViewer', () => {
  let mockClipboard;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    // Mock clipboard API
    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      configurable: true,
    });
    // Mock timers for copy feedback
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountComponent(props = {}) {
    const defaultProps = {
      item: { id: '1', filename: 'test.txt', type: 'text', content: 'Hello', createdAt: Date.now() },
      sessionId: 'test-session',
      versions: [],
      showBackButton: true,
    };
    return mount(CanvasFileViewer, {
      props: { ...defaultProps, ...props },
      global: {
        stubs: {
          MarkdownViewer: MarkdownViewerStub,
        },
      },
    });
  }

  describe('rendering', () => {
    it('displays filename in header', () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'myfile.txt', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      expect(wrapper.find('.viewer-filename').text()).toBe('myfile.txt');
    });

    it('displays Untitled when filename is missing', () => {
      const wrapper = mountComponent({
        item: { id: '1', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      expect(wrapper.find('.viewer-filename').text()).toBe('Untitled');
    });

    it('always shows breadcrumb navigation', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.breadcrumb-back').exists()).toBe(true);
      expect(wrapper.find('.breadcrumb-separator').exists()).toBe(true);
      expect(wrapper.find('.breadcrumb-back').text()).toBe('← Canvas');
    });
  });

  describe('three-dot menu', () => {
    it('renders menu button in header', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.btn-menu').exists()).toBe(true);
    });

    it('opens menu when button is clicked', async () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.file-menu-items').exists()).toBe(false);

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      expect(wrapper.find('.file-menu-items').exists()).toBe(true);
    });

    it('shows copy file contents, copy filename, and delete options', async () => {
      const wrapper = mountComponent();

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      expect(menuItems.length).toBe(3);
      expect(menuItems[0].text()).toContain('Copy filename');
      expect(menuItems[1].text()).toContain('Copy file contents');
      expect(menuItems[2].text()).toContain('Delete file');
    });

    it('copies file contents when menu option is clicked', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'test.txt', type: 'text', content: 'File content here', createdAt: Date.now() },
      });

      const uiStore = useUiStore();
      const successSpy = vi.spyOn(uiStore, 'success');

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      await menuItems[1].trigger('click');
      await flushAll(wrapper);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('File content here');
      expect(successSpy).toHaveBeenCalledWith('Copied file contents to clipboard');
    });

    it('copies file contents using fetchItemContent return value', async () => {
      const item = { id: '1', filename: 'doc.md', type: 'markdown', createdAt: Date.now() };
      const wrapper = mountComponent({ item });

      const canvasStore = useCanvasStore();
      const uiStore = useUiStore();
      const successSpy = vi.spyOn(uiStore, 'success');

      // Mock fetchItemContent to return content
      const fetchSpy = vi.spyOn(canvasStore, 'fetchItemContent').mockResolvedValue({
        content: '# Fetched Content',
        data: null
      });

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      await menuItems[1].trigger('click');
      await flushAll(wrapper);

      expect(fetchSpy).toHaveBeenCalledWith('test-session', 'doc.md');
      expect(mockClipboard.writeText).toHaveBeenCalledWith('# Fetched Content');
      expect(successSpy).toHaveBeenCalledWith('Copied file contents to clipboard');
    });

    it('copies JSON data using fetchItemContent return value', async () => {
      const item = { id: '1', filename: 'data.json', type: 'json', createdAt: Date.now() };
      const wrapper = mountComponent({ item });

      const canvasStore = useCanvasStore();
      const uiStore = useUiStore();
      const successSpy = vi.spyOn(uiStore, 'success');

      // Mock fetchItemContent to return data
      const fetchSpy = vi.spyOn(canvasStore, 'fetchItemContent').mockResolvedValue({
        content: null,
        data: '{"key": "value"}'
      });

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      await menuItems[1].trigger('click');
      await flushAll(wrapper);

      expect(fetchSpy).toHaveBeenCalledWith('test-session', 'data.json');
      expect(mockClipboard.writeText).toHaveBeenCalledWith('{"key": "value"}');
      expect(successSpy).toHaveBeenCalledWith('Copied file contents to clipboard');
    });

    it('shows error toast when clipboard fails during contents copy', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'test.txt', type: 'text', content: 'File content here', createdAt: Date.now() },
      });

      const canvasStore = useCanvasStore();
      const uiStore = useUiStore();
      const errorSpy = vi.spyOn(uiStore, 'error');

      // Mock fetchItemContent
      vi.spyOn(canvasStore, 'fetchItemContent').mockResolvedValue({
        content: 'File content here',
        data: null
      });

      // Mock clipboard to fail
      mockClipboard.writeText = vi.fn().mockRejectedValue(new Error('Clipboard failed'));

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      await menuItems[1].trigger('click');
      await flushAll(wrapper);

      expect(errorSpy).toHaveBeenCalledWith('Failed to copy file contents to clipboard');
    });

    it('copies filename when menu option is clicked', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'myfile.txt', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      const uiStore = useUiStore();
      const successSpy = vi.spyOn(uiStore, 'success');

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      await menuItems[0].trigger('click');
      await flushAll(wrapper);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('myfile.txt');
      expect(successSpy).toHaveBeenCalledWith('Copied filename to clipboard');
    });

    it('shows error toast when clipboard fails during filename copy', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'myfile.txt', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      const uiStore = useUiStore();
      const errorSpy = vi.spyOn(uiStore, 'error');

      // Mock clipboard to fail
      mockClipboard.writeText = vi.fn().mockRejectedValue(new Error('Clipboard failed'));

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      await menuItems[0].trigger('click');
      await flushAll(wrapper);

      expect(errorSpy).toHaveBeenCalledWith('Failed to copy filename to clipboard');
    });

    it('shows delete file option with version count when multiple versions exist', async () => {
      const wrapper = mountComponent({
        item: { id: '2', filename: 'test.txt', type: 'text', content: 'Content', createdAt: 2000 },
        versions: [
          { id: '1', createdAt: 1000 },
          { id: '2', createdAt: 2000 },
        ],
      });

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      expect(menuItems.length).toBe(3);
      expect(menuItems[2].text()).toContain('Delete file');
    });
  });

  describe('version dropdown', () => {
    it('hides version dropdown when only one version', () => {
      const wrapper = mountComponent({
        versions: [{ id: '1', createdAt: Date.now() }],
      });

      expect(wrapper.find('.version-dropdown').exists()).toBe(false);
    });

    it('shows version dropdown when multiple versions', () => {
      const wrapper = mountComponent({
        item: { id: '2', filename: 'test.txt', type: 'text', content: 'Content', createdAt: 2000 },
        versions: [
          { id: '1', createdAt: 1000 },
          { id: '2', createdAt: 2000 },
        ],
      });

      expect(wrapper.find('.version-dropdown').exists()).toBe(true);
    });
  });

  describe('content rendering', () => {
    it('renders image for image type', () => {
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'photo.png',
          type: 'image',
          data: 'base64data',
          mimeType: 'image/png',
          createdAt: Date.now(),
        },
      });

      expect(wrapper.find('.viewer-image').exists()).toBe(true);
    });

    it('renders text content for text type', () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'test.txt', type: 'text', content: 'Hello World', createdAt: Date.now() },
      });

      expect(wrapper.find('.viewer-text').exists()).toBe(true);
      expect(wrapper.find('.viewer-text').text()).toBe('Hello World');
    });

    it('renders JSON content for json type', () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'data.json', type: 'json', data: '{"key":"value"}', createdAt: Date.now() },
      });

      expect(wrapper.find('.viewer-json').exists()).toBe(true);
    });
  });

  describe('formatLastModified display', () => {
    it('displays empty string when updatedAt is null', () => {
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: Date.now(),
          updatedAt: null,
        },
      });

      const metaElement = wrapper.find('.viewer-meta');
      expect(metaElement.exists()).toBe(true);
      expect(metaElement.text()).toBe('');
    });

    it('displays "Modified just now" for very recent timestamps', () => {
      const now = Date.now();
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: now,
          updatedAt: now,
        },
      });

      const metaElement = wrapper.find('.viewer-meta');
      expect(metaElement.exists()).toBe(true);
      expect(metaElement.text()).toBe('Modified just now');
    });

    it('displays "Modified Xm ago" for minutes old', () => {
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: fiveMinutesAgo,
          updatedAt: fiveMinutesAgo,
        },
      });

      const metaElement = wrapper.find('.viewer-meta');
      expect(metaElement.text()).toBe('Modified 5m ago');
    });

    it('displays "Modified Xh ago" for hours old', () => {
      const now = Date.now();
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: twoHoursAgo,
          updatedAt: twoHoursAgo,
        },
      });

      const metaElement = wrapper.find('.viewer-meta');
      expect(metaElement.text()).toBe('Modified 2h ago');
    });

    it('displays "Modified Xd ago" for days old', () => {
      const now = Date.now();
      const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: threeDaysAgo,
          updatedAt: threeDaysAgo,
        },
      });

      const metaElement = wrapper.find('.viewer-meta');
      expect(metaElement.text()).toBe('Modified 3d ago');
    });

    it('handles edge case of exactly 1 minute', () => {
      const now = Date.now();
      const oneMinuteAgo = now - 60 * 1000;
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: oneMinuteAgo,
          updatedAt: oneMinuteAgo,
        },
      });

      const metaElement = wrapper.find('.viewer-meta');
      expect(metaElement.text()).toBe('Modified 1m ago');
    });

    it('handles edge case of exactly 1 hour', () => {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: oneHourAgo,
          updatedAt: oneHourAgo,
        },
      });

      const metaElement = wrapper.find('.viewer-meta');
      expect(metaElement.text()).toBe('Modified 1h ago');
    });

    it('updates display when item changes', async () => {
      const now = Date.now();
      const wrapper = mountComponent({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: now,
          updatedAt: now,
        },
      });

      // Initially shows "just now"
      expect(wrapper.find('.viewer-meta').text()).toBe('Modified just now');

      // Update to an older timestamp
      const oneHourAgo = now - 60 * 60 * 1000;
      await wrapper.setProps({
        item: {
          id: '1',
          filename: 'test.txt',
          type: 'text',
          content: 'Content',
          createdAt: oneHourAgo,
          updatedAt: oneHourAgo,
        },
      });
      await flushAll(wrapper);

      // Should now show "1h ago"
      expect(wrapper.find('.viewer-meta').text()).toBe('Modified 1h ago');
    });
  });
});
