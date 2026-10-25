import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import SessionLineageGraph from './SessionLineageGraph.vue';
import { buildLineageRows } from '../utils/sessionLineageLanes.js';
import { useTiersStore } from '../stores/tiers.js';

beforeEach(() => {
  setActivePinia(createPinia());
});

const T0 = new Date('2026-01-10T12:00:00Z').getTime();
const MIN = 60 * 1000;

function lineageSession(id, overrides = {}) {
  return {
    id,
    name: id,
    status: 'stopped',
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    ...overrides,
  };
}

function forkRows() {
  return buildLineageRows(
    [
      lineageSession('root'),
      lineageSession('a', {
        parentSessionId: 'root',
        createdAt: new Date(T0 + 10 * MIN).toISOString(),
        updatedAt: new Date(T0 + 10 * MIN).toISOString(),
      }),
      lineageSession('b', {
        parentSessionId: 'root',
        createdAt: new Date(T0 + 20 * MIN).toISOString(),
        updatedAt: new Date(T0 + 20 * MIN).toISOString(),
      }),
      lineageSession('c', {
        parentSessionId: 'b',
        createdAt: new Date(T0 + 30 * MIN).toISOString(),
        updatedAt: new Date(T0 + 30 * MIN).toISOString(),
      }),
      lineageSession('d', {
        parentSessionId: 'a',
        createdAt: new Date(T0 + 40 * MIN).toISOString(),
        updatedAt: new Date(T0 + 40 * MIN).toISOString(),
      }),
    ],
    { now: T0 + 60 * MIN }
  );
}

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

  it('emits open-session with the session id on click, per row', async () => {
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
    await wrapper.find('[data-session-id="b"]').trigger('click');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'a');
    expect(spy).toHaveBeenNthCalledWith(2, 'b');
  });

  it('emits exactly once per keyboard activation (Enter/ Space use native click)', async () => {
    // Regression: a native <button> already dispatches click on Enter/Space,
    // so a separate @keydown.enter handler double-fires navigation. Simulate
    // the real browser sequence (keydown followed by the implied click) and
    // require exactly one emission.
    const spy = vi.fn();
    const rows = [makeRow('a'), makeRow('b')];
    const wrapper = mount(SessionLineageGraph, {
      props: { rows, currentSessionId: null },
      attrs: { onOpenSession: spy },
    });
    await wrapper.find('[data-session-id="a"]').trigger('keydown.enter');
    await wrapper.find('[data-session-id="a"]').trigger('click');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('a');
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

  it('draws a lane line only for lanes alive at that row', () => {
    const wrapper = mountGraph(forkRows());
    // The fork opens a second lane, but the last row's branch is finished.
    const lastRowLines = wrapper.find('[data-session-id="d"]').findAll('.lineage-lane-line');
    expect(lastRowLines).toHaveLength(1);
    // A mid-fork row still shows both the through-lane and its own lane.
    const midRowLines = wrapper.find('[data-session-id="b"]').findAll('.lineage-lane-line');
    expect(midRowLines).toHaveLength(2);
  });

  it('renders a fork tick where a child leaves its parent lane', () => {
    const wrapper = mountGraph(forkRows());
    expect(wrapper.find('[data-session-id="root"]').findAll('.lineage-fork-tick')).toHaveLength(1);
    expect(wrapper.find('[data-session-id="a"]').findAll('.lineage-fork-tick')).toHaveLength(0);
    expect(wrapper.find('[data-session-id="d"]').findAll('.lineage-fork-tick')).toHaveLength(0);
  });

  it('keeps the current session row visible when it is past the collapse limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(`s${i}`));
    const wrapper = mountGraph(rows, { currentSessionId: 's9' });
    const shownIds = wrapper.findAll('[data-session-id]')
      .map((el) => el.attributes('data-session-id'));
    expect(shownIds).toContain('s9');
    expect(shownIds).toHaveLength(8);
    expect(wrapper.find('[data-session-id="s9"] .lineage-current-marker').exists()).toBe(true);
    expect(wrapper.find('.lineage-expander').exists()).toBe(true);
  });

  it('collapses to the first rows when the current session is within the limit', () => {
    const rows = Array.from({ length: 10 }, (_, i) => makeRow(`s${i}`));
    const wrapper = mountGraph(rows, { currentSessionId: 's2' });
    expect(wrapper.findAll('[data-session-id]')
      .map((el) => el.attributes('data-session-id')))
      .toEqual(rows.slice(0, 8).map((r) => r.session.id));
  });

  it('labels every row with aria-label="Open session <name>"', () => {
    const rows = [makeRow('a', { session: { name: 'Fix auth flow' } }), makeRow('b')];
    const wrapper = mountGraph(rows);
    expect(wrapper.find('[data-session-id="a"]').attributes('aria-label')).toBe('Open session Fix auth flow');
    expect(wrapper.find('[data-session-id="b"]').attributes('aria-label')).toBe('Open session Session b');
  });

  it('shows the resolved concrete model, not the tier, for tier-bound sessions', () => {
    const rows = [
      makeRow('a', { session: { model: 'tier::tier-1', resolvedModel: 'claude-sonnet-5' } }),
      makeRow('b', { session: { model: 'claude-opus-4-8' } }),
    ];
    const wrapper = mountGraph(rows);
    const label = wrapper.find('[data-session-id="a"] .lineage-model');
    expect(label.exists()).toBe(true);
    expect(label.text()).toBe('Sonnet 5');
    expect(label.text()).not.toContain('tier::');
    expect(wrapper.find('[data-session-id="a"]').attributes('title')).toContain('Sonnet 5');
    expect(wrapper.find('[data-session-id="a"]').attributes('title')).not.toContain('tier::tier-1');
  });

  it('falls back to the tier label when a tier-bound session has no resolved model yet', () => {
    useTiersStore().tiers = [{ id: 'tier-1', name: 'High' }];
    const rows = [
      makeRow('a', { session: { model: 'tier::tier-1', resolvedModel: null } }),
      makeRow('b'),
    ];
    const wrapper = mountGraph(rows);
    const label = wrapper.find('[data-session-id="a"] .lineage-model');
    expect(label.exists()).toBe(true);
    expect(label.text()).toBe('Tier: High');
    expect(label.text()).not.toContain('tier::');
  });

  it('shows the friendly display name for concrete model ids', () => {
    const rows = [
      makeRow('a', { session: { model: 'claude-sonnet-5' } }),
      makeRow('b', { session: { model: 'gpt-5.6-sol' } }),
    ];
    const wrapper = mountGraph(rows);
    expect(wrapper.find('[data-session-id="a"] .lineage-model').text()).toBe('Sonnet 5');
    expect(wrapper.find('[data-session-id="b"] .lineage-model').text()).not.toBe('gpt-5.6-sol');
  });

  it('renders no per-row status dot (status lives on the gutter node; legend keeps its dots)', () => {
    const rows = [makeRow('a'), makeRow('b')];
    const wrapper = mountGraph(rows, { currentSessionId: 'b' });
    expect(wrapper.findAll('.lineage-legend .lineage-dot').length).toBeGreaterThan(0);
    expect(wrapper.findAll('.lineage-row .lineage-dot')).toHaveLength(0);
  });
});
