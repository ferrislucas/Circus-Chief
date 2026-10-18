import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, ref } from 'vue';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import ConversationMessages from './ConversationMessages.vue';

// The conversation timeline (message list + interleaved tier-failover
// markers) is owned by ConversationMessages, rendered inside ConversationTab
// (whose full tree cannot mount in this environment — see the skipped
// ConversationTab suite). These tests pin the FRD G4 contract at the owner.

const wsHandlers = {};
vi.mock('../composables/useWebSocket.js', () => ({
  useWebSocket: vi.fn(() => ({
    on: vi.fn((type, handler) => { wsHandlers[type] = handler; }),
    off: vi.fn((type) => { delete wsHandlers[type]; }),
  })),
}));

const getSessionAgentCalls = vi.fn();
vi.mock('../composables/useApi.js', () => ({
  api: { getSessionAgentCalls: (...args) => getSessionAgentCalls(...args) },
}));

vi.mock('../composables/useMessageScroll.js', () => ({
  useMessageScroll: vi.fn(() => ({
    messagesContainer: ref(null),
    isNearBottom: ref(true),
    scrollToBottom: vi.fn(),
    scrollToSendButton: vi.fn(),
    scrollToClaudesTurn: vi.fn(),
  })),
}));

const fakeStore = reactive({
  messages: [],
  partialText: '',
  activeConversationId: 'conv-1',
  getWorkLogsForMessage: vi.fn(() => []),
});
vi.mock('../composables/useOverlayStore.js', () => ({
  useInjectedSessionsStore: vi.fn(() => fakeStore),
}));

function failoverEntry(overrides = {}) {
  return {
    id: 'failover-1',
    callType: 'tierFailover',
    startedAt: 250,
    createdAt: 250,
    errorMessage: 'quota wall',
    metadata: {
      fromModel: 'retry-a',
      fromProviderId: 'provider-a',
      toModel: 'retry-a2',
      toProviderId: 'provider-a',
      tierRef: 'tier::tier-1',
      tierName: 'Retry Tier',
      reason: 'quota wall',
    },
    ...overrides,
  };
}

function mountTimeline() {
  // MessageItem renders for real (it carries the data-message-id used for
  // order assertions); only the peripheral panels are stubbed.
  return mount(ConversationMessages, {
    props: { sessionId: 'sess-1', isDraft: false, isScheduledDraft: false },
    global: {
      stubs: {
        StreamingMessage: { template: '<div class="streaming-stub"></div>' },
        TokenCostPanel: { template: '<div class="token-cost-stub"></div>' },
      },
    },
  });
}

describe('conversation inline tier-failover marker (G4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(wsHandlers)) delete wsHandlers[key];
    fakeStore.messages = [];
    fakeStore.partialText = '';
    getSessionAgentCalls.mockResolvedValue([]);
  });

  it('renders a marker between the failed turn and the next member message', async () => {
    fakeStore.messages = [
      { id: 'msg-1', role: 'user', content: 'Follow-up', timestamp: 100 },
      { id: 'msg-2', role: 'assistant', content: 'partial work', timestamp: 200 },
      { id: 'msg-3', role: 'assistant', content: 'continued on B', timestamp: 300 },
    ];
    getSessionAgentCalls.mockResolvedValue([failoverEntry()]);

    const wrapper = mountTimeline();
    await flushPromises();

    const marker = wrapper.get('[data-testid="tier-failover-marker"]');
    expect(marker.text()).toContain('Switched from retry-a to retry-a2');
    expect(marker.text()).toContain('quota wall');

    const order = wrapper.find('.messages').findAll('[data-message-id], [data-testid="tier-failover-marker"]')
      .map((el) => el.attributes('data-message-id') || 'marker');
    expect(order).toEqual(['msg-1', 'msg-2', 'marker', 'msg-3']);
  });

  it('inserts the marker on a live TIER_FAILOVER event without reload', async () => {
    fakeStore.messages = [{ id: 'msg-1', role: 'user', content: 'Follow-up', timestamp: 100 }];
    getSessionAgentCalls.mockResolvedValue([]);
    const wrapper = mountTimeline();
    await flushPromises();
    expect(wrapper.find('[data-testid="tier-failover-marker"]').exists()).toBe(false);
    expect(getSessionAgentCalls).toHaveBeenCalledTimes(1);

    getSessionAgentCalls.mockResolvedValue([failoverEntry()]);
    wsHandlers[WS_MESSAGE_TYPES.TIER_FAILOVER]({ sessionId: 'sess-1' });
    await flushPromises();

    expect(getSessionAgentCalls).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="tier-failover-marker"]').exists()).toBe(true);
  });

  it('ignores TIER_FAILOVER events for other sessions', async () => {
    getSessionAgentCalls.mockResolvedValue([]);
    mountTimeline();
    await flushPromises();

    getSessionAgentCalls.mockResolvedValue([failoverEntry()]);
    wsHandlers[WS_MESSAGE_TYPES.TIER_FAILOVER]({ sessionId: 'other-session' });
    await flushPromises();

    expect(getSessionAgentCalls).toHaveBeenCalledTimes(1);
  });

  it('renders no session-header badge for failovers', async () => {
    fakeStore.messages = [{ id: 'msg-1', role: 'user', content: 'Follow-up', timestamp: 100 }];
    getSessionAgentCalls.mockResolvedValue([failoverEntry()]);
    const wrapper = mountTimeline();
    await flushPromises();

    expect(wrapper.find('[data-testid="tier-failover-marker"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="tier-failover-badge"]').exists()).toBe(false);
  });
});
