import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import StreamingMessage from './StreamingMessage.vue';

// Mock MarkdownViewer
vi.mock('./MarkdownViewer.vue', () => ({
  default: {
    name: 'MarkdownViewer',
    props: ['content'],
    template: '<div class="markdown-viewer">{{ content }}</div>',
  },
}));

function mountComponent(props = {}) {
  return mount(StreamingMessage, {
    props: {
      content: 'Streaming text...',
      ...props,
    },
  });
}

describe('StreamingMessage', () => {
  describe('rendering', () => {
    it('should render with assistant role', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.message-role').text()).toBe('assistant');
    });

    it('should have message-assistant class', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.message-assistant').exists()).toBe(true);
    });

    it('should have message-streaming class', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.message-streaming').exists()).toBe(true);
    });

    it('should render MarkdownViewer with content', () => {
      const wrapper = mountComponent({ content: 'Hello **world**' });
      const viewer = wrapper.findComponent({ name: 'MarkdownViewer' });
      expect(viewer.exists()).toBe(true);
      expect(viewer.props('content')).toBe('Hello **world**');
    });
  });

  describe('streaming indicator', () => {
    it('should render three animated dots', () => {
      const wrapper = mountComponent();
      const dots = wrapper.findAll('.streaming-indicator .dot');
      expect(dots).toHaveLength(3);
    });

    it('should render streaming indicator', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.streaming-indicator').exists()).toBe(true);
    });
  });

  describe('content updates', () => {
    it('should update content when prop changes', async () => {
      const wrapper = mountComponent({ content: 'Initial' });
      const viewer = wrapper.findComponent({ name: 'MarkdownViewer' });
      expect(viewer.props('content')).toBe('Initial');

      await wrapper.setProps({ content: 'Updated content' });
      expect(viewer.props('content')).toBe('Updated content');
    });
  });
});
