import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, defineComponent } from 'vue';
import WorkLogPanel from './WorkLogPanel.vue';

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

// Stub child components - use defineComponent for better compatibility
const ThinkingBlockStub = defineComponent({
  name: 'ThinkingBlock',
  template: '<div class="thinking-block-stub">{{ content }}</div>',
  props: ['content', 'timestamp', 'streaming'],
});

const CommandBlockStub = defineComponent({
  name: 'CommandBlock',
  template: '<div class="command-block-stub">{{ log.content }}</div>',
  props: ['log'],
});

describe('WorkLogPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mountComponent(props = {}) {
    return mount(WorkLogPanel, {
      props,
      global: {
        stubs: {
          'thinking-block': ThinkingBlockStub,
          'command-block': CommandBlockStub,
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
    it('does not render when workLogs is empty', () => {
      const wrapper = mountComponent({ workLogs: [] });
      expect(wrapper.find('.work-log-panel').exists()).toBe(false);
    });

    it('renders when workLogs has content', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });
      expect(wrapper.find('.work-log-panel').exists()).toBe(true);
    });

    it('displays correct item count', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1), createWorkLog(2), createWorkLog(3)],
      });
      expect(wrapper.find('.work-log-count').text()).toBe('(3)');
    });

    it('renders ThinkingBlock for thinking logs', () => {
      const wrapper = mountComponent({
        workLogs: [{ id: 1, type: 'thinking', content: 'Thinking content', timestamp: Date.now() }],
      });

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
  });

  describe('collapsed by default behavior', () => {
    it('starts collapsed by default', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      const details = wrapper.find('details');
      expect(details.exists()).toBe(true);
      // details element should NOT have open attribute
      expect(details.attributes('open')).toBeUndefined();
    });

    it('chevron is not in expanded state initially', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      const chevron = wrapper.find('.work-log-chevron');
      expect(chevron.classes()).not.toContain('expanded');
    });

    it('work-log-content is not visible when collapsed', () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      // When details is closed, content should not be visible
      // (browser handles this via details/summary behavior)
      const details = wrapper.find('details');
      expect(details.attributes('open')).toBeUndefined();
    });
  });

  describe('toggle behavior', () => {
    it('expands when details is toggled open', async () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      const details = wrapper.find('details');
      const detailsEl = details.element;

      // Simulate opening the details element
      detailsEl.open = true;
      await details.trigger('toggle');
      await flushAll(wrapper);

      // After toggle, chevron should be expanded
      const chevron = wrapper.find('.work-log-chevron');
      expect(chevron.classes()).toContain('expanded');
    });

    it('collapses when details is toggled closed', async () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      const details = wrapper.find('details');
      const detailsEl = details.element;

      // First expand
      detailsEl.open = true;
      await details.trigger('toggle');
      await flushAll(wrapper);
      expect(wrapper.find('.work-log-chevron').classes()).toContain('expanded');

      // Then collapse
      detailsEl.open = false;
      await details.trigger('toggle');
      await flushAll(wrapper);
      expect(wrapper.find('.work-log-chevron').classes()).not.toContain('expanded');
    });
  });

  describe('multiple work logs', () => {
    it('renders all work logs', () => {
      const wrapper = mountComponent({
        workLogs: [
          createWorkLog(1),
          createWorkLog(2),
          { id: 3, type: 'thinking', content: 'A thought', timestamp: Date.now() },
        ],
      });

      const items = wrapper.findAll('.work-log-item');
      expect(items.length).toBe(3);
    });

    it('renders mixed thinking and command blocks correctly', () => {
      const wrapper = mountComponent({
        workLogs: [
          { id: 1, type: 'thinking', content: 'Thought 1', timestamp: Date.now() },
          createWorkLog(2),
          { id: 3, type: 'thinking', content: 'Thought 2', timestamp: Date.now() },
        ],
      });

      const thinkingBlocks = wrapper.findAllComponents({ name: 'ThinkingBlock' });
      const commandBlocks = wrapper.findAllComponents({ name: 'CommandBlock' });

      expect(thinkingBlocks.length).toBe(2);
      expect(commandBlocks.length).toBe(1);
    });
  });

  describe('stays collapsed when logs are added', () => {
    it('remains collapsed when workLogs prop is updated', async () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      // Initially collapsed
      expect(wrapper.find('details').attributes('open')).toBeUndefined();

      // Add more logs
      await wrapper.setProps({
        workLogs: [createWorkLog(1), createWorkLog(2), createWorkLog(3)],
      });

      // Should still be collapsed
      expect(wrapper.find('details').attributes('open')).toBeUndefined();
      expect(wrapper.find('.work-log-chevron').classes()).not.toContain('expanded');
    });

    it('count updates when logs are added but remains collapsed', async () => {
      const wrapper = mountComponent({
        workLogs: [createWorkLog(1)],
      });

      expect(wrapper.find('.work-log-count').text()).toBe('(1)');

      await wrapper.setProps({
        workLogs: [createWorkLog(1), createWorkLog(2)],
      });
      await flushAll(wrapper);

      // Count updated
      expect(wrapper.find('.work-log-count').text()).toBe('(2)');
      // But still collapsed
      expect(wrapper.find('details').attributes('open')).toBeUndefined();
    });
  });
});
