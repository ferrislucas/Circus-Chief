import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SessionChatPicker from './SessionChatPicker.vue';

describe('SessionChatPicker', () => {
  let sessions;
  let summaries;

  beforeEach(() => {
    vi.clearAllMocks();
    const now = Date.now();

    sessions = [
      {
        session: {
          id: 'root-1',
          name: 'Root Session',
          status: 'completed',
          createdAt: now - 7200000,
          lastActivityAt: now - 3600000,
        },
        pickerTimestamp: now - 3600000,
        pickerTimestampSource: 'lastMessageAt',
        depth: 0,
      },
      {
        session: {
          id: 'child-1',
          name: 'Child Session 1',
          status: 'running',
          createdAt: now - 3600000,
          lastActivityAt: now - 1800000,
        },
        pickerTimestamp: now - 1800000,
        pickerTimestampSource: 'lastMessageAt',
        depth: 1,
      },
      {
        session: {
          id: 'child-2',
          name: 'Child Session 2',
          status: 'waiting',
          createdAt: now - 1800000,
          lastActivityAt: now - 900000,
        },
        pickerTimestamp: now - 900000,
        pickerTimestampSource: 'lastMessageAt',
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

    it('renders items in the same order as the sessions prop', () => {
      const unorderedSessions = [
        { session: { id: 'older', name: 'Older', status: 'completed' }, pickerTimestamp: 1000, pickerTimestampSource: 'lastMessageAt', depth: 0 },
        { session: { id: 'newer', name: 'Newer', status: 'completed' }, pickerTimestamp: 9000, pickerTimestampSource: 'lastMessageAt', depth: 0 },
      ];
      const wrapper = mountComponent({ sessions: unorderedSessions, activeSessionId: 'older' });
      const names = wrapper.findAll('.picker-item-name').map(item => item.text());
      expect(names).toEqual(['Older', 'Newer']);
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

    it('renders pickerTimestamp with source-specific tooltip', () => {
      const wrapper = mountComponent();
      const firstItem = wrapper.findAll('.picker-item')[0];
      const dateEl = firstItem.find('.picker-item-date');
      expect(dateEl.attributes('title')).toContain('Last message:');
      expect(dateEl.text()).not.toBe('—');
      expect(dateEl.text().length).toBeGreaterThan(0);
    });

    it('renders "—" placeholder with "No activity yet" tooltip when pickerTimestamp is null', () => {
      const wrapper = mountComponent({
        sessions: [{
          session: {
            id: 's-null',
            name: 'No activity',
            status: 'waiting',
            createdAt: Date.now(),
            lastActivityAt: null,
          },
          pickerTimestamp: null,
          pickerTimestampSource: 'none',
          depth: 0,
        }],
        activeSessionId: 's-null',
        summaries: {},
      });
      const dateEl = wrapper.find('.picker-item-date');
      expect(dateEl.attributes('title')).toBe('No activity yet');
      expect(dateEl.text()).toBe('—');
    });

    it('shows timestamp source labels for message, updated, created, and none entries', () => {
      const timestamp = Date.now();
      const wrapper = mountComponent({
        sessions: [
          { session: { id: 'message', name: 'Message', status: 'completed' }, pickerTimestamp: timestamp, pickerTimestampSource: 'lastMessageAt', depth: 0 },
          { session: { id: 'updated', name: 'Updated', status: 'completed' }, pickerTimestamp: timestamp, pickerTimestampSource: 'updatedAt', depth: 0 },
          { session: { id: 'created', name: 'Created', status: 'completed' }, pickerTimestamp: timestamp, pickerTimestampSource: 'createdAt', depth: 0 },
          { session: { id: 'none', name: 'None', status: 'waiting' }, pickerTimestamp: null, pickerTimestampSource: 'none', depth: 0 },
        ],
        activeSessionId: 'message',
        summaries: {},
      });
      const items = wrapper.findAll('.picker-item');
      expect(items[0].find('.picker-item-date').attributes('title')).toContain('Last message:');
      expect(items[1].find('.picker-item-date').attributes('title')).toContain('Updated:');
      expect(items[2].find('.picker-item-date').attributes('title')).toContain('Created:');
      expect(items[3].find('.picker-item-date').attributes('title')).toBe('No activity yet');
    });

    it('uses full timestamp titles when visible labels are the same minute', () => {
      const base = new Date('2026-05-12T12:34:05.000Z').getTime();
      const wrapper = mountComponent({
        sessions: [
          { session: { id: 'first', name: 'First', status: 'completed', lastActivityAt: 1 }, pickerTimestamp: base, pickerTimestampSource: 'lastMessageAt', depth: 0 },
          { session: { id: 'second', name: 'Second', status: 'completed', lastActivityAt: 2 }, pickerTimestamp: base + 30_000, pickerTimestampSource: 'lastMessageAt', depth: 0 },
        ],
        activeSessionId: 'first',
        summaries: {},
      });
      const dates = wrapper.findAll('.picker-item-date');
      expect(dates[0].text()).toBe(dates[1].text());
      expect(dates[0].attributes('title')).not.toBe(dates[1].attributes('title'));
      expect(dates[0].attributes('title')).not.toContain('Last activity');
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
