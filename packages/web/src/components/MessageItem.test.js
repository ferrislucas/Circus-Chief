import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive, h } from 'vue';
import MessageItem from './MessageItem.vue';

// Mock child components
vi.mock('./MarkdownViewer.vue', () => ({
  default: {
    name: 'MarkdownViewer',
    props: ['content'],
    template: '<div class="markdown-viewer">{{ content }}</div>',
  },
}));

vi.mock('./WorkLogPanel.vue', () => ({
  default: {
    name: 'WorkLogPanel',
    props: ['workLogs'],
    template: '<div class="work-log-panel"></div>',
  },
}));

function createMessage(overrides = {}) {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello, Claude!',
    timestamp: '2024-01-15T10:00:00Z',
    model: null,
    attachments: [],
    toolUse: [],
    ...overrides,
  };
}

function mountComponent(props = {}) {
  return mount(MessageItem, {
    props: {
      message: createMessage(),
      workLogs: [],
      ...props,
    },
    global: {
      plugins: [createPinia()],
    },
  });
}

describe('MessageItem', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('rendering', () => {
    it('should render with correct data-testid for user messages', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('[data-testid="message-user"]').exists()).toBe(true);
    });

    it('should render with correct data-testid for assistant messages', () => {
      const wrapper = mountComponent({
        message: createMessage({ role: 'assistant' }),
      });
      expect(wrapper.find('[data-testid="message-assistant"]').exists()).toBe(true);
    });

    it('should render with correct data-message-id', () => {
      const wrapper = mountComponent({
        message: createMessage({ id: 'msg-42' }),
      });
      expect(wrapper.find('[data-message-id="msg-42"]').exists()).toBe(true);
    });

    it('should render message role', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.message-role').text()).toBe('user');
    });

    it('should render message content as text for user messages', () => {
      const wrapper = mountComponent({
        message: createMessage({ content: 'My question' }),
      });
      expect(wrapper.find('.message-content').text()).toContain('My question');
    });

    it('should render MarkdownViewer for assistant messages', () => {
      const wrapper = mountComponent({
        message: createMessage({ role: 'assistant', content: '**Bold text**' }),
      });
      expect(wrapper.findComponent({ name: 'MarkdownViewer' }).exists()).toBe(true);
    });

    it('should render message timestamp', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.message-time').text()).toBeTruthy();
    });
  });

  describe('model display', () => {
    it('should show model badge for assistant messages with model', () => {
      const wrapper = mountComponent({
        message: createMessage({
          role: 'assistant',
          model: 'claude-3-5-sonnet-20241022',
        }),
      });
      expect(wrapper.find('.message-model').exists()).toBe(true);
      expect(wrapper.find('.message-model').text()).toBe('claude-3.5-sonnet');
    });

    it('should not show model badge for user messages', () => {
      const wrapper = mountComponent({
        message: createMessage({ model: 'sonnet' }),
      });
      expect(wrapper.find('.message-model').exists()).toBe(false);
    });

    it('should not show model badge for assistant messages without model', () => {
      const wrapper = mountComponent({
        message: createMessage({ role: 'assistant', model: null }),
      });
      expect(wrapper.find('.message-model').exists()).toBe(false);
    });
  });

  describe('CSS classes', () => {
    it('should have message-user class for user messages', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.message-user').exists()).toBe(true);
    });

    it('should have message-assistant class for assistant messages', () => {
      const wrapper = mountComponent({
        message: createMessage({ role: 'assistant' }),
      });
      expect(wrapper.find('.message-assistant').exists()).toBe(true);
    });

    it('should have message-system class for system messages', () => {
      const wrapper = mountComponent({
        message: createMessage({ role: 'system' }),
      });
      expect(wrapper.find('.message-system').exists()).toBe(true);
    });
  });

  describe('attachments', () => {
    it('should not render attachments section when empty', () => {
      const wrapper = mountComponent({
        message: createMessage({ attachments: [] }),
      });
      expect(wrapper.find('.message-attachments').exists()).toBe(false);
    });

    it('should render attachments when present', () => {
      const wrapper = mountComponent({
        message: createMessage({
          attachments: [
            { id: 'att-1', filename: 'doc.pdf', mimeType: 'application/pdf', size: 1024 },
          ],
        }),
      });
      expect(wrapper.find('.message-attachments').exists()).toBe(true);
      expect(wrapper.find('.attachment-name').text()).toBe('doc.pdf');
    });

    it('should show correct icon for image attachments', () => {
      const wrapper = mountComponent({
        message: createMessage({
          attachments: [
            { id: 'att-1', filename: 'photo.png', mimeType: 'image/png', size: 2048 },
          ],
        }),
      });
      expect(wrapper.find('.attachment-icon').text()).toBe('🖼️');
    });

    it('should format file size correctly', () => {
      const wrapper = mountComponent({
        message: createMessage({
          attachments: [
            { id: 'att-1', filename: 'file.txt', mimeType: 'text/plain', size: 1536 },
          ],
        }),
      });
      expect(wrapper.find('.attachment-size').text()).toContain('1.5 KB');
    });
  });

  describe('tool use', () => {
    it('should not render tools section when empty', () => {
      const wrapper = mountComponent({
        message: createMessage({ toolUse: [] }),
      });
      expect(wrapper.find('.message-tools').exists()).toBe(false);
    });

    it('should render tool use details when present', () => {
      const wrapper = mountComponent({
        message: createMessage({
          role: 'assistant',
          toolUse: [
            { name: 'read_file', input: { path: '/test.js' } },
          ],
        }),
      });
      expect(wrapper.find('.message-tools').exists()).toBe(true);
      expect(wrapper.find('summary').text()).toContain('read_file');
    });
  });

  describe('work log panel', () => {
    it('should render WorkLogPanel for assistant messages', () => {
      const wrapper = mountComponent({
        message: createMessage({ role: 'assistant' }),
        workLogs: [{ id: 'wl-1' }],
      });
      expect(wrapper.findComponent({ name: 'WorkLogPanel' }).exists()).toBe(true);
    });

    it('should not render WorkLogPanel for user messages', () => {
      const wrapper = mountComponent({
        message: createMessage({ role: 'user' }),
      });
      expect(wrapper.findComponent({ name: 'WorkLogPanel' }).exists()).toBe(false);
    });
  });
});
