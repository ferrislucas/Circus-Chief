import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionsStore } from './sessions.js';
import { DEFAULT_TOKEN_COST_WEIGHTS } from '@circuschief/shared';

// Mock the API module
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

// Mock the settings store
vi.mock('./settings.js', () => ({
  useSettingsStore: () => ({
    tokenCostWeights: DEFAULT_TOKEN_COST_WEIGHTS,
  }),
}));

describe('Sessions Store - Billable Token Equivalent (BTE) Getters', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('billableTokens getter', () => {
    it('calculates BTE for active conversation with persisted data', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 2000,
          cacheCreationInputTokens: 100,
        },
      ];
      store.activeConversationId = 'conv-1';

      // Expected: 1000*1.0 + 500*5.0 + 2000*0.1 + 100*1.25 = 1000 + 2500 + 200 + 125 = 3825
      expect(store.billableTokens).toBe(3825);
    });

    it('returns 0 when no active conversation', () => {
      const store = useSessionsStore();
      store.conversations = [];
      store.activeConversationId = null;

      expect(store.billableTokens).toBe(0);
    });

    it('returns 0 when active conversation not found', () => {
      const store = useSessionsStore();
      store.conversations = [{ id: 'conv-1' }];
      store.activeConversationId = 'conv-2';

      expect(store.billableTokens).toBe(0);
    });

    it('handles missing token fields gracefully', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 100,
          // Other fields missing
        },
      ];
      store.activeConversationId = 'conv-1';

      // Expected: 100*1.0 = 100
      expect(store.billableTokens).toBe(100);
    });

    it('handles conversation with all undefined token fields', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
        },
      ];
      store.activeConversationId = 'conv-1';

      expect(store.billableTokens).toBe(0);
    });

    it('includes runningUsage during streaming', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];
      store.activeConversationId = 'conv-1';
      store.runningUsage = {
        conversationId: 'conv-1',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };

      // Expected: (1000+100)*1.0 + (500+50)*5.0 = 1100 + 2750 = 3850
      expect(store.billableTokens).toBe(3850);
    });

    it('does not include runningUsage from different conversation', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];
      store.activeConversationId = 'conv-1';
      store.runningUsage = {
        conversationId: 'conv-2',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };

      // Expected: Only conv-1 tokens, no runningUsage
      // 1000*1.0 + 500*5.0 = 1000 + 2500 = 3500
      expect(store.billableTokens).toBe(3500);
    });

    it('includes runningUsage when activeConversationId is null but runningUsage exists', () => {
      const store = useSessionsStore();
      store.conversations = [];
      store.activeConversationId = null;
      store.runningUsage = {
        conversationId: null,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };

      // When there's no active conversation, runningUsage is still included
      // Expected: 100*1.0 + 50*5.0 = 100 + 250 = 350
      expect(store.billableTokens).toBe(350);
    });

    it('handles cache tokens in runningUsage', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 1000,
          cacheCreationInputTokens: 100,
        },
      ];
      store.activeConversationId = 'conv-1';
      store.runningUsage = {
        conversationId: 'conv-1',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 1000,
        cacheCreationInputTokens: 50,
      };

      // Expected: 1000*1.0 + 500*5.0 + (1000+1000)*0.1 + (100+50)*1.25
      //         = 1000 + 2500 + 200 + 187.5 = 3888 (rounded)
      expect(store.billableTokens).toBe(3888);
    });
  });

  describe('formattedBillableTokens getter', () => {
    it('formats BTE as string with K suffix', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 2000,
          cacheCreationInputTokens: 100,
        },
      ];
      store.activeConversationId = 'conv-1';

      // BTE = 3825, formatted as "3.8K"
      expect(store.formattedBillableTokens).toBe('3.8K');
    });

    it('returns "-" when no active conversation', () => {
      const store = useSessionsStore();
      store.conversations = [];
      store.activeConversationId = null;

      expect(store.formattedBillableTokens).toBe('-');
    });

    it('returns "-" when active conversation not found', () => {
      const store = useSessionsStore();
      store.conversations = [{ id: 'conv-1' }];
      store.activeConversationId = 'conv-2';

      expect(store.formattedBillableTokens).toBe('-');
    });

    it('formats small numbers without suffix', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];
      store.activeConversationId = 'conv-1';

      // BTE = 100*1.0 + 50*5.0 = 350
      expect(store.formattedBillableTokens).toBe('350');
    });

    it('formats millions with M suffix', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000000,
          outputTokens: 500000,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];
      store.activeConversationId = 'conv-1';

      // BTE = 1000000*1.0 + 500000*5.0 = 3500000, formatted as "3.5M"
      expect(store.formattedBillableTokens).toBe('3.5M');
    });

    it('includes runningUsage in formatted output', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 10000,
          outputTokens: 5000,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];
      store.activeConversationId = 'conv-1';
      store.runningUsage = {
        conversationId: 'conv-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };

      // BTE = (10000+1000)*1.0 + (5000+500)*5.0 = 11000 + 27500 = 38500
      // Formatted as "38.5K"
      expect(store.formattedBillableTokens).toBe('38.5K');
    });

    it('formats zero as "0"', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];
      store.activeConversationId = 'conv-1';

      expect(store.formattedBillableTokens).toBe('0');
    });
  });

  describe('getConversationBillableTokens getter', () => {
    it('calculates BTE for specific conversation', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        {
          id: 'conv-2',
          inputTokens: 2000,
          outputTokens: 1000,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];

      // conv-1: 1000*1.0 + 500*5.0 = 3500
      expect(store.getConversationBillableTokens('conv-1')).toBe(3500);

      // conv-2: 2000*1.0 + 1000*5.0 = 7000
      expect(store.getConversationBillableTokens('conv-2')).toBe(7000);
    });

    it('returns 0 for non-existent conversation', () => {
      const store = useSessionsStore();
      store.conversations = [];

      expect(store.getConversationBillableTokens('non-existent')).toBe(0);
    });

    it('includes runningUsage for the specified conversation', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];
      store.runningUsage = {
        conversationId: 'conv-1',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };

      // Expected: (1000+100)*1.0 + (500+50)*5.0 = 1100 + 2750 = 3850
      expect(store.getConversationBillableTokens('conv-1')).toBe(3850);
    });

    it('does not include runningUsage for different conversation', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];
      store.runningUsage = {
        conversationId: 'conv-2',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };

      // Expected: Only conv-1 tokens, no runningUsage
      expect(store.getConversationBillableTokens('conv-1')).toBe(3500);
    });

    it('handles conversation with no token data', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
        },
      ];

      expect(store.getConversationBillableTokens('conv-1')).toBe(0);
    });

    it('calculates correctly with all token types', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 2000,
          cacheCreationInputTokens: 100,
        },
      ];

      // Expected: 1000*1.0 + 500*5.0 + 2000*0.1 + 100*1.25 = 1000 + 2500 + 200 + 125 = 3825
      expect(store.getConversationBillableTokens('conv-1')).toBe(3825);
    });
  });

  describe('getFormattedConversationBillableTokens getter', () => {
    it('returns formatted BTE for specific conversation', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 2000,
          cacheCreationInputTokens: 100,
        },
      ];

      // BTE = 1000*1.0 + 500*5.0 + 2000*0.1 + 100*1.25 = 3825
      expect(store.getFormattedConversationBillableTokens('conv-1')).toBe('3.8K');
    });

    it('returns "-" for non-existent conversation', () => {
      const store = useSessionsStore();
      store.conversations = [];

      expect(store.getFormattedConversationBillableTokens('non-existent')).toBe('-');
    });

    it('includes runningUsage in formatted output', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 10000,
          outputTokens: 5000,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];
      store.runningUsage = {
        conversationId: 'conv-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };

      expect(store.getFormattedConversationBillableTokens('conv-1')).toBe('38.5K');
    });

    it('formats large numbers with M suffix', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 1000000,
          outputTokens: 500000,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];

      expect(store.getFormattedConversationBillableTokens('conv-1')).toBe('3.5M');
    });

    it('formats small numbers without suffix', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];

      // BTE = 100*1.0 + 50*5.0 = 350
      expect(store.getFormattedConversationBillableTokens('conv-1')).toBe('350');
    });

    it('formats zero as "0"', () => {
      const store = useSessionsStore();
      store.conversations = [
        {
          id: 'conv-1',
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      ];

      expect(store.getFormattedConversationBillableTokens('conv-1')).toBe('0');
    });
  });
});
