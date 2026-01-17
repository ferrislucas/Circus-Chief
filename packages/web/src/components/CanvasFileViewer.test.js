import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';

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

    it('displays label when filename is missing', () => {
      const wrapper = mountComponent({
        item: { id: '1', label: 'My Label', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      expect(wrapper.find('.viewer-filename').text()).toBe('My Label');
    });

    it('shows back button when showBackButton is true', () => {
      const wrapper = mountComponent({ showBackButton: true });

      expect(wrapper.find('.btn-back').exists()).toBe(true);
    });

    it('hides back button when showBackButton is false', () => {
      const wrapper = mountComponent({ showBackButton: false });

      expect(wrapper.find('.btn-back').exists()).toBe(false);
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
      expect(menuItems[0].text()).toContain('Copy file contents');
      expect(menuItems[1].text()).toContain('Copy filename');
      expect(menuItems[2].text()).toContain('Delete file');
    });

    it('copies file contents when menu option is clicked', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'test.txt', type: 'text', content: 'File content here', createdAt: Date.now() },
      });

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      await menuItems[0].trigger('click');
      await flushAll(wrapper);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('File content here');
    });

    it('copies filename when menu option is clicked', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'myfile.txt', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      const menuButton = wrapper.find('.btn-menu');
      await menuButton.trigger('click');
      await flushAll(wrapper);

      const menuItems = wrapper.findAll('.menu-item');
      await menuItems[1].trigger('click');
      await flushAll(wrapper);

      expect(mockClipboard.writeText).toHaveBeenCalledWith('myfile.txt');
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
});
