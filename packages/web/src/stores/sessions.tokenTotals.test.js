import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionsStore } from './sessions.js';

vi.mock('../composables/useApi.js', () => ({
  api: {
    getActiveSessions: vi.fn(),
    getProjectSessions: vi.fn(),
    getScheduledSessions: vi.fn(),
    getSession: vi.fn(),
    getSessionMessages: vi.fn(),
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    stopSession: vi.fn(),
    restartSession: vi.fn(),
    deleteSession: vi.fn(),
    getSessionWorkLogs: vi.fn(),
    updateSession: vi.fn(),
    archiveSession: vi.fn(),
    unarchiveSession: vi.fn(),
    toggleSessionStar: vi.fn(),
    duplicateSession: vi.fn(),
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    getConversationMessages: vi.fn(),
    branchConversation: vi.fn(),
  },
}));

describe('Sessions Store - raw token total getters', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('calculates tokenTotal for the active conversation', () => {
    const store = useSessionsStore();
    store.conversations = [{
      id: 'conv-1',
      inputTokens: 1000,
      outputTokens: 500,
      thinkingTokens: 75,
      cacheReadInputTokens: 2000,
      cacheCreationInputTokens: 100,
    }];
    store.activeConversationId = 'conv-1';

    expect(store.tokenTotal).toBe(3675);
    expect(store.formattedTokenTotal).toBe('3.7K');
  });

  it('includes running usage for the active conversation', () => {
    const store = useSessionsStore();
    store.conversations = [{
      id: 'conv-1',
      inputTokens: 1000,
      outputTokens: 500,
      thinkingTokens: 100,
      cacheReadInputTokens: 25,
      cacheCreationInputTokens: 25,
    }];
    store.activeConversationId = 'conv-1';
    store.runningUsage = {
      conversationId: 'conv-1',
      inputTokens: 100,
      outputTokens: 50,
      thinkingTokens: 10,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 5,
    };

    expect(store.tokenTotal).toBe(1820);
    expect(store.formattedTokens.thinking).toBe('110');
    expect(store.formattedTokens.total).toBe('1.8K');
  });

  it('calculates conversation and session totals including descendants', () => {
    const store = useSessionsStore();
    store.conversations = [{
      id: 'conv-1',
      inputTokens: 100,
      outputTokens: 50,
      thinkingTokens: 25,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 5,
    }];
    store.sessions = [
      { id: 's1', inputTokens: 1000, outputTokens: 500, thinkingTokens: 100, cacheReadInputTokens: 50, cacheCreationInputTokens: 25 },
      { id: 's2', parentSessionId: 's1', inputTokens: 100, outputTokens: 50, thinkingTokens: 10, cacheReadInputTokens: 5, cacheCreationInputTokens: 5 },
    ];

    expect(store.getConversationTokenTotal('conv-1')).toBe(190);
    expect(store.getFormattedConversationTokenTotal('conv-1')).toBe('190');
    expect(store.getSessionTokenTotal('s1')).toBe(1845);
    expect(store.getFormattedSessionTokenTotal('s1')).toBe('1.8K');
  });
});
