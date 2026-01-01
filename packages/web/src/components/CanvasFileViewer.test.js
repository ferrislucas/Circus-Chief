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

  describe('copy button', () => {
    it('renders copy button in header', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.copy-button').exists()).toBe(true);
    });

    it('copies filename to clipboard on click', async () => {
      const wrapper = mountComponent({
        item: { id: '1', filename: 'copyfile.txt', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      const copyButton = wrapper.find('.copy-button');
      await copyButton.trigger('click');

      expect(mockClipboard.writeText).toHaveBeenCalledWith('copyfile.txt');
    });

    it('copies label when filename is missing', async () => {
      const wrapper = mountComponent({
        item: { id: '1', label: 'My Document', type: 'text', content: 'Content', createdAt: Date.now() },
      });

      const copyButton = wrapper.find('.copy-button');
      await copyButton.trigger('click');

      expect(mockClipboard.writeText).toHaveBeenCalledWith('My Document');
    });

    it('shows copied state temporarily', async () => {
      const wrapper = mountComponent();

      const copyButton = wrapper.find('.copy-button');
      await copyButton.trigger('click');
      await flushAll(wrapper);

      // Should show checkmark after copy
      expect(copyButton.text()).toContain('✓');
      expect(copyButton.classes()).toContain('copied');

      // After 1.5s, should revert
      vi.advanceTimersByTime(1500);
      await flushAll(wrapper);

      expect(copyButton.text()).toContain('📋');
      expect(copyButton.classes()).not.toContain('copied');
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

  describe('delete dropdown', () => {
    it('renders delete button', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.delete-dropdown').exists()).toBe(true);
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
