import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SessionChatPicker from './SessionChatPicker.vue';

describe('SessionChatPicker', () => {
  let sessions;
  let summaries;

  beforeEach(() => {
    vi.clearAllMocks();

    sessions = [
      {
        session: {
          id: 'root-1',
          name: 'Root Session',
          status: 'completed',
          createdAt: Date.now() - 7200000,
          lastActivityAt: Date.now() - 3600000,
        },
        depth: 0,
      },
      {
        session: {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'running',
          createdAt: Date.now() - 3600000,
          lastActivityAt: Date.now() - 1800000,
        },
        depth: 1,
      },
      {
        session: {
          id: 'child-2',
          name: 'Child Session 2',
          status: 'waiting',
          createdAt: Date.now() - 1800000,
          lastActivityAt: Date.now() - 900000,
        },
        depth: 1,
      },
    ];

    summaries = {
      'root-1': { shortSummary: 'Root summary text' },
      'child-1': { shortSummary: 'Child 1 summary' },
    };
  });

  function mountComponent(propsOverrides = {}) {
    return mount(SessionChatPicker, {
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

    it('all items show empty role label but element exists', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      // All items should have empty role labels
      items.forEach(item => {
        const roleEl = item.find('.picker-item-role');
        expect(roleEl.exists()).toBe(true); // Element still exists in DOM
        expect(roleEl.text()).toBe(''); // But contains no text
      });
    });

    it('no items have picker-item--root class', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      // No items should have the picker-item--root class
      items.forEach(item => {
        expect(item.classes()).not.toContain('picker-item--root');
      });
    });

    it('items have no depth-based padding (uniform alignment)', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      // All items should have no inline padding-left style — uniform CSS padding applies
      items.forEach(item => {
        expect(item.attributes('style')).toBeUndefined();
      });
    });

    it('renders correctly with single session (no children)', () => {
      const singleSession = [{
        session: {
          id: 'single-1',
          name: 'Only Session',
          status: 'completed',
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
        },
        depth: 0,
      }];
      const wrapper = mount(SessionChatPicker, {
        props: {
          sessions: singleSession,
          activeSessionId: 'single-1',
          summaries: {},
        },
      });

      const items = wrapper.findAll('.picker-item');
      expect(items).toHaveLength(1);
      expect(items[0].find('.picker-item-role').exists()).toBe(true);
      expect(items[0].find('.picker-item-role').text()).toBe('');
      expect(items[0].attributes('style')).toBeUndefined();
    });

    it('status badges display correctly without hierarchy labels', () => {
      const sessionsWithStatuses = [
        { session: { id: 's1', name: 'Session 1', status: 'running', createdAt: Date.now(), lastActivityAt: Date.now() }, depth: 0 },
        { session: { id: 's2', name: 'Session 2', status: 'completed', createdAt: Date.now(), lastActivityAt: Date.now() }, depth: 1 },
        { session: { id: 's3', name: 'Session 3', status: 'error', createdAt: Date.now(), lastActivityAt: Date.now() }, depth: 1 },
      ];
      const wrapper = mount(SessionChatPicker, {
        props: {
          sessions: sessionsWithStatuses,
          activeSessionId: 's1',
          summaries: {},
        },
      });

      const items = wrapper.findAll('.picker-item');
      // Item at index 0 (running) should have status badge
      expect(items[0].find('.picker-item-status').text()).toBe('● Running');
      // Item at index 1 (completed) should have no status badge
      expect(items[1].find('.picker-item-status').exists()).toBe(false);
      // Item at index 2 (error) should have no status badge
      expect(items[2].find('.picker-item-status').exists()).toBe(false);
    });

    it('all items at the same depth have consistent alignment', () => {
      const manySessions = Array.from({ length: 10 }, (_, i) => ({
        session: {
          id: `s-${i}`,
          name: `Session ${i}`,
          status: 'completed',
          createdAt: Date.now() - (i * 1000000),
          lastActivityAt: Date.now() - (i * 500000),
        },
        depth: 1,
      }));
      const wrapper = mount(SessionChatPicker, {
        props: {
          sessions: manySessions,
          activeSessionId: 's-0',
          summaries: {},
        },
      });

      const items = wrapper.findAll('.picker-item');
      expect(items).toHaveLength(10);
      // All items should have no inline padding style — uniform CSS padding applies
      items.forEach(item => {
        expect(item.attributes('style')).toBeUndefined();
      });
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
        sessions: [{ session: { ...sessions[0].session, name: longName }, depth: 0 }],
      });
      const nameEl = wrapper.find('.picker-item-name');
      expect(nameEl.text()).toBe(longName);
      // The CSS class should apply text-overflow: ellipsis
      expect(nameEl.classes()).toContain('picker-item-name');
    });

    it('items at all depths have uniform alignment (no indentation)', () => {
      const deepSessions = [
        { session: { id: 'd0', name: 'Root', status: 'completed', createdAt: Date.now(), lastActivityAt: Date.now() }, depth: 0 },
        { session: { id: 'd1', name: 'Child', status: 'completed', createdAt: Date.now(), lastActivityAt: Date.now() }, depth: 1 },
        { session: { id: 'd2', name: 'Grandchild', status: 'completed', createdAt: Date.now(), lastActivityAt: Date.now() }, depth: 2 },
      ];
      const wrapper = mount(SessionChatPicker, {
        props: {
          sessions: deepSessions,
          activeSessionId: 'd0',
          summaries: {},
        },
      });

      const items = wrapper.findAll('.picker-item');
      // No inline style — uniform CSS padding applies to all depths
      items.forEach(item => {
        expect(item.attributes('style')).toBeUndefined();
      });
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
      const wrapper = mount(SessionChatPicker, {
        props: { sessions, activeSessionId: 'root-1', summaries },
        attrs: { onSelect },
      });
      const items = wrapper.findAll('.picker-item');
      await items[1].trigger('click');
      expect(onSelect).toHaveBeenCalledWith('child-1');
    });

    it('emits select on Enter key', async () => {
      const onSelect = vi.fn();
      const wrapper = mount(SessionChatPicker, {
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
        sessions: [{ session: { ...sessions[0].session, status: 'starting' }, depth: 0 }],
      });
      const status = wrapper.find('.picker-item-status');
      expect(status.text()).toBe('● Running');
    });

    it('shows ⏰ Scheduled for scheduled status', () => {
      const wrapper = mountComponent({
        sessions: [{ session: { ...sessions[0].session, status: 'scheduled' }, depth: 0 }],
      });
      const status = wrapper.find('.picker-item-status');
      expect(status.text()).toBe('⏰ Scheduled');
      expect(status.classes()).toContain('status-scheduled');
    });

    it('shows no status badge for error status', () => {
      const wrapper = mountComponent({
        sessions: [{ session: { ...sessions[0].session, status: 'error' }, depth: 0 }],
      });
      expect(wrapper.find('.picker-item-status').exists()).toBe(false);
    });

    it('shows no status badge for completed status', () => {
      const wrapper = mountComponent({
        sessions: [{ session: { ...sessions[0].session, status: 'completed' }, depth: 0 }],
      });
      expect(wrapper.find('.picker-item-status').exists()).toBe(false);
    });

    it('shows no status badge for waiting status', () => {
      const wrapper = mountComponent({
        sessions: [{ session: { ...sessions[0].session, status: 'waiting' }, depth: 0 }],
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

    it('renders lastActivityAt when present with "Last activity" tooltip', () => {
      const wrapper = mountComponent();
      const firstItem = wrapper.findAll('.picker-item')[0];
      const dateEl = firstItem.find('.picker-item-date');
      expect(dateEl.attributes('title')).toBe('Last activity');
      expect(dateEl.text()).not.toBe('—');
      expect(dateEl.text().length).toBeGreaterThan(0);
    });

    it('renders "—" placeholder with "No activity yet" tooltip when lastActivityAt is null', () => {
      const wrapper = mountComponent({
        sessions: [{
          session: {
            id: 's-null',
            name: 'No activity',
            status: 'waiting',
            createdAt: Date.now(),
            lastActivityAt: null,
          },
          depth: 0,
        }],
        activeSessionId: 's-null',
        summaries: {},
      });
      const dateEl = wrapper.find('.picker-item-date');
      expect(dateEl.attributes('title')).toBe('No activity yet');
      expect(dateEl.text()).toBe('—');
    });

    it('flips tooltip between "Last activity" and "No activity yet" based on value', () => {
      const wrapper = mountComponent({
        sessions: [
          { session: { id: 'has', name: 'Has', status: 'completed', createdAt: Date.now(), lastActivityAt: Date.now() }, depth: 0 },
          { session: { id: 'none', name: 'None', status: 'waiting', createdAt: Date.now(), lastActivityAt: null }, depth: 0 },
        ],
        activeSessionId: 'has',
        summaries: {},
      });
      const items = wrapper.findAll('.picker-item');
      expect(items[0].find('.picker-item-date').attributes('title')).toBe('Last activity');
      expect(items[1].find('.picker-item-date').attributes('title')).toBe('No activity yet');
    });
  });

  describe('keyboard navigation', () => {
    it('arrow down moves focus to next item', async () => {
      const wrapper = mountComponent({ activeSessionId: 'root-1' });
      const container = wrapper.find('.session-chat-picker');
      await container.trigger('keydown', { key: 'ArrowDown' });
      // focusedIndex should have incremented
      const items = wrapper.findAll('.picker-item');
      expect(items[1].attributes('tabindex')).toBe('0');
    });

    it('arrow up moves focus to previous item', async () => {
      const wrapper = mountComponent({ activeSessionId: 'child-1' });
      // First move focus down, then up
      const container = wrapper.find('.session-chat-picker');
      await container.trigger('keydown', { key: 'ArrowDown' });
      await container.trigger('keydown', { key: 'ArrowUp' });
      const items = wrapper.findAll('.picker-item');
      // Should be back to the initial focused index
      expect(items[0].attributes('tabindex')).not.toBe(undefined);
    });

    it('arrow up on first item stays on first item', async () => {
      const wrapper = mountComponent({ activeSessionId: 'root-1' });
      const container = wrapper.find('.session-chat-picker');
      // Focus is at index 0 (root), pressing up should stay at 0
      await container.trigger('keydown', { key: 'ArrowUp' });
      const items = wrapper.findAll('.picker-item');
      expect(items[0].attributes('tabindex')).toBe('0');
    });

    it('arrow down on last item stays on last item', async () => {
      const wrapper = mountComponent({ activeSessionId: 'child-2' });
      const container = wrapper.find('.session-chat-picker');
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
      expect(wrapper.find('.session-chat-picker').attributes('role')).toBe('listbox');
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
