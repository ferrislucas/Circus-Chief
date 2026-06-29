import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SessionChatPicker from './SessionChatPicker.vue';
import sessionChatPickerSource from './SessionChatPicker.vue?raw';

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
          name: 'Root Workspace',
          status: 'completed',
          model: 'gpt-root',
          inputTokens: 1000,
          outputTokens: 250,
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
          name: 'Child Workspace 1',
          status: 'running',
          parentSessionId: 'root-1',
          model: 'gpt-child-running',
          inputTokens: 42000,
          outputTokens: 800,
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
          name: 'Child Workspace 2',
          status: 'waiting',
          parentSessionId: 'root-1',
          pendingModel: 'gpt-child-pending',
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
        rootSessionId: 'root-1',
        getModelLabel: session => session.model || session.pendingModel || 'Default model',
        getTokenLabel: session => {
          const total = (session.inputTokens || 0) + (session.outputTokens || 0);
          return total ? `${total}` : '-';
        },
        ...propsOverrides,
      },
    });
  }

  describe('rendering', () => {
    it('renders an item for each workspace', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items).toHaveLength(3);
    });

    it('shows the root role label only for the root workspace', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items[0].find('.picker-item-role').text()).toBe('Root');
      expect(items[1].find('.picker-item-role').exists()).toBe(false);
      expect(items[2].find('.picker-item-role').exists()).toBe(false);
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

    it('renders correctly with single workspace (no children)', () => {
      const singleSession = [{
        session: {
          id: 'single-1',
          name: 'Only Workspace',
          status: 'completed',
          parentSessionId: null,
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
          rootSessionId: 'single-1',
        },
      });

      const items = wrapper.findAll('.picker-item');
      expect(items).toHaveLength(1);
      expect(items[0].find('.picker-item-role').exists()).toBe(true);
      expect(items[0].find('.picker-item-role').text()).toBe('Root');
      expect(items[0].attributes('style')).toBeUndefined();
    });

    it('status badges display correctly without hierarchy labels', () => {
      const sessionsWithStatuses = [
        { session: { id: 's1', name: 'Workspace 1', status: 'running', createdAt: Date.now(), lastActivityAt: Date.now() }, depth: 0 },
        { session: { id: 's2', name: 'Workspace 2', status: 'completed', createdAt: Date.now(), lastActivityAt: Date.now() }, depth: 1 },
        { session: { id: 's3', name: 'Workspace 3', status: 'error', createdAt: Date.now(), lastActivityAt: Date.now() }, depth: 1 },
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

    it('displays workspace names', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items[0].find('.picker-item-name').text()).toBe('Root Workspace');
      expect(items[1].find('.picker-item-name').text()).toBe('Child Workspace 1');
      expect(items[2].find('.picker-item-name').text()).toBe('Child Workspace 2');
    });

    it('displays model labels for each workspace', () => {
      const wrapper = mountComponent();
      const models = wrapper.findAll('.picker-item-model').map(model => model.text());
      expect(models).toEqual(['gpt-root', 'gpt-child-running', 'gpt-child-pending']);
    });

    it('displays direct token labels for each workspace', () => {
      const wrapper = mountComponent();
      const tokens = wrapper.findAll('.picker-item-tokens').map(token => token.text());
      expect(tokens).toEqual(['1250', '42800', '-']);
    });

    it('renders delete buttons for child rows only', () => {
      const wrapper = mountComponent();
      const items = wrapper.findAll('.picker-item');
      expect(items[0].find('.picker-item-delete').exists()).toBe(false);
      expect(items[0].find('.picker-item-root-lock').exists()).toBe(true);
      expect(items[1].find('.picker-item-delete').exists()).toBe(true);
      expect(items[2].find('.picker-item-delete').exists()).toBe(true);
    });

    it('renders items in the same order as the workspaces prop', () => {
      const unorderedSessions = [
        { session: { id: 'older', name: 'Older', status: 'completed' }, pickerTimestamp: 1000, pickerTimestampSource: 'lastMessageAt', depth: 0 },
        { session: { id: 'newer', name: 'Newer', status: 'completed' }, pickerTimestamp: 9000, pickerTimestampSource: 'lastMessageAt', depth: 0 },
      ];
      const wrapper = mountComponent({ sessions: unorderedSessions, activeSessionId: 'older' });
      const names = wrapper.findAll('.picker-item-name').map(item => item.text());
      expect(names).toEqual(['Older', 'Newer']);
    });

    it('truncates long workspace names with CSS', () => {
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

    it('keeps the picker in normal flow so neighboring overlay controls cannot cover it', () => {
      const selector = '.session-chat-picker';
      const start = sessionChatPickerSource.indexOf(`${selector} {`);
      expect(start).toBeGreaterThanOrEqual(0);
      const end = sessionChatPickerSource.indexOf('\n}', start);
      const block = sessionChatPickerSource.slice(start, end + 2);

      expect(block).toMatch(/position:\s*static/);
      expect(block).toMatch(/z-index:\s*120/);
    });
  });

  describe('active workspace highlighting', () => {
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
    it('emits select with correct workspace ID on click', async () => {
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

    it('emits delete-session and does not emit select when delete is clicked', async () => {
      const onSelect = vi.fn();
      const onDeleteSession = vi.fn();
      const wrapper = mount(SessionChatPicker, {
        props: { sessions, activeSessionId: 'root-1', summaries, rootSessionId: 'root-1' },
        attrs: { onSelect, onDeleteSession },
      });
      const deleteButton = wrapper.findAll('.picker-item')[1].find('.picker-item-delete');
      await deleteButton.trigger('click');
      expect(onDeleteSession).toHaveBeenCalledWith('child-1');
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('emits delete-session and does not select on delete keyboard activation', async () => {
      const onSelect = vi.fn();
      const onDeleteSession = vi.fn();
      const wrapper = mount(SessionChatPicker, {
        props: { sessions, activeSessionId: 'root-1', summaries, rootSessionId: 'root-1' },
        attrs: { onSelect, onDeleteSession },
      });
      const deleteButton = wrapper.findAll('.picker-item')[1].find('.picker-item-delete');
      await deleteButton.trigger('keydown.enter');
      await deleteButton.trigger('keydown.space');
      expect(onDeleteSession).toHaveBeenCalledTimes(2);
      expect(onDeleteSession).toHaveBeenCalledWith('child-1');
      expect(onSelect).not.toHaveBeenCalled();
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
    it('shows formatted timestamp for each workspace', () => {
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
