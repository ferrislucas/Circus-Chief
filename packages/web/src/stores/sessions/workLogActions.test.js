import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionsStore } from '../sessions.js';

vi.mock('../../composables/useApi.js', () => ({
  api: {
    getSessionWorkLogs: vi.fn(),
  },
}));

describe('workLogActions', () => {
  let store;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useSessionsStore();
    store.viewedSessionId = 'sess-1';
    store.currentSession = { id: 'sess-1', name: 'Test Session' };
    store.workLogs = {};
    store.conversations = [];
    store.partialThinkingBySession = {};
    store.partialText = '';
    store.error = null;
    store.runningUsage = null;
    vi.clearAllMocks();
  });

  describe('fetchWorkLogs', () => {
    it('sets workLogs from grouped response on success', async () => {
      const { api } = await import('../../composables/useApi.js');
      api.getSessionWorkLogs.mockResolvedValue({
        'msg-1': [{ id: 'log-1', text: 'work item' }],
        '_unassociated': [],
      });
      await store.fetchWorkLogs('sess-1');
      expect(store.workLogs['msg-1']).toEqual([{ id: 'log-1', text: 'work item' }]);
    });

    it('skips fetch if viewedSessionId mismatch (pre-fetch guard)', async () => {
      const { api } = await import('../../composables/useApi.js');
      store.viewedSessionId = 'sess-2';
      await store.fetchWorkLogs('sess-1');
      expect(api.getSessionWorkLogs).not.toHaveBeenCalled();
    });

    it('discards results if user navigated away during await (post-fetch guard)', async () => {
      const { api } = await import('../../composables/useApi.js');
      api.getSessionWorkLogs.mockImplementation(async () => {
        store.viewedSessionId = 'sess-2';
        return { 'msg-1': [{ id: 'log-1', text: 'work' }] };
      });
      await store.fetchWorkLogs('sess-1');
      expect(store.workLogs['msg-1']).toBeUndefined();
    });

    it('preserves unassociated logs not in fetch', async () => {
      store.workLogs = { '_unassociated': [{ id: 'existing-log', text: 'old' }] };
      const { api } = await import('../../composables/useApi.js');
      api.getSessionWorkLogs.mockResolvedValue({
        'msg-1': [{ id: 'log-1', text: 'new' }],
        '_unassociated': [{ id: 'log-2', text: 'fetched' }],
      });
      await store.fetchWorkLogs('sess-1');
      const unassociated = store.workLogs['_unassociated'];
      expect(unassociated).toEqual(expect.arrayContaining([
        { id: 'log-2', text: 'fetched' },
        { id: 'existing-log', text: 'old' },
      ]));
    });

    it('sets error on API failure', async () => {
      const { api } = await import('../../composables/useApi.js');
      api.getSessionWorkLogs.mockRejectedValue(new Error('Network error'));
      await store.fetchWorkLogs('sess-1');
      expect(store.error).toBe('Network error');
    });
  });

  describe('addWorkLog', () => {
    it('adds log to correct messageId bucket', () => {
      store.addWorkLog({ id: 'log-1', messageId: 'msg-1', text: 'test' });
      expect(store.workLogs['msg-1']).toEqual([{ id: 'log-1', messageId: 'msg-1', text: 'test' }]);
    });

    it('prevents duplicate by id', () => {
      store.addWorkLog({ id: 'log-1', messageId: 'msg-1', text: 'first' });
      store.addWorkLog({ id: 'log-1', messageId: 'msg-1', text: 'duplicate' });
      expect(store.workLogs['msg-1']).toHaveLength(1);
    });

    it('ignores wrong sessionId when currentSession exists', () => {
      store.addWorkLog({ id: 'log-1', sessionId: 'sess-2', text: 'wrong session' });
      expect(Object.keys(store.workLogs)).toHaveLength(0);
    });

    it('adds to _unassociated when no messageId', () => {
      store.addWorkLog({ id: 'log-1', text: 'no message' });
      expect(store.workLogs['_unassociated']).toEqual([{ id: 'log-1', text: 'no message' }]);
    });
  });

  describe('setWorkLogs / clearWorkLogs', () => {
    it('setWorkLogs sets workLogs directly', () => {
      const logs = { 'msg-1': [{ id: 'log-1' }] };
      store.setWorkLogs(logs);
      expect(store.workLogs).toEqual(logs);
    });

    it('clearWorkLogs empties workLogs and calls clearAllPartialThinking', () => {
      store.workLogs = { 'msg-1': [{ id: 'log-1' }] };
      store.partialThinkingBySession = { 'sess-1': 'thinking...' };
      store.clearWorkLogs();
      expect(store.workLogs).toEqual({});
      expect(store.partialThinkingBySession).toEqual({});
    });
  });

  describe('associateWorkLogs', () => {
    it('moves unassociated logs to messageId bucket', () => {
      store.workLogs = {
        '_unassociated': [
          { id: 'log-1', text: 'work 1' },
          { id: 'log-2', text: 'work 2' },
        ],
      };
      store.associateWorkLogs('msg-1');
      expect(store.workLogs['msg-1']).toEqual([
        { id: 'log-1', text: 'work 1' },
        { id: 'log-2', text: 'work 2' },
      ]);
      expect(store.workLogs['_unassociated']).toEqual([]);
    });

    it('deduplicates against existing logs', () => {
      store.workLogs = {
        'msg-1': [{ id: 'log-1', text: 'already here' }],
        '_unassociated': [{ id: 'log-1', text: 'duplicate' }],
      };
      store.associateWorkLogs('msg-1');
      expect(store.workLogs['msg-1']).toHaveLength(1);
    });

    it('is no-op when no unassociated logs', () => {
      store.workLogs = { 'msg-1': [{ id: 'log-1' }] };
      const before = JSON.stringify(store.workLogs);
      store.associateWorkLogs('msg-2');
      expect(JSON.stringify(store.workLogs)).toBe(before);
    });
  });

  describe('partial thinking actions', () => {
    it('setPartialThinking sets thinking for session', () => {
      store.setPartialThinking('thinking content', 'sess-1');
      expect(store.partialThinkingBySession['sess-1']).toBe('thinking content');
    });

    it('setPartialThinking falls back to currentSession.id', () => {
      store.setPartialThinking('thinking content');
      expect(store.partialThinkingBySession['sess-1']).toBe('thinking content');
    });

    it('setPartialThinking is no-op when no session', () => {
      store.currentSession = null;
      store.setPartialThinking('thinking', null);
      expect(Object.keys(store.partialThinkingBySession)).toHaveLength(0);
    });

    it('clearPartialThinking clears for specific session', () => {
      store.partialThinkingBySession = { 'sess-1': 'thinking...', 'sess-2': 'other' };
      store.clearPartialThinking('sess-1');
      expect(store.partialThinkingBySession['sess-1']).toBeNull();
      expect(store.partialThinkingBySession['sess-2']).toBe('other');
    });

    it('clearAllPartialThinking resets all', () => {
      store.partialThinkingBySession = { 'sess-1': 'a', 'sess-2': 'b' };
      store.clearAllPartialThinking();
      expect(store.partialThinkingBySession).toEqual({});
    });
  });

  describe('setPartialText / clearPartialText', () => {
    it('sets partialText immediately on first call', () => {
      store.setPartialText('hello');
      expect(store.partialText).toBe('hello');
    });

    it('throttles subsequent calls within 150ms', () => {
      vi.useFakeTimers();
      store.setPartialText('hello');
      store.setPartialText('world');
      expect(store.partialText).toBe('hello');
      expect(store._pendingPartialText).toBe('world');
      vi.advanceTimersByTime(150);
      expect(store.partialText).toBe('world');
      vi.useRealTimers();
    });

    it('clearPartialText clears everything', () => {
      vi.useFakeTimers();
      store.setPartialText('hello');
      store.setPartialText('world');
      store.clearPartialText();
      expect(store.partialText).toBe('');
      expect(store._pendingPartialText).toBeNull();
      vi.useRealTimers();
    });
  });

  describe('updateRunningUsage', () => {
    it('sets runningUsage with conversationId', () => {
      const usage = { inputTokens: 100, outputTokens: 50 };
      store.updateRunningUsage(usage, 'conv-1');
      expect(store.runningUsage).toEqual({ ...usage, conversationId: 'conv-1' });
    });

    it('sets runningUsage without conversationId', () => {
      const usage = { inputTokens: 100, outputTokens: 50 };
      store.updateRunningUsage(usage);
      expect(store.runningUsage).toEqual({ ...usage, conversationId: null });
    });
  });

  describe('finalizeUsage', () => {
    it('updates matching conversation and currentSession', () => {
      store.conversations = [{ id: 'conv-1', inputTokens: 0, outputTokens: 0 }];
      store.currentSession = { id: 'sess-1', inputTokens: 0, outputTokens: 0 };

      store.finalizeUsage({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 5,
        webSearchRequests: 2,
        contextWindow: 200000,
        model: 'sonnet',
      }, 'conv-1');

      expect(store.conversations[0].inputTokens).toBe(100);
      expect(store.conversations[0].outputTokens).toBe(50);
      expect(store.currentSession.inputTokens).toBe(100);
      expect(store.runningUsage).toBeNull();
    });

    it('skips conversation update when conversationId is null but still updates currentSession', () => {
      store.conversations = [];
      store.currentSession = { id: 'sess-1', inputTokens: 0, outputTokens: 0 };

      store.finalizeUsage({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        contextWindow: 200000,
      }, null);

      expect(store.currentSession.inputTokens).toBe(100);
      expect(store.runningUsage).toBeNull();
    });
  });

  describe('updateConversationUsage', () => {
    it('updates matching conversation', () => {
      store.conversations = [{ id: 'conv-1', inputTokens: 0, outputTokens: 0 }];

      store.updateConversationUsage('conv-1', {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 5,
        webSearchRequests: 2,
        contextWindow: 200000,
        model: 'sonnet',
      });

      expect(store.conversations[0].inputTokens).toBe(100);
      expect(store.conversations[0].outputTokens).toBe(50);
    });

    it('is no-op when conversation not found', () => {
      store.conversations = [];
      const before = JSON.stringify(store.conversations);
      store.updateConversationUsage('conv-1', { inputTokens: 100 });
      expect(JSON.stringify(store.conversations)).toBe(before);
    });
  });

  describe('clearRunningUsage', () => {
    it('sets runningUsage to null and calls clearPartialThinking', () => {
      store.runningUsage = { inputTokens: 100 };
      store.partialThinkingBySession = { 'sess-1': 'thinking...' };
      store.clearRunningUsage();
      expect(store.runningUsage).toBeNull();
      expect(store.partialThinkingBySession).toEqual({ 'sess-1': null });
    });
  });
});
