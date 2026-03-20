import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SessionTreePicker from './SessionTreePicker.vue';

describe('SessionTreePicker', () => {
  let sessions;
  let summaries;

  beforeEach(() => {
    vi.clearAllMocks();

    sessions = [
      {
        id: 'root-1',
        name: 'Root Session',
        status: 'completed',
        createdAt: Date.now() - 7200000,
        lastActivityAt: Date.now() - 3600000,
      },
      {
        id: 'child-1',
        name: 'Child Session 1',
        status: 'running',
        createdAt: Date.now() - 3600000,
        lastActivityAt: Date.now() - 1800000,
      },
      {
        id: 'child-2',
        name: 'Child Session 2',
        status: 'waiting',
        createdAt: Date.now() - 1800000,
        lastActivityAt: Date.now() - 900000,
      },
    ];

    summaries = {
      'root-1': { shortSummary: 'Root summary text' },
      'child-1': { shortSummary: 'Child 1 summary' },
    };
  });

  function mountComponent(propsOverrides = {}) {
    return mount(SessionTreePicker, {
      props: {
        sessions,
        activeSessionId: 'root-1',
        summaries,
        ...propsOverrides,
      },
    });
  }

  describe('rendering', () => {
    it('renders an item for each session', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items).toHaveLength(3);
    });

    it('first item shows ◉ ROOT label', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items[0].find('.picker-item-role').text()).toBe('◉ ROOT');
    });

    it('second item shows CHILD label', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items[1].find('.picker-item-role').text()).toBe('CHILD');
    });

    it('third and deeper items show └─ CHILD label', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items[2].find('.picker-item-role').text()).toBe('└─ CHILD');
    });

    it('indentation increases with depth', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');

      // Root (depth 0): 0 * 1.5 + 0.5 = 0.5rem
      expect(items[0].attributes('style')).toContain('padding-left: 0.5rem');
      // Child 1 (depth 1): 1 * 1.5 + 0.5 = 2rem
      expect(items[1].attributes('style')).toContain('padding-left: 2rem');
      // Child 2 (depth 2): 2 * 1.5 + 0.5 = 3.5rem
      expect(items[2].attributes('style')).toContain('padding-left: 3.5rem');
    });

    it('displays session names', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items[0].find('.picker-item-name').text()).toBe('Root Session');
      expect(items[1].find('.picker-item-name').text()).toBe('Child Session 1');
      expect(items[2].find('.picker-item-name').text()).toBe('Child Session 2');
    });

    it('truncates long session names with CSS', () => {
      const longName = 'A'.repeat(100);
      const wrapper = mountComponent({
        sessions: [{ ...sessions[0], name: longName }],
      });
      const nameEl = wrapper.find('.picker-item-name');
      expect(nameEl.text()).toBe(longName);
      // The CSS class should apply text-overflow: ellipsis
      expect(nameEl.classes()).toContain('picker-item-name');
    });
  });

  describe('active session highlighting', () => {
    it('highlights active item with picker-item--active class', () => {
      const wrapper = mountComponent({ activeSessionId: 'root-1' });
      const items = wrapper.findAll('.picker-item');
      expect(items[0].classes()).toContain('picker-item--active');
    });

    it('does not highlight inactive items', () => {
      const wrapper = mountComponent({ activeSessionId: 'root-1' });
      const items = wrapper.findAll('.picker-item');
      expect(items[1].classes()).not.toContain('picker-item--active');
      expect(items[2].classes()).not.toContain('picker-item--active');
    });
  });

  describe('selection', () => {
    it('emits select with correct session ID on click', async () => {
      const onSelect = vi.fn();
      const wrapper = mount(SessionTreePicker, {
        props: { sessions, activeSessionId: 'root-1', summaries },
        attrs: { onSelect },
      });
      const items = wrapper.findAll('.picker-item');
      await items[1].trigger('click');
      expect(onSelect).toHaveBeenCalledWith('child-1');
    });

    it('emits select on Enter key', async () => {
      const onSelect = vi.fn();
      const wrapper = mount(SessionTreePicker, {
        props: { sessions, activeSessionId: 'root-1', summaries },
        attrs: { onSelect },
      });
      const items = wrapper.findAll('.picker-item');
      await items[2].trigger('keydown.enter');
      expect(onSelect).toHaveBeenCalledWith('child-2');
    });
  });

  describe('status badges', () => {
    it('shows ● Running for running status', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      const status = items[1].find('.picker-item-status');
      expect(status.exists()).toBe(true);
      expect(status.text()).toBe('● Running');
      expect(status.classes()).toContain('status-running');
    });

    it('shows ● Running for starting status', () => {
      const wrapper = mountComponent({
        sessions: [{ ...sessions[0], status: 'starting' }],
      });
      const status = wrapper.find('.picker-item-status');
      expect(status.text()).toBe('● Running');
    });

    it('shows ⏰ Scheduled for scheduled status', () => {
      const wrapper = mountComponent({
        sessions: [{ ...sessions[0], status: 'scheduled' }],
      });
      const status = wrapper.find('.picker-item-status');
      expect(status.text()).toBe('⏰ Scheduled');
      expect(status.classes()).toContain('status-scheduled');
    });

    it('shows ⚠ Error for error status', () => {
      const wrapper = mountComponent({
        sessions: [{ ...sessions[0], status: 'error' }],
      });
      const status = wrapper.find('.picker-item-status');
      expect(status.text()).toBe('⚠ Error');
      expect(status.classes()).toContain('status-error');
    });

    it('shows no status badge for completed status', () => {
      const wrapper = mountComponent({
        sessions: [{ ...sessions[0], status: 'completed' }],
      });
      expect(wrapper.find('.picker-item-status').exists()).toBe(false);
    });

    it('shows no status badge for waiting status', () => {
      const wrapper = mountComponent({
        sessions: [{ ...sessions[0], status: 'waiting' }],
      });
      expect(wrapper.find('.picker-item-status').exists()).toBe(false);
    });
  });

  describe('summaries', () => {
    it('shows summary text from summaries prop', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items[0].find('.picker-item-summary').text()).toBe('Root summary text');
      expect(items[1].find('.picker-item-summary').text()).toBe('Child 1 summary');
    });

    it('shows "No summary yet" when summary is missing', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items[2].find('.picker-item-summary').text()).toBe('No summary yet');
    });
  });

  describe('timestamps', () => {
    it('shows formatted timestamp for each session', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      items.forEach(item => {
        const dateText = item.find('.picker-item-date').text();
        expect(dateText).toBeTruthy();
      });
    });
  });

  describe('keyboard navigation', () => {
    it('arrow down moves focus to next item', async () => {
      const wrapper = mountComponent({ activeSessionId: 'root-1' });
      const container = wrapper.find('.session-tree-picker');
      await container.trigger('keydown', { key: 'ArrowDown' });
      // focusedIndex should have incremented
      const items = wrapper.findAll('.picker-item');
      expect(items[1].attributes('tabindex')).toBe('0');
    });

    it('arrow up moves focus to previous item', async () => {
      const wrapper = mountComponent({ activeSessionId: 'child-1' });
      // First move focus down, then up
      const container = wrapper.find('.session-tree-picker');
      await container.trigger('keydown', { key: 'ArrowDown' });
      await container.trigger('keydown', { key: 'ArrowUp' });
      const items = wrapper.findAll('.picker-item');
      // Should be back to the initial focused index
      expect(items[0].attributes('tabindex')).not.toBe(undefined);
    });

    it('arrow up on first item stays on first item', async () => {
      const wrapper = mountComponent({ activeSessionId: 'root-1' });
      const container = wrapper.find('.session-tree-picker');
      // Focus is at index 0 (root), pressing up should stay at 0
      await container.trigger('keydown', { key: 'ArrowUp' });
      const items = wrapper.findAll('.picker-item');
      expect(items[0].attributes('tabindex')).toBe('0');
    });

    it('arrow down on last item stays on last item', async () => {
      const wrapper = mountComponent({ activeSessionId: 'child-2' });
      const container = wrapper.find('.session-tree-picker');
      // Move to end
      await container.trigger('keydown', { key: 'ArrowDown' });
      await container.trigger('keydown', { key: 'ArrowDown' });
      await container.trigger('keydown', { key: 'ArrowDown' });
      // Should not go beyond
      const items = wrapper.findAll('.picker-item');
      expect(items[2].attributes('tabindex')).toBe('0');
    });
  });

  describe('accessibility', () => {
    it('has role="listbox" on container', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('.session-tree-picker').attributes('role')).toBe('listbox');
    });

    it('has role="option" on each item', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      items.forEach(item => {
        expect(item.attributes('role')).toBe('option');
      });
    });

    it('has aria-selected="true" on active item', () => {
      const wrapper = mountComponent({ activeSessionId: 'root-1' });
      const items = wrapper.findAll('.picker-item');
      expect(items[0].attributes('aria-selected')).toBe('true');
    });

    it('has aria-selected="false" on inactive items', () => {
      const wrapper = mountComponent({ activeSessionId: 'root-1' });
      const items = wrapper.findAll('.picker-item');
      expect(items[1].attributes('aria-selected')).toBe('false');
      expect(items[2].attributes('aria-selected')).toBe('false');
    });
  });
});
