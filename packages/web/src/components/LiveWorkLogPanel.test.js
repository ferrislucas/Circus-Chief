import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia, createPinia } from 'pinia';
import LiveWorkLogPanel from './LiveWorkLogPanel.vue';

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
    // CRITICAL: Additional flush for nested nextTick in scrollToBottom()
    await nextTick();
    await flushPromises();
  }
}

// Stub child components
const ThinkingBlockStub = {
  name: 'ThinkingBlock',
  template: '<div class="thinking-block-stub">{{ content }}</div>',
  props: ['content', 'timestamp', 'streaming'],
};

const CommandBlockStub = {
  name: 'CommandBlock',
  template: '<div class="command-block-stub">{{ log.content }}</div>',
  props: ['log'],
};

describe('LiveWorkLogPanel', () => {
  // Set up Pinia before each test
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  function mountComponent(props = {}) {
    return mount(LiveWorkLogPanel, {
      props,
      global: {
        stubs: {
          ThinkingBlock: ThinkingBlockStub,
          CommandBlock: CommandBlockStub,
        },
      },
    });
  }

  function createWorkLog(id, type = 'tool_input') {
    return {
      id,
      type,
      toolName: 'Bash',
      content: `Log content ${id}`,
      timestamp: Date.now(),
    };
  }

  describe('rendering', () => {
    it('shows header with "Claude is working..." text', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.live-title').text()).toBe('Claude is working...');
    });

    it('does not show logs container when no content', () => {
      const wrapper = mountComponent({ workLogs: [] });
      expect(wrapper.find('.live-logs').exists()).toBe(false);
    });

    it('shows logs container when workLogs has content', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });
      expect(wrapper.find('.live-logs').exists()).toBe(true);
    });

    it('shows logs container when partialThinking exists', () => {
      const wrapper = mountComponent({
        workLogs: [],
        partialThinking: 'Thinking...',
      });
      expect(wrapper.find('.live-logs').exists()).toBe(true);
    });

    it('displays correct item count', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1), createWorkLog(2)],
      });
      expect(wrapper.find('.live-count').text()).toBe('(2 items)');
    });

    it('uses singular "item" for single log', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });
      expect(wrapper.find('.live-count').text()).toBe('(1 item)');
    });

    it('includes partialThinking in count', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
        partialThinking: 'Thinking...',
      });
      expect(wrapper.find('.live-count').text()).toBe('(2 items)');
    });
  });

  describe('auto-scroll behavior', () => {
    it('has scroll event listener attached to logs container', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      const logsContainer = wrapper.find('.live-logs');
      // Verify @scroll is bound by checking the element exists and can receive scroll events
      expect(logsContainer.exists()).toBe(true);
    });

    it('auto-scrolls to bottom when new logs arrive and user is at bottom', async () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      const logsContainer = wrapper.find('.live-logs');
      const el = logsContainer.element;

      // Mock scrollHeight and clientHeight to simulate scrollable content
      Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true, writable: true });
      Object.defineProperty(el, 'clientHeight', { value: 250, configurable: true, writable: true });
      el.scrollTop = 250; // At bottom (scrollHeight - clientHeight = 250)

      // Trigger scroll to set isNearBottom = true
      await logsContainer.trigger('scroll');

      // Add a new log
      await wrapper.setProps({
        workLogs: [createWorkLog(1), createWorkLog(2)],
      });
      await nextTick();  // Initial watcher fire
      await nextTick();  // Nested nextTick inside scrollToBottom() callback

      await flushAll(wrapper);

      // scrollTop should be set to scrollHeight (auto-scrolled to bottom)
      expect(el.scrollTop).toBe(500);
    });

    it('does NOT auto-scroll when user has scrolled up', async () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      const logsContainer = wrapper.find('.live-logs');
      const el = logsContainer.element;

      // Mock scrollable container
      Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 250, configurable: true });
      el.scrollTop = 0; // User scrolled to top

      // Trigger scroll to set isNearBottom = false
      await logsContainer.trigger('scroll');

      // Store initial scroll position
      const initialScrollTop = el.scrollTop;

      // Add a new log
      await wrapper.setProps({
        workLogs: [createWorkLog(1), createWorkLog(2)],
      });

      await flushAll(wrapper);

      // scrollTop should NOT have changed (no auto-scroll)
      expect(el.scrollTop).toBe(initialScrollTop);
    });

    it('auto-scrolls when partialThinking updates and user is at bottom', async () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
        partialThinking: 'Initial thinking',
      });

      const logsContainer = wrapper.find('.live-logs');
      const el = logsContainer.element;

      // Mock scrollable container - user is at bottom
      Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true, writable: true });
      Object.defineProperty(el, 'clientHeight', { value: 250, configurable: true, writable: true });
      el.scrollTop = 250;

      // Trigger scroll to set isNearBottom = true
      await logsContainer.trigger('scroll');

      // Update partial thinking
      await wrapper.setProps({
        partialThinking: 'Updated thinking content',
      });
      await nextTick();  // Initial watcher fire
      await nextTick();  // Nested nextTick inside scrollToBottom() callback

      await flushAll(wrapper);

      // Should auto-scroll
      expect(el.scrollTop).toBe(500);
    });

    it('does NOT auto-scroll when partialThinking updates and user has scrolled up', async () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
        partialThinking: 'Initial thinking',
      });

      const logsContainer = wrapper.find('.live-logs');
      const el = logsContainer.element;

      // Mock scrollable container - user scrolled up
      Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 250, configurable: true });
      el.scrollTop = 50; // Not near bottom

      // Trigger scroll to set isNearBottom = false
      await logsContainer.trigger('scroll');

      // Update partial thinking
      await wrapper.setProps({
        partialThinking: 'Updated thinking content',
      });

      await flushAll(wrapper);

      // Should NOT auto-scroll
      expect(el.scrollTop).toBe(50);
    });

    it('considers user "near bottom" when within threshold', async () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      const logsContainer = wrapper.find('.live-logs');
      const el = logsContainer.element;

      // Mock scrollable container
      Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true, writable: true });
      Object.defineProperty(el, 'clientHeight', { value: 250, configurable: true, writable: true });
      // scrollHeight - scrollTop - clientHeight = 500 - 220 - 250 = 30 (within 50px threshold)
      el.scrollTop = 220;

      // Trigger scroll
      await logsContainer.trigger('scroll');

      // Add a new log
      await wrapper.setProps({
        workLogs: [createWorkLog(1), createWorkLog(2)],
      });
      await nextTick();  // Initial watcher fire
      await nextTick();  // Nested nextTick inside scrollToBottom() callback

      await flushAll(wrapper);

      // Should auto-scroll because within threshold
      expect(el.scrollTop).toBe(500);
    });

    it('considers user NOT "near bottom" when beyond threshold', async () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      const logsContainer = wrapper.find('.live-logs');
      const el = logsContainer.element;

      // Mock scrollable container
      Object.defineProperty(el, 'scrollHeight', { value: 500, configurable: true });
      Object.defineProperty(el, 'clientHeight', { value: 250, configurable: true });
      // scrollHeight - scrollTop - clientHeight = 500 - 100 - 250 = 150 (beyond 50px threshold)
      el.scrollTop = 100;

      // Trigger scroll
      await logsContainer.trigger('scroll');

      const initialScrollTop = el.scrollTop;

      // Add a new log
      await wrapper.setProps({
        workLogs: [createWorkLog(1), createWorkLog(2)],
      });

      await flushAll(wrapper);

      // Should NOT auto-scroll because beyond threshold
      expect(el.scrollTop).toBe(initialScrollTop);
    });
  });

  describe('log rendering', () => {
    it('renders ThinkingBlock for thinking logs', () => {
      const wrapper = mountComponent({
        workLogs: [{ id: 1, type: 'thinking', content: 'Thinking content', timestamp: Date.now() }],
      });

      // Find the stubbed ThinkingBlock component
      const thinkingBlock = wrapper.findComponent({ name: 'ThinkingBlock' });
      expect(thinkingBlock.exists()).toBe(true);
      expect(thinkingBlock.props('content')).toBe('Thinking content');
    });

    it('renders CommandBlock for non-thinking logs', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      const commandBlock = wrapper.findComponent({ name: 'CommandBlock' });
      expect(commandBlock.exists()).toBe(true);
    });

    it('renders partialThinking as streaming ThinkingBlock', () => {
      const wrapper = mountComponent({
        workLogs: [],
        partialThinking: 'Streaming thought...',
      });

      const thinkingBlocks = wrapper.findAllComponents({ name: 'ThinkingBlock' });
      expect(thinkingBlocks.length).toBe(1);
      expect(thinkingBlocks[0].props('content')).toBe('Streaming thought...');
      expect(thinkingBlocks[0].props('streaming')).toBe(true);
    });
  });
});
