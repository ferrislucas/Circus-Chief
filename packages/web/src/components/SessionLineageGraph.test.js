import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import SessionLineageGraph from './SessionLineageGraph.vue';

function makeRow(id, { session = {}, lane = 0, barStartPct = 0, barEndPct = 50, isScheduled = false } = {}) {
  return {
    session: {
      id,
      name: `Session ${id}`,
      status: 'stopped',
      createdAt: '2026-01-10T12:00:00Z',
      updatedAt: '2026-01-10T12:10:00Z',
      ...session,
    },
    lane,
    barStartPct,
    barEndPct,
    isScheduled,
  };
}

function mountGraph(rows, props = {}) {
  return mount(SessionLineageGraph, {
    props: { rows, currentSessionId: null, ...props },
  });
}

describe('SessionLineageGraph', () => {
  it('renders one row per input row in order, with data-session-id', () => {
    const rows = [makeRow('a'), makeRow('b'), makeRow('c')];
    const wrapper = mountGraph(rows);
    const rowEls = wrapper.findAll('[data-session-id]');
    expect(rowEls.map((el) => el.attributes('data-session-id'))).toEqual(['a', 'b', 'c']);
  });

  it('highlights the current session row', () => {
    const rows = [makeRow('a'), makeRow('b')];
    const wrapper = mountGraph(rows, { currentSessionId: 'b' });
    const current = wrapper.find('[data-session-id="b"]');
    expect(current.classes()).toContain('lineage-row--current');
    expect(wrapper.find('[data-session-id="a"]').classes()).not.toContain('lineage-row--current');
  });

  it('emits open-session with the session id on click and Enter, per row', async () => {
    // Note: wrapper.emitted() is unreliable with Vue 3 script setup SFCs
    // (known Vue Test Utils limitation) — capture via attrs listener,
    // same pattern as ScheduledChildCard.test.js.
    const spy = vi.fn();
    const rows = [makeRow('a'), makeRow('b')];
    const wrapper = mount(SessionLineageGraph, {
      props: { rows, currentSessionId: null },
      attrs: { onOpenSession: spy },
    });
    await wrapper.find('[data-session-id="a"]').trigger('click');
    await wrapper.find('[data-session-id="b"]').trigger('keydown.enter');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'a');
    expect(spy).toHaveBeenNthCalledWith(2, 'b');
  });

  it('renders nothing for empty rows and single-row input', () => {
    expect(mountGraph([]).find('[data-testid="session-lineage-graph"]').exists()).toBe(false);
    expect(mountGraph([makeRow('only')]).find('[data-testid="session-lineage-graph"]').exists()).toBe(false);
  });

  it('collapses beyond 8 rows behind a "Show all N sessions" expander', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(`s${i}`));
    const wrapper = mountGraph(rows);
    expect(wrapper.findAll('[data-session-id]')).toHaveLength(8);
    const expander = wrapper.find('.lineage-expander');
    expect(expander.exists()).toBe(true);
    expect(expander.text()).toContain('Show all 10 sessions');
    await expander.trigger('click');
    expect(wrapper.findAll('[data-session-id]')).toHaveLength(10);
  });

  it('renders scheduled rows with hollow/dashed styling', () => {
    const rows = [
      makeRow('a'),
      makeRow('sched', {
        session: { status: 'scheduled', scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() },
        isScheduled: true,
      }),
    ];
    const wrapper = mountGraph(rows);
    expect(wrapper.find('[data-session-id="sched"]').classes()).toContain('lineage-row--scheduled');
    expect(wrapper.find('[data-session-id="sched"] .lineage-time').text()).toMatch(/^in /);
  });

  it('labels every row with aria-label="Open session <name>"', () => {
    const rows = [makeRow('a', { session: { name: 'Fix auth flow' } }), makeRow('b')];
    const wrapper = mountGraph(rows);
    expect(wrapper.find('[data-session-id="a"]').attributes('aria-label')).toBe('Open session Fix auth flow');
    expect(wrapper.find('[data-session-id="b"]').attributes('aria-label')).toBe('Open session Session b');
  });
});
