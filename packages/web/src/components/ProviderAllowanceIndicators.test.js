import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useProviderAllowancesStore } from '../stores/providerAllowances.js';
import { api } from '../composables/useApi.js';

const { websocketListeners } = vi.hoisted(() => ({ websocketListeners: new Map() }));
vi.mock('../composables/useApi.js', () => ({
  api: { getProviderAllowances: vi.fn().mockResolvedValue({ snapshots: [], activeProviderIds: [] }) },
}));
vi.mock('../composables/useWebSocket.js', () => ({
  useWebSocket: () => ({
    on: vi.fn((event, handler) => websocketListeners.set(event, handler)),
    off: vi.fn((event) => websocketListeners.delete(event)),
    onReconnect: vi.fn(() => vi.fn()),
  }),
}));

import ProviderAllowanceIndicators from './ProviderAllowanceIndicators.vue';

describe('ProviderAllowanceIndicators', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    websocketListeners.clear();
    api.getProviderAllowances.mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  function seedSnapshots(count) {
    const store = useProviderAllowancesStore();
    store.snapshots = Array.from({ length: count }, (_, index) => ({
      providerId: `provider-${index}`,
      providerName: `Provider ${index + 1}`,
      status: 'available',
      allowances: [],
    }));
  }

  function snapshot({ providerId = 'openai', providerName = null, providerKind = 'openai', status = 'available', resetsAt = null, source = 'provider', updatedAt = null, lastUsedAt = null, unavailableReason = null, allowances } = {}) {
    return {
      providerId,
      providerName: providerName ?? (providerId === 'openai' ? 'OpenAI' : providerId),
      providerKind,
      status,
      source,
      updatedAt,
      staleAt: null,
      lastUsedAt,
      unavailableReason,
      allowances: allowances ?? [{ key: 'requests', label: 'Requests', remaining: 25, limit: 100, remainingPercent: 25, unit: 'requests', resetsAt }],
    };
  }

  it('renders an undefined status as Unknown instead of crashing', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [{
      providerId: 'openai',
      providerName: 'OpenAI',
      providerKind: 'openai',
      status: undefined,
      source: 'provider',
      updatedAt: null,
      staleAt: null,
      unavailableReason: null,
      allowances: [],
    }];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    await nextTick();

    const item = wrapper.get('[data-testid="provider-allowance-trigger"]');
    expect(item.attributes('aria-label')).toContain('Unknown');

    await wrapper.find('[data-testid="provider-allowance-trigger"]').trigger('click');
    await nextTick();

    expect(wrapper.find('.provider-detail').text()).toContain('Unknown');
    wrapper.unmount();
  });

  it('renders nothing when the disabled allowance response is empty', async () => {
    api.getProviderAllowances.mockResolvedValueOnce({ snapshots: [], activeProviderIds: [] });
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await Promise.resolve();
    expect(wrapper.find('[data-testid="provider-allowance-indicators"]').exists()).toBe(false);
  });

  it('applies a real provider allowance WebSocket envelope without a REST refresh', async () => {
    const store = useProviderAllowancesStore();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.snapshots = [snapshot({
      allowances: [{ key: 'requests', label: 'Requests', remaining: 90, limit: 100, remainingPercent: 90, unit: 'requests', resetsAt: null }],
    })];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    api.getProviderAllowances.mockClear();

    const onAllowanceUpdate = websocketListeners.get('provider:allowance_updated');
    onAllowanceUpdate({
      type: 'provider:allowance_updated',
      snapshot: snapshot({
        status: 'critical',
        allowances: [{ key: 'requests', label: 'Requests', remaining: 5, limit: 100, remainingPercent: 5, unit: 'requests', resetsAt: null }],
      }),
    });
    await nextTick();

    expect(api.getProviderAllowances).not.toHaveBeenCalled();
    expect(store.snapshots[0].allowances[0].remainingPercent).toBe(5);
    expect(wrapper.get('[data-testid="provider-allowance-trigger"]').attributes('aria-label')).toContain('5%');
    expect(wrapper.get('[data-testid="provider-allowance-trigger"]').find('.battery-fill').attributes('width')).toBe('0.85');

    onAllowanceUpdate({ type: 'provider:allowance_updated', snapshot: { providerId: 'invalid' } });
    onAllowanceUpdate({ type: 'provider:allowance_updated', snapshot: snapshot(), rawProviderHeader: 'secret' });
    expect(store.snapshots[0].allowances[0].remainingPercent).toBe(5);
    expect(warning).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('preserves the server recency order after a live allowance update when active providers are unknown', async () => {
    api.getProviderAllowances.mockResolvedValueOnce({
      snapshots: [
        snapshot({ providerId: 'active', status: 'available', lastUsedAt: 2000 }),
        snapshot({ providerId: 'attention', status: 'warning', lastUsedAt: 1000 }),
      ],
      activeProviderIds: ['active'],
    });
    const wrapper = mount(ProviderAllowanceIndicators);
    await Promise.resolve();
    await nextTick();

    websocketListeners.get('provider:allowance_updated')({
      type: 'provider:allowance_updated',
      snapshot: snapshot({ providerId: 'attention', status: 'critical' }),
    });
    await nextTick();

    expect(useProviderAllowancesStore().snapshots.map(({ providerId }) => providerId)).toEqual(['active', 'attention']);
    wrapper.unmount();
  });

  it('reflects the worst provider status in the single trigger without refetching', async () => {
    api.getProviderAllowances.mockResolvedValueOnce({
      snapshots: [
        snapshot({ providerId: 'active', status: 'available' }),
        snapshot({ providerId: 'healthy', status: 'available' }),
        snapshot({ providerId: 'constrained', status: 'available' }),
      ],
      activeProviderIds: ['active'],
    });
    const wrapper = mount(ProviderAllowanceIndicators);
    await Promise.resolve();
    await nextTick();

    const trigger = () => wrapper.find('[data-testid="provider-allowance-trigger"]');
    expect(trigger().attributes('aria-label')).toContain('Available');
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(1);

    websocketListeners.get('provider:allowance_updated')({
      type: 'provider:allowance_updated',
      snapshot: snapshot({ providerId: 'constrained', status: 'critical' }),
    });
    await nextTick();

    expect(trigger().classes()).toContain('is-critical');
    expect(trigger().attributes('aria-label')).toContain('Critical');
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('reconciles the authoritative recency order after a session lifecycle update', async () => {
    api.getProviderAllowances
      .mockResolvedValueOnce({ snapshots: [], activeProviderIds: [] })
      .mockResolvedValueOnce({
        snapshots: [
          snapshot({ providerId: 'active', status: 'available', lastUsedAt: 2000 }),
          snapshot({ providerId: 'attention', status: 'warning', lastUsedAt: 1000 }),
        ],
        activeProviderIds: ['active'],
      });
    const wrapper = mount(ProviderAllowanceIndicators);

    websocketListeners.get('session:updated')({ session: { id: 'session-1', providerId: 'active', status: 'running' } });
    await Promise.resolve();
    await nextTick();

    expect(api.getProviderAllowances).toHaveBeenCalledTimes(2);
    expect(useProviderAllowancesStore().snapshots.map(({ providerId }) => providerId)).toEqual(['active', 'attention']);
    wrapper.unmount();
  });

  it('reconciles authoritative recency on session creation and deletion without waiting for an update', async () => {
    api.getProviderAllowances
      .mockResolvedValueOnce({ snapshots: [snapshot({ providerId: 'idle', status: 'available', lastUsedAt: 1000 })], activeProviderIds: [] })
      .mockResolvedValueOnce({
        snapshots: [snapshot({ providerId: 'active', status: 'available', lastUsedAt: 2000 }), snapshot({ providerId: 'idle', status: 'available', lastUsedAt: 1000 })],
        activeProviderIds: ['active'],
      })
      .mockResolvedValueOnce({ snapshots: [snapshot({ providerId: 'idle', status: 'available', lastUsedAt: 1000 })], activeProviderIds: [] });
    const wrapper = mount(ProviderAllowanceIndicators);
    await Promise.resolve();
    await nextTick();

    websocketListeners.get('session:created')({ session: { id: 'session-1', providerId: 'active', status: 'starting' } });
    await Promise.resolve();
    await nextTick();
    expect(useProviderAllowancesStore().snapshots.map(({ providerId }) => providerId)).toEqual(['active', 'idle']);

    websocketListeners.get('session:deleted')({ sessionId: 'session-1' });
    await vi.waitFor(() => {
      expect(useProviderAllowancesStore().activeProviderIds).toEqual([]);
      expect(api.getProviderAllowances).toHaveBeenCalledTimes(3);
    });
    wrapper.unmount();
    expect(websocketListeners.has('session:created')).toBe(false);
    expect(websocketListeners.has('session:deleted')).toBe(false);
  });

  it('skips known non-active session creation but refetches unfamiliar lifecycle payloads', async () => {
    api.getProviderAllowances.mockResolvedValue({ snapshots: [], activeProviderIds: [] });
    const wrapper = mount(ProviderAllowanceIndicators);
    await Promise.resolve();
    await nextTick();

    websocketListeners.get('session:created')({ session: { id: 'waiting-1', providerId: 'openai', status: 'waiting' } });
    await Promise.resolve();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(1);
    websocketListeners.get('session:created')({});
    websocketListeners.get('session:deleted')({});
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('refetches on session updates only when the priority-relevant fields change', async () => {
    api.getProviderAllowances.mockResolvedValue({ snapshots: [], activeProviderIds: [] });
    const wrapper = mount(ProviderAllowanceIndicators);
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(1);

    websocketListeners.get('session:updated')({ session: { id: 'session-1', providerId: 'openai', status: 'waiting' } });
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(2);

    // Field changes that cannot reorder priority (title, summary, …) must not
    // generate a refetch per broadcast.
    websocketListeners.get('session:updated')({ session: { id: 'session-1', providerId: 'openai', status: 'waiting', title: 'renamed' } });
    websocketListeners.get('session:updated')({ session: { id: 'session-1', providerId: 'openai', status: 'waiting' } });
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(2);

    websocketListeners.get('session:updated')({ session: { id: 'session-1', providerId: 'openai', status: 'running' } });
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(3);

    websocketListeners.get('session:updated')({ session: { id: 'session-1', providerId: 'openai', status: 'running' } });
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(3);

    // Unknown payload shapes fall back to fetching — never silently skip.
    websocketListeners.get('session:updated')({});
    await vi.waitFor(() => expect(api.getProviderAllowances).toHaveBeenCalledTimes(4));
    wrapper.unmount();
  });

  it('never memoizes id-less session updates, so each one safely refetches', async () => {
    api.getProviderAllowances.mockResolvedValue({ snapshots: [], activeProviderIds: [] });
    const wrapper = mount(ProviderAllowanceIndicators);
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(1);

    // An id-less payload cannot establish priority identity: it refetches
    // fail-safe and memoizes nothing, so a repeat still refetches instead of
    // being suppressed by an `undefined`-keyed memo entry.
    websocketListeners.get('session:updated')({ session: { providerId: 'openai', status: 'running' } });
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(2);

    websocketListeners.get('session:updated')({ session: { providerId: 'openai', status: 'running' } });
    // The second payload arrives while the first reconciliation is still in
    // flight, so it is served by the single trailing refresh.
    await vi.waitFor(() => expect(api.getProviderAllowances).toHaveBeenCalledTimes(3));
    wrapper.unmount();
  });

  it('trailing-debounces allowance invalidations and removes both listeners on unmount', async () => {
    vi.useFakeTimers();
    api.getProviderAllowances.mockResolvedValue({ snapshots: [], activeProviderIds: [] });
    const wrapper = mount(ProviderAllowanceIndicators);
    await vi.runAllTicks();
    await vi.runAllTimersAsync();
    api.getProviderAllowances.mockClear();

    websocketListeners.get('provider:allowance_priority_invalidated')({});
    websocketListeners.get('provider:allowance_list_invalidated')({});
    await vi.advanceTimersByTimeAsync(74);
    expect(api.getProviderAllowances).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getProviderAllowances).toHaveBeenCalledOnce();

    wrapper.unmount();
    expect(websocketListeners.has('provider:allowance_priority_invalidated')).toBe(false);
    expect(websocketListeners.has('provider:allowance_list_invalidated')).toBe(false);
  });

  it('caps lifecycle reconciliation work as well as the session priority memo', async () => {
    api.getProviderAllowances.mockResolvedValue({ snapshots: [], activeProviderIds: [] });
    const wrapper = mount(ProviderAllowanceIndicators);
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(1);

    const handler = websocketListeners.get('session:updated');
    const total = 501; // one beyond the memo cap
    for (let i = 0; i < total; i += 1) {
      handler({ session: { id: `session-${i}`, providerId: 'openai', status: 'running' } });
    }
    await Promise.resolve();
    await nextTick();
    // A burst is coalesced into one reconciliation instead of creating an
    // unbounded number of REST calls.
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(2);

    // The most recent session stays memoized: an unchanged update is free.
    handler({ session: { id: `session-${total - 1}`, providerId: 'openai', status: 'running' } });
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(2);

    // The oldest entry was FIFO-evicted: its next unchanged update looks
    // unknown again and safely refetches instead of retaining every session
    // id for the page lifetime.
    handler({ session: { id: 'session-0', providerId: 'openai', status: 'running' } });
    await Promise.resolve();
    await nextTick();
    expect(api.getProviderAllowances).toHaveBeenCalledTimes(3);
    wrapper.unmount();
  });

  it('formats percentage-only allowance data without pretending null values are quantities', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [{
      providerId: 'openai', providerName: 'OpenAI', providerKind: 'openai', status: 'available', source: 'provider', updatedAt: null, staleAt: null, unavailableReason: null,
      allowances: [{ key: 'requests', label: 'Requests', remaining: null, limit: null, remainingPercent: 25, unit: 'requests', resetsAt: null }],
    }];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    await nextTick();
    await wrapper.find('[data-testid="provider-allowance-trigger"]').trigger('click');
    await nextTick();

    expect(wrapper.text()).toContain('25% remaining');
    expect(wrapper.text()).not.toContain('null / null');
  });

  it('displays z.ai absolute usage as used of limit in detail text', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot({
      allowances: [{ key: 'five_hour', label: '5-hour token window', remaining: null, value: 54_000_000, valueKind: 'used', limit: 120_000_000, remainingPercent: 55, unit: 'tokens', resetsAt: null }],
    })];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    await nextTick();
    await wrapper.find('[data-testid="provider-allowance-trigger"]').trigger('click');
    await nextTick();

    expect(wrapper.find('.provider-detail').text()).toContain('54M tokens used of 120M');
  });

  it('renders one battery trigger whose fill tracks the worst remaining percent', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [
      snapshot({
        providerId: 'high', status: 'available',
        allowances: [{ key: 'window', label: 'Window', remaining: 80, limit: 100, remainingPercent: 80, unit: 'tokens', resetsAt: null }],
      }),
      snapshot({
        providerId: 'low', status: 'warning',
        allowances: [{ key: 'window', label: 'Window', remaining: 25, limit: 100, remainingPercent: 25, unit: 'tokens', resetsAt: null }],
      }),
    ];
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();

    const triggers = wrapper.findAll('[data-testid="provider-allowance-trigger"]');
    expect(triggers).toHaveLength(1);
    expect(triggers[0].classes()).toContain('is-warning');
    expect(triggers[0].attributes('aria-label')).toBe('Provider usage: Warning, 25% remaining');
    expect(triggers[0].attributes('title')).toBe('Provider usage: Warning, 25% remaining');
    expect(triggers[0].find('.battery-icon').exists()).toBe(true);
    expect(triggers[0].find('.battery-fill').attributes('width')).toBe('4.25');
    wrapper.unmount();
  });

  it('renders an empty battery outline with an unknown label when no percentage exists', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot({
      status: 'unknown',
      allowances: [{ key: 'window', label: 'Window', remaining: null, limit: null, remainingPercent: null, unit: 'tokens', resetsAt: null }],
    })];
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();

    const trigger = wrapper.get('[data-testid="provider-allowance-trigger"]');
    expect(trigger.classes()).toContain('is-unknown');
    expect(trigger.attributes('aria-label')).toBe('Provider usage: Unknown, usage unknown');
    expect(trigger.find('.battery-fill').exists()).toBe(false);
    expect(trigger.find('.battery-outline').exists()).toBe(true);
    wrapper.unmount();
  });

  it('prefers the most severe quantified provider and reports its own percent and reset', async () => {
    const exhaustedResetsAt = Date.parse('2026-01-03T10:00:00Z');
    const healthyResetsAt = Date.parse('2026-01-02T11:00:00Z');
    const store = useProviderAllowancesStore();
    store.snapshots = [
      snapshot({
        providerId: 'drained', providerName: 'Drained', status: 'exhausted',
        allowances: [{ key: 'window', label: 'Window', remaining: 0, limit: 100, remainingPercent: 0, unit: 'tokens', resetsAt: exhaustedResetsAt }],
      }),
      snapshot({
        providerId: 'healthy', providerName: 'Healthy', status: 'available',
        allowances: [{ key: 'window', label: 'Window', remaining: 80, limit: 100, remainingPercent: 80, unit: 'tokens', resetsAt: healthyResetsAt }],
      }),
    ];
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();

    const trigger = wrapper.get('[data-testid="provider-allowance-trigger"]');
    expect(trigger.classes()).toContain('is-exhausted');
    expect(trigger.attributes('aria-label')).toContain('Exhausted, 0% remaining');
    expect(trigger.attributes('aria-label')).toContain(new Date(exhaustedResetsAt).toLocaleString());
    expect(trigger.attributes('aria-label')).not.toContain('80%');
    expect(trigger.attributes('aria-label')).not.toContain(new Date(healthyResetsAt).toLocaleString());
    wrapper.unmount();
  });

  it('breaks equal-severity ties by the lowest known percent with that provider’s reset', async () => {
    const lowerResetsAt = Date.parse('2026-01-02T12:00:00Z');
    const higherResetsAt = Date.parse('2026-01-02T14:00:00Z');
    const store = useProviderAllowancesStore();
    store.snapshots = [
      snapshot({
        providerId: 'higher', providerName: 'Higher', status: 'warning',
        allowances: [{ key: 'window', label: 'Window', remaining: 25, limit: 100, remainingPercent: 25, unit: 'tokens', resetsAt: higherResetsAt }],
      }),
      snapshot({
        providerId: 'lower', providerName: 'Lower', status: 'warning',
        allowances: [{ key: 'window', label: 'Window', remaining: 15, limit: 100, remainingPercent: 15, unit: 'tokens', resetsAt: lowerResetsAt }],
      }),
    ];
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();

    const trigger = wrapper.get('[data-testid="provider-allowance-trigger"]');
    expect(trigger.classes()).toContain('is-warning');
    expect(trigger.attributes('aria-label')).toContain('Warning, 15% remaining');
    expect(trigger.attributes('aria-label')).toContain(new Date(lowerResetsAt).toLocaleString());
    expect(trigger.attributes('aria-label')).not.toContain(new Date(higherResetsAt).toLocaleString());
    wrapper.unmount();
  });

  // A status-only rate-limit observation (exhausted, unknown utilization, a
  // known reset) must never borrow another provider's percentage or reset.
  function seedStatusOnlyExhaustedAlongsideHealthy({ exhaustedFirst = true, exhaustedResetsAt = Date.parse('2026-01-03T10:00:00Z') } = {}) {
    const healthyResetsAt = Date.parse('2026-01-02T11:00:00Z');
    const exhausted = snapshot({
      providerId: 'claude', providerName: 'Claude', providerKind: 'anthropic', status: 'exhausted',
      allowances: [{ key: 'five_hour', label: '5-hour window', remaining: null, limit: null, remainingPercent: null, unit: 'other', resetsAt: exhaustedResetsAt }],
    });
    const healthy = snapshot({
      providerId: 'openai', status: 'available',
      allowances: [{ key: 'window', label: 'Window', remaining: 80, limit: 100, remainingPercent: 80, unit: 'tokens', resetsAt: healthyResetsAt }],
    });
    useProviderAllowancesStore().snapshots = exhaustedFirst ? [exhausted, healthy] : [healthy, exhausted];
    return { exhaustedResetsAt, healthyResetsAt };
  }

  function expectStatusOnlyExhaustedTrigger(trigger, { exhaustedResetsAt, healthyResetsAt }) {
    expect(trigger.classes()).toContain('is-exhausted');
    expect(trigger.attributes('aria-label')).toContain('Exhausted, usage unknown');
    expect(trigger.attributes('aria-label')).toContain(new Date(exhaustedResetsAt).toLocaleString());
    expect(trigger.attributes('title')).toBe(trigger.attributes('aria-label'));
    expect(trigger.attributes('aria-label')).not.toContain('80%');
    expect(trigger.attributes('aria-label')).not.toContain(new Date(healthyResetsAt).toLocaleString());
    expect(trigger.find('.battery-fill').exists()).toBe(false);
    expect(trigger.find('.battery-outline').exists()).toBe(true);
  }

  it('keeps a status-only exhausted provider separate from a healthy provider’s usage and reset', async () => {
    const resets = seedStatusOnlyExhaustedAlongsideHealthy({ exhaustedFirst: true });
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();

    expectStatusOnlyExhaustedTrigger(wrapper.get('[data-testid="provider-allowance-trigger"]'), resets);
    wrapper.unmount();
  });

  it('keeps a status-only exhausted provider separate regardless of snapshot order', async () => {
    const resets = seedStatusOnlyExhaustedAlongsideHealthy({ exhaustedFirst: false });
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();

    expectStatusOnlyExhaustedTrigger(wrapper.get('[data-testid="provider-allowance-trigger"]'), resets);
    wrapper.unmount();
  });

  // A quantified exhausted window with no known reset must not borrow another
  // window's reset on the same provider.
  function seedQuantifiedExhaustedWithoutReset({ exhaustedFirst = true } = {}) {
    const healthyResetsAt = Date.parse('2026-01-02T11:00:00Z');
    const exhaustedWindow = { key: 'weekly', label: 'Weekly window', remaining: 0, limit: 100, remainingPercent: 0, unit: 'tokens', resetsAt: null };
    const healthyWindow = { key: 'five_hour', label: '5-hour window', remaining: 80, limit: 100, remainingPercent: 80, unit: 'tokens', resetsAt: healthyResetsAt };
    useProviderAllowancesStore().snapshots = [snapshot({
      providerId: 'codex', providerName: 'Codex', providerKind: 'openai', status: 'exhausted',
      allowances: exhaustedFirst ? [exhaustedWindow, healthyWindow] : [healthyWindow, exhaustedWindow],
    })];
    return { healthyResetsAt };
  }

  function expectQuantifiedExhaustedWithoutReset(trigger, { healthyResetsAt }) {
    expect(trigger.classes()).toContain('is-exhausted');
    expect(trigger.attributes('aria-label')).toBe('Provider usage: Exhausted, 0% remaining');
    expect(trigger.attributes('title')).toBe('Provider usage: Exhausted, 0% remaining');
    expect(trigger.attributes('aria-label')).not.toContain(new Date(healthyResetsAt).toLocaleString());
    expect(trigger.find('.battery-fill').attributes('width')).toBe('0');
  }

  it('omits the reset when the quantified exhausted window has none, even with a healthy window reset', async () => {
    const resets = seedQuantifiedExhaustedWithoutReset({ exhaustedFirst: true });
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();

    expectQuantifiedExhaustedWithoutReset(wrapper.get('[data-testid="provider-allowance-trigger"]'), resets);
    wrapper.unmount();
  });

  it('omits the reset for the quantified exhausted window regardless of allowance order', async () => {
    const resets = seedQuantifiedExhaustedWithoutReset({ exhaustedFirst: false });
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();

    expectQuantifiedExhaustedWithoutReset(wrapper.get('[data-testid="provider-allowance-trigger"]'), resets);
    wrapper.unmount();
  });

  it('omits the reset when the status-only exhausted provider has none', async () => {
    const { healthyResetsAt } = seedStatusOnlyExhaustedAlongsideHealthy({ exhaustedResetsAt: null });
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();

    const trigger = wrapper.get('[data-testid="provider-allowance-trigger"]');
    expect(trigger.classes()).toContain('is-exhausted');
    expect(trigger.attributes('aria-label')).toBe('Provider usage: Exhausted, usage unknown');
    expect(trigger.attributes('aria-label')).not.toContain('80%');
    expect(trigger.attributes('aria-label')).not.toContain(new Date(healthyResetsAt).toLocaleString());
    expect(trigger.find('.battery-fill').exists()).toBe(false);
    wrapper.unmount();
  });

  it('contains keyboard focus, closes on Escape, and restores the exact invoking trigger', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot()];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    await nextTick();
    const trigger = wrapper.find('[data-testid="provider-allowance-trigger"]');
    trigger.element.focus();
    await trigger.trigger('click');
    await nextTick();

    const dialog = wrapper.find('[role="dialog"]').element;
    const closeButton = wrapper.find('.close-button').element;
    expect(document.activeElement).toBe(dialog);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(closeButton);

    closeButton.focus();
    closeButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(dialog);

    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(dialog);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);

    const closedEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(closedEscape);
    expect(closedEscape.defaultPrevented).toBe(false);
  });

  it('opens from the single trigger and keeps the dialog focused when it has no focusable children', async () => {
    seedSnapshots(4);
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();

    const trigger = wrapper.find('[data-testid="provider-allowance-trigger"]');
    trigger.element.focus();
    await trigger.trigger('click');
    await nextTick();

    const dialog = wrapper.find('[role="dialog"]').element;
    const closeButton = wrapper.find('.close-button').element;
    closeButton.disabled = true;
    dialog.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dialog);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(trigger.element);
  });

  it('includes reset time in compact item labels and politely announces only critical/exhausted transitions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot({ resetsAt: Date.parse('2026-01-03T03:04:05Z') })];
    const wrapper = mount(ProviderAllowanceIndicators);
    await nextTick();
    await nextTick();

    expect(wrapper.find('[data-testid="provider-allowance-trigger"]').attributes('aria-label')).toContain('resets');
    expect(wrapper.find('[aria-live="polite"]').text()).toBe('');

    store.replace(snapshot({ status: 'warning' }));
    await nextTick();
    expect(wrapper.find('[aria-live="polite"]').text()).toBe('');

    store.replace(snapshot({ status: 'critical' }));
    store.replace(snapshot({ status: 'exhausted' }));
    await nextTick();
    await vi.runAllTimersAsync();
    expect(wrapper.find('[aria-live="polite"]').text()).toBe('OpenAI usage is exhausted.');
  });

  it('renders a stale-critical snapshot with the stale marker plus the critical treatment', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T10:00:00Z'));
    const store = useProviderAllowancesStore();
    store.snapshots = [{
      ...snapshot({ status: 'critical', source: 'observed-header', updatedAt: Date.parse('2026-01-02T09:30:00Z') }),
      stale: true,
    }];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    await nextTick();

    const item = wrapper.get('[data-testid="provider-allowance-trigger"]');
    expect(item.classes()).toContain('is-critical');
    expect(item.classes()).toContain('is-stale');
    expect(item.attributes('aria-label')).toContain('Critical');

    await wrapper.find('[data-testid="provider-allowance-trigger"]').trigger('click');
    await nextTick();

    const detail = wrapper.find('.provider-detail');
    expect(detail.text()).toContain('Critical');
    expect(detail.text()).toContain('Last value may be out of date.');
    expect(detail.text()).toContain('Last updated 30 minutes ago');
    wrapper.unmount();
  });

  it('does not announce again when a critical snapshot goes stale on the timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T10:00:00Z'));
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot({ status: 'available', source: 'provider', updatedAt: Date.parse('2026-01-02T10:00:00Z') })];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    await nextTick();

    // A fresh critical observation announces once (the seeded snapshot is the
    // component's first sighting, which never announces by design).
    store.replace(snapshot({ status: 'available', source: 'provider', updatedAt: Date.parse('2026-01-02T10:00:00Z') }));
    await nextTick();
    store.replace({
      ...snapshot({ status: 'critical', source: 'provider', updatedAt: Date.parse('2026-01-02T10:00:00Z') }),
      staleAt: Date.parse('2026-01-02T10:05:00Z'),
    });
    await nextTick();
    await vi.runAllTimersAsync();
    expect(wrapper.find('[aria-live="polite"]').text()).toBe('OpenAI usage is critical.');

    // The staleness tick preserves the status, so no second announcement fires.
    vi.setSystemTime(new Date('2026-01-02T10:06:00Z'));
    await vi.runAllTimersAsync();
    expect(wrapper.find('[aria-live="polite"]').text()).toBe('OpenAI usage is critical.');
    expect(store.snapshots[0]).toMatchObject({ status: 'critical', stale: true });
    expect(store.attentionCount).toBe(1);
    wrapper.unmount();
  });

  it('shows provenance, relative and exact reset times, and stale last-known metadata in details', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T10:00:00Z'));
    const store = useProviderAllowancesStore();
    store.snapshots = [{
      ...snapshot({
        status: 'warning',
        source: 'observed-header',
        updatedAt: Date.parse('2026-01-02T09:30:00Z'),
        resetsAt: Date.parse('2026-01-02T12:00:00Z'),
      }),
      stale: true,
    }];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    await nextTick();
    await wrapper.find('[data-testid="provider-allowance-trigger"]').trigger('click');
    await nextTick();

    const detail = wrapper.find('.provider-detail');
    expect(detail.text()).toContain('Warning');
    expect(detail.text()).toContain('Source: Observed from provider response headers');
    expect(detail.text()).toContain('resets in 2 hours');
    expect(detail.find('time[datetime="2026-01-02T12:00:00.000Z"]').exists()).toBe(true);
    expect(detail.text()).toContain('Last updated 30 minutes ago');
    expect(detail.find('time[datetime="2026-01-02T09:30:00.000Z"]').exists()).toBe(true);
    expect(detail.text()).toContain('Last value may be out of date.');
  });

  it('renders one remaining-usage bar per allowance with progress semantics', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot({
      status: 'warning',
      allowances: [
        { key: 'five_hour', label: '5-hour window', remaining: 25, limit: 100, remainingPercent: 25, unit: 'tokens', resetsAt: null },
        { key: 'weekly', label: 'Weekly window', remaining: 150, limit: 100, remainingPercent: 150, unit: 'tokens', resetsAt: null },
      ],
    })];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    await nextTick();
    await wrapper.find('[data-testid="provider-allowance-trigger"]').trigger('click');
    await nextTick();

    const bars = wrapper.findAll('.provider-detail [role="progressbar"]');
    expect(bars).toHaveLength(2);
    expect(bars[0].attributes('aria-valuemin')).toBe('0');
    expect(bars[0].attributes('aria-valuemax')).toBe('100');
    expect(bars[0].attributes('aria-valuenow')).toBe('25');
    expect(bars[0].attributes('aria-label')).toContain('25 percent remaining');
    expect(bars[0].find('.allowance-bar-fill').attributes('style')).toContain('width: 25%');
    expect(bars[0].find('.allowance-bar-fill').classes()).toContain('fill-warning');
    expect(bars[1].attributes('aria-valuenow')).toBe('100');
    expect(bars[1].find('.allowance-bar-fill').attributes('style')).toContain('width: 100%');
    wrapper.unmount();
  });

  it('renders no usage bar when the remaining percentage is unknown', async () => {
    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot({
      status: 'unknown',
      allowances: [{ key: 'window', label: '5-hour window', remaining: null, limit: null, remainingPercent: null, unit: 'tokens', resetsAt: null }],
    })];
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await nextTick();
    await nextTick();
    await wrapper.find('[data-testid="provider-allowance-trigger"]').trigger('click');
    await nextTick();

    expect(wrapper.find('.provider-detail').text()).toContain('Unknown');
    expect(wrapper.find('.provider-detail [role="progressbar"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('uses the unavailable fallback and exposes fetch errors without any snapshots', async () => {
    api.getProviderAllowances.mockRejectedValueOnce(new Error('network down'));
    const wrapper = mount(ProviderAllowanceIndicators, { attachTo: document.body });
    await Promise.resolve();
    await nextTick();

    expect(wrapper.find('[data-testid="provider-allowance-fetch-error"]').text()).toContain('Unable to load provider usage');

    const store = useProviderAllowancesStore();
    store.snapshots = [snapshot({ allowances: [], unavailableReason: null })];
    await nextTick();
    await nextTick();
    await wrapper.find('[data-testid="provider-allowance-trigger"]').trigger('click');
    await nextTick();
    expect(wrapper.find('.unavailable').text()).toBe('Usage data is unavailable.');
  });
});
