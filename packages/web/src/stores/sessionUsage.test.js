import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionUsageStore } from './sessionUsage.js';

// Mock settings store
vi.mock('./settings.js', () => ({
  useSettingsStore: () => ({
    tokenCostWeights: {
      input: 1.0,
      output: 1.0,
      cacheRead: 0.1,
      cacheCreation: 1.25,
    },
  }),
}));

describe('SessionUsage Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('initial state', () => {
    it('has null runningUsage by default', () => {
      const store = useSessionUsageStore();
      expect(store.runningUsage).toBeNull();
    });
  });

  describe('updateRunningUsage', () => {
    it('stores running usage with conversationId', () => {
      const store = useSessionUsageStore();
      store.updateRunningUsage({ inputTokens: 100, outputTokens: 50 }, 'conv-1');
      expect(store.runningUsage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        conversationId: 'conv-1',
      });
    });

    it('stores running usage without conversationId', () => {
      const store = useSessionUsageStore();
      store.updateRunningUsage({ inputTokens: 200 });
      expect(store.runningUsage.inputTokens).toBe(200);
      expect(store.runningUsage.conversationId).toBeNull();
    });
  });

  describe('clearRunningUsage', () => {
    it('resets runningUsage to null', () => {
      const store = useSessionUsageStore();
      store.updateRunningUsage({ inputTokens: 100 });
      store.clearRunningUsage();
      expect(store.runningUsage).toBeNull();
    });
  });

  describe('isUsageUpdating', () => {
    it('returns false when no running usage', () => {
      const store = useSessionUsageStore();
      expect(store.isUsageUpdating).toBe(false);
    });

    it('returns true when running usage exists', () => {
      const store = useSessionUsageStore();
      store.runningUsage = { inputTokens: 100, conversationId: 'conv-1' };
      expect(store.isUsageUpdating).toBe(true);
    });
  });

  describe('getFormattedTokens', () => {
    it('returns dashes when no data', () => {
      const store = useSessionUsageStore();
      const result = store.getFormattedTokens([], null);
      expect(result).toEqual({ input: '-', output: '-', total: '-', cacheRead: '-', cacheCreation: '-' });
    });

    it('returns formatted tokens for a conversation', () => {
      const store = useSessionUsageStore();
      const conversations = [{
        id: 'conv-1',
        inputTokens: 1500,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
      }];
      const result = store.getFormattedTokens(conversations, 'conv-1');
      expect(result.input).toBe('1.5K');
      expect(result.output).toBe('500');
      expect(result.total).toBe('2.0K');
    });

    it('includes running usage when streaming', () => {
      const store = useSessionUsageStore();
      store.runningUsage = {
        inputTokens: 500,
        outputTokens: 200,
        cacheReadInputTokens: 50,
        cacheCreationInputTokens: 0,
        conversationId: 'conv-1',
      };
      const conversations = [{
        id: 'conv-1',
        inputTokens: 1000,
        outputTokens: 300,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 0,
      }];
      const result = store.getFormattedTokens(conversations, 'conv-1');
      expect(result.input).toBe('1.5K');
      expect(result.output).toBe('500');
      expect(result.total).toBe('2.0K');
    });
  });

  describe('getContextPercentage', () => {
    it('returns 0 when no data', () => {
      const store = useSessionUsageStore();
      expect(store.getContextPercentage([], null, null)).toBe(0);
    });

    it('calculates percentage from conversation', () => {
      const store = useSessionUsageStore();
      const conversations = [{
        id: 'conv-1',
        inputTokens: 100000,
        outputTokens: 100000,
        contextWindow: 200000,
      }];
      expect(store.getContextPercentage(conversations, 'conv-1', null)).toBe(100);
    });

    it('includes running usage in percentage calculation', () => {
      const store = useSessionUsageStore();
      store.runningUsage = {
        inputTokens: 50000,
        outputTokens: 50000,
        conversationId: 'conv-1',
        contextWindow: 200000,
      };
      const conversations = [{
        id: 'conv-1',
        inputTokens: 0,
        outputTokens: 0,
        contextWindow: 200000,
      }];
      expect(store.getContextPercentage(conversations, 'conv-1', null)).toBe(50);
    });
  });

  describe('getConversationDisplayTokens', () => {
    it('returns zeros for unknown conversation', () => {
      const store = useSessionUsageStore();
      expect(store.getConversationDisplayTokens('unknown', [])).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        total: 0,
      });
    });

    it('returns conversation tokens', () => {
      const store = useSessionUsageStore();
      const conversations = [{
        id: 'conv-1',
        inputTokens: 1000,
        outputTokens: 500,
      }];
      const result = store.getConversationDisplayTokens('conv-1', conversations);
      expect(result.inputTokens).toBe(1000);
      expect(result.outputTokens).toBe(500);
      expect(result.total).toBe(1500);
    });

    it('includes running usage for active conversation', () => {
      const store = useSessionUsageStore();
      store.runningUsage = {
        inputTokens: 200,
        outputTokens: 100,
        conversationId: 'conv-1',
      };
      const conversations = [{
        id: 'conv-1',
        inputTokens: 800,
        outputTokens: 400,
      }];
      const result = store.getConversationDisplayTokens('conv-1', conversations);
      expect(result.inputTokens).toBe(1000);
      expect(result.outputTokens).toBe(500);
      expect(result.total).toBe(1500);
    });
  });

  describe('getBillableTokens', () => {
    it('returns 0 when no data', () => {
      const store = useSessionUsageStore();
      expect(store.getBillableTokens([], null)).toBe(0);
    });

    it('calculates BTE for a conversation', () => {
      const store = useSessionUsageStore();
      const conversations = [{
        id: 'conv-1',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
      }];
      const result = store.getBillableTokens(conversations, 'conv-1');
      // 1000 * 1.0 + 500 * 1.0 + 200 * 0.1 + 100 * 1.25 = 1645
      expect(result).toBe(1645);
    });
  });

  describe('getFormattedBillableTokens', () => {
    it('returns dash when no data', () => {
      const store = useSessionUsageStore();
      expect(store.getFormattedBillableTokens([], null)).toBe('-');
    });

    it('returns formatted BTE string', () => {
      const store = useSessionUsageStore();
      const conversations = [{
        id: 'conv-1',
        inputTokens: 50000,
        outputTokens: 25000,
        cacheReadInputTokens: 10000,
        cacheCreationInputTokens: 5000,
      }];
      const result = store.getFormattedBillableTokens(conversations, 'conv-1');
      // Should be a formatted string like "82.3K"
      expect(result).not.toBe('-');
    });
  });

  describe('finalizeUsage', () => {
    it('clears running usage', () => {
      const store = useSessionUsageStore();
      store.runningUsage = { inputTokens: 100 };

      const conversations = [{ id: 'conv-1' }];
      let updatedConv = null;
      let updatedSession = null;

      store.finalizeUsage(
        { inputTokens: 500, outputTokens: 200 },
        'conv-1',
        {
          conversations,
          currentSession: { id: 'session-1' },
          updateConversationAtIndex: (idx, data) => { updatedConv = data; },
          updateCurrentSession: (data) => { updatedSession = data; },
        }
      );

      expect(store.runningUsage).toBeNull();
      expect(updatedConv).toBeTruthy();
      expect(updatedConv.inputTokens).toBe(500);
    });
  });
});
