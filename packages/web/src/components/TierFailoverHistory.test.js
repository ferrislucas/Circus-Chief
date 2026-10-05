import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import TierFailoverHistory from './TierFailoverHistory.vue';
import { useProvidersStore } from '../stores/providers.js';

const getSessionAgentCalls = vi.hoisted(() => vi.fn());
const websocketHandlers = vi.hoisted(() => new Map());

vi.mock('../composables/useApi.js', () => ({
  api: { getSessionAgentCalls },
}));

vi.mock('../composables/useWebSocket.js', () => ({
  useWebSocket: () => ({
    on: vi.fn((type, handler) => websocketHandlers.set(type, handler)),
    off: vi.fn((type) => websocketHandlers.delete(type)),
  }),
}));

describe('TierFailoverHistory', () => {
  beforeEach(() => {
    getSessionAgentCalls.mockReset();
    websocketHandlers.clear();
  });

  it('shows persisted failovers and their failure reasons', async () => {
    getSessionAgentCalls.mockResolvedValue([
      {
        id: 'failover-1',
        callType: 'tierFailover',
        metadata: {
          fromProviderId: 'anthropic',
          fromModel: 'claude-opus',
          toProviderId: 'openai',
          toModel: 'gpt-5',
          tierName: 'Reliable tier',
          reason: 'Rate limit reached',
        },
      },
      { id: 'run-1', callType: 'runSession' },
    ]);

    const wrapper = mount(TierFailoverHistory, { props: { sessionId: 'background-session' } });
    await flushPromises();

    expect(getSessionAgentCalls).toHaveBeenCalledWith('background-session', {
      callType: 'tierFailover', limit: 100,
    });
    expect(wrapper.get('[data-testid="tier-failover-history"]').text()).toContain('anthropic/claude-opus');
    expect(wrapper.text()).toContain('openai/gpt-5');
    expect(wrapper.text()).toContain('Tier: Reliable tier');
    expect(wrapper.text()).toContain('Rate limit reached');
    expect(wrapper.text()).not.toContain('run-1');
  });

  it('reloads persisted history when navigating to another session', async () => {
    getSessionAgentCalls
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'failover-2', callType: 'tierFailover', metadata: {} }]);

    const wrapper = mount(TierFailoverHistory, { props: { sessionId: 'template-session' } });
    await flushPromises();
    await wrapper.setProps({ sessionId: 'kanban-session' });
    await flushPromises();

    expect(getSessionAgentCalls).toHaveBeenLastCalledWith('kanban-session', {
      callType: 'tierFailover', limit: 100,
    });
    expect(wrapper.find('[data-testid="tier-failover-history"]').exists()).toBe(true);
  });

  it('does not replace newer session history with a late response', async () => {
    let resolveFirst;
    const firstRequest = new Promise(resolve => { resolveFirst = resolve; });
    getSessionAgentCalls
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce([{ id: 'failover-new', callType: 'tierFailover', metadata: { reason: 'New reason' } }]);

    const wrapper = mount(TierFailoverHistory, { props: { sessionId: 'first-session' } });
    await wrapper.setProps({ sessionId: 'second-session' });
    await flushPromises();
    resolveFirst([{ id: 'failover-old', callType: 'tierFailover', metadata: { reason: 'Old reason' } }]);
    await flushPromises();

    expect(wrapper.text()).toContain('New reason');
    expect(wrapper.text()).not.toContain('Old reason');
  });

  it('resolves provider ids to display names when the providers store is loaded', async () => {
    setActivePinia(createPinia());
    useProvidersStore().providers = [{ id: 'uuid-openai-1', name: 'OpenAI' }];
    getSessionAgentCalls.mockResolvedValue([
      {
        id: 'failover-uuid',
        callType: 'tierFailover',
        metadata: {
          fromProviderId: 'uuid-openai-1',
          fromModel: 'gpt-5',
          toProviderId: 'uuid-openai-1',
          toModel: 'gpt-5.5',
          tierName: 'Reliable tier',
          reason: 'Rate limit reached',
        },
      },
    ]);

    const wrapper = mount(TierFailoverHistory, { props: { sessionId: 'uuid-session' } });
    await flushPromises();

    expect(wrapper.text()).toContain('OpenAI/gpt-5.5');
    expect(wrapper.text()).not.toContain('uuid-openai-1');
  });

  it('renders stale tier refs as tier names instead of raw sentinels', async () => {
    getSessionAgentCalls.mockResolvedValue([
      {
        id: 'failover-stale',
        callType: 'tierFailover',
        metadata: {
          fromProviderId: null,
          fromModel: 'tier::abc123',
          toProviderId: 'openai',
          toModel: 'gpt-5',
          tierName: 'High',
          reason: 'Stale tier binding',
        },
      },
    ]);

    const wrapper = mount(TierFailoverHistory, { props: { sessionId: 'stale-session' } });
    await flushPromises();

    expect(wrapper.text()).toContain('Tier: High');
    expect(wrapper.text()).not.toContain('tier::abc123');
  });

  it('reloads persisted history when a live tier failover arrives for the session', async () => {
    getSessionAgentCalls
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'failover-live', callType: 'tierFailover', metadata: { reason: 'Live reason' } }]);

    const wrapper = mount(TierFailoverHistory, { props: { sessionId: 'live-session' } });
    await flushPromises();

    websocketHandlers.get('tier:failover')({ sessionId: 'live-session' });
    await flushPromises();

    expect(getSessionAgentCalls).toHaveBeenLastCalledWith('live-session', {
      callType: 'tierFailover', limit: 100,
    });
    expect(wrapper.text()).toContain('Live reason');
  });
});
