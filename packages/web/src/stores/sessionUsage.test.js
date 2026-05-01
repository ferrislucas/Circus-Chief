import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionUsageStore } from './sessionUsage.js';

describe('SessionUsage Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('tracks running usage with thinking tokens', () => {
    const store = useSessionUsageStore();
    store.updateRunningUsage({ inputTokens: 100, outputTokens: 50, thinkingTokens: 25 }, 'conv-1');

    expect(store.runningUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      thinkingTokens: 25,
      conversationId: 'conv-1',
    });
  });

  it('formats raw token totals for persisted conversation usage', () => {
    const store = useSessionUsageStore();
    const result = store.getFormattedTokens([{
      id: 'conv-1',
      inputTokens: 1500,
      outputTokens: 500,
      thinkingTokens: 250,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: 100,
    }], 'conv-1');

    expect(result).toEqual({
      input: '1.5K',
      output: '500',
      thinking: '250',
      total: '2.5K',
      cacheRead: '200',
      cacheCreation: '100',
    });
  });

  it('merges running usage into raw totals', () => {
    const store = useSessionUsageStore();
    store.runningUsage = {
      conversationId: 'conv-1',
      inputTokens: 500,
      outputTokens: 200,
      thinkingTokens: 50,
      cacheReadInputTokens: 50,
      cacheCreationInputTokens: 0,
    };

    expect(store.getTokenTotal([{
      id: 'conv-1',
      inputTokens: 1000,
      outputTokens: 300,
      thinkingTokens: 100,
      cacheReadInputTokens: 100,
      cacheCreationInputTokens: 0,
    }], 'conv-1')).toBe(2300);
  });

  it('finalizes usage into conversation and session state', () => {
    const store = useSessionUsageStore();
    const conversations = [{ id: 'conv-1', inputTokens: 0, outputTokens: 0, thinkingTokens: 0 }];
    const currentSession = { id: 'session-1', inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    const usage = {
      inputTokens: 100,
      outputTokens: 50,
      thinkingTokens: 25,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 5,
      webSearchRequests: 0,
      contextWindow: 200000,
    };

    store.runningUsage = usage;
    store.finalizeUsage(usage, 'conv-1', {
      conversations,
      currentSession,
      updateConversationAtIndex: (index, update) => Object.assign(conversations[index], update),
      updateCurrentSession: (update) => Object.assign(currentSession, update),
    });

    expect(conversations[0].thinkingTokens).toBe(25);
    expect(currentSession.thinkingTokens).toBe(25);
    expect(store.runningUsage).toBeNull();
  });
});
