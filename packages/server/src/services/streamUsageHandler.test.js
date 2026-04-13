import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleMessageStart,
  handleMessageDelta,
  handleTextDelta,
  extractTurnUsage,
  buildCumulativeSessionUsage,
  updateConversationUsage,
  handleResultUsage,
} from './streamUsageHandler.js';

// Mock module-level Maps and functions
const mockActiveConversationIds = new Map();
const mockCurrentModels = new Map();
const mockCurrentTurnUsage = new Map();
const mockEstimatedOutputTokens = new Map();

vi.mock('./usageTracker.js', () => ({
  updateTurnUsage: vi.fn(),
  currentTurnUsage: {
    get: (key) => mockCurrentTurnUsage.get(key),
    delete: (key) => mockCurrentTurnUsage.delete(key),
  },
  estimatedOutputTokens: {
    get: (key) => mockEstimatedOutputTokens.get(key),
    set: (key, val) => mockEstimatedOutputTokens.set(key, val),
    delete: (key) => mockEstimatedOutputTokens.delete(key),
  },
  estimateTokens: vi.fn(() => 10),
}));

vi.mock('./streamEventHandler.js', () => ({
  activeConversationIds: {
    get: (key) => mockActiveConversationIds.get(key),
    delete: (key) => mockActiveConversationIds.delete(key),
  },
  currentModels: {
    get: (key) => mockCurrentModels.get(key),
  },
}));

vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
    updateUsage: vi.fn(),
  },
  conversations: {
    getById: vi.fn(),
    updateUsage: vi.fn(),
  },
}));

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

vi.mock('@circuschief/shared', () => ({
  WS_MESSAGE_TYPES: {
    SESSION_USAGE_UPDATE: 'session_usage_update',
    SESSION_UPDATED: 'session_updated',
    CONVERSATION_UPDATED: 'conversation_updated',
    SESSION_PARTIAL: 'session_partial',
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockActiveConversationIds.clear();
  mockCurrentModels.clear();
  mockCurrentTurnUsage.clear();
  mockEstimatedOutputTokens.clear();
});

// ── handleMessageStart ───────────────────────────────────────────────────

describe('handleMessageStart', () => {
  it('broadcasts usage update when usage is present', async () => {
    const { broadcastToSession } = await import('../websocket.js');
    const { updateTurnUsage } = await import('./usageTracker.js');

    mockActiveConversationIds.set('sess-1', 'conv-1');
    updateTurnUsage.mockReturnValue({ inputTokens: 100, outputTokens: 0 });

    handleMessageStart('sess-1', {
      event: { message: { usage: { input_tokens: 100 } } },
    });

    expect(updateTurnUsage).toHaveBeenCalledWith('conv-1', { input_tokens: 100 }, 'message_start');
    expect(broadcastToSession).toHaveBeenCalledWith('sess-1', 'session_usage_update', expect.objectContaining({
      sessionId: 'sess-1',
      isFinal: false,
    }));
  });

  it('is no-op when no usage in event', async () => {
    const { broadcastToSession } = await import('../websocket.js');
    handleMessageStart('sess-1', { event: { message: {} } });
    expect(broadcastToSession).not.toHaveBeenCalled();
  });
});

// ── handleMessageDelta ───────────────────────────────────────────────────

describe('handleMessageDelta', () => {
  it('broadcasts usage update with isFinal false', async () => {
    const { broadcastToSession } = await import('../websocket.js');
    const { updateTurnUsage } = await import('./usageTracker.js');

    mockActiveConversationIds.set('sess-1', 'conv-1');
    updateTurnUsage.mockReturnValue({ inputTokens: 100, outputTokens: 50 });

    handleMessageDelta('sess-1', {
      event: { usage: { output_tokens: 50 } },
    });

    expect(broadcastToSession).toHaveBeenCalledWith('sess-1', 'session_usage_update', expect.objectContaining({
      isFinal: false,
    }));
  });

  it('is no-op when no usage', async () => {
    const { broadcastToSession } = await import('../websocket.js');
    handleMessageDelta('sess-1', { event: {} });
    expect(broadcastToSession).not.toHaveBeenCalled();
  });
});

// ── handleTextDelta ──────────────────────────────────────────────────────

describe('handleTextDelta', () => {
  it('accumulates text and broadcasts partial', async () => {
    const { broadcastToSession } = await import('../websocket.js');
    const textAccumulators = new Map();
    mockActiveConversationIds.set('sess-1', 'conv-1');

    handleTextDelta('sess-1', { text: 'Hello ' }, textAccumulators);
    expect(textAccumulators.get('sess-1')).toBe('Hello ');
    expect(broadcastToSession).toHaveBeenCalledWith('sess-1', 'session_partial', expect.objectContaining({
      text: 'Hello ',
    }));

    handleTextDelta('sess-1', { text: 'World' }, textAccumulators);
    expect(textAccumulators.get('sess-1')).toBe('Hello World');
  });

  it('returns early if no conversationId', async () => {
    const { broadcastToSession } = await import('../websocket.js');
    broadcastToSession.mockClear();

    const textAccumulators = new Map();
    mockActiveConversationIds.delete('sess-2');

    handleTextDelta('sess-2', { text: 'test' }, textAccumulators);

    // Should still broadcast partial text (first call) but not usage (only 1 call total)
    const calls = broadcastToSession.mock.calls;
    const partialCalls = calls.filter(c => c[1] === 'session_partial');
    const usageCalls = calls.filter(c => c[1] === 'session_usage_update');
    expect(partialCalls.length).toBe(1);
    expect(usageCalls.length).toBe(0);
  });

  it('estimates tokens and broadcasts usage with isEstimate flag', async () => {
    const { broadcastToSession } = await import('../websocket.js');
    broadcastToSession.mockClear();

    const textAccumulators = new Map();
    mockActiveConversationIds.set('sess-1', 'conv-1');
    mockCurrentTurnUsage.set('conv-1', {
      inputTokens: 100,
      outputTokens: 50,
      lastMessageOutput: 20,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 5,
    });

    handleTextDelta('sess-1', { text: 'test' }, textAccumulators);

    const usageCall = broadcastToSession.mock.calls.find(c => c[1] === 'session_usage_update');
    expect(usageCall).toBeDefined();
    expect(usageCall[2].isEstimate).toBe(true);
    expect(usageCall[2].isFinal).toBe(false);
  });
});

// ── extractTurnUsage ─────────────────────────────────────────────────────

describe('extractTurnUsage', () => {
  it('extracts from modelUsage first value', () => {
    mockCurrentModels.set('sess-1', 'claude-sonnet');
    const result = extractTurnUsage('sess-1', {
      modelUsage: { 'claude-opus': { inputTokens: 100, outputTokens: 50 } },
      usage: { input_tokens: 200, output_tokens: 100 },
    });
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.model).toBe('claude-sonnet');
  });

  it('falls back to event.usage', () => {
    mockCurrentModels.set('sess-1', null);
    const result = extractTurnUsage('sess-1', {
      usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
    });
    expect(result.inputTokens).toBe(200);
    expect(result.outputTokens).toBe(100);
    expect(result.cacheReadInputTokens).toBe(50);
    expect(result.cacheCreationInputTokens).toBe(10);
  });

  it('defaults contextWindow to 200000', () => {
    const result = extractTurnUsage('sess-1', { usage: {} });
    expect(result.contextWindow).toBe(200000);
  });

  it('defaults webSearchRequests to 0', () => {
    const result = extractTurnUsage('sess-1', { usage: {} });
    expect(result.webSearchRequests).toBe(0);
  });
});

// ── buildCumulativeSessionUsage ───────────────────────────────────────────

describe('buildCumulativeSessionUsage', () => {
  it('adds to existing session usage', async () => {
    const { sessions } = await import('../database.js');
    sessions.getById.mockReturnValue({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 5,
      webSearchRequests: 2,
    });

    const result = buildCumulativeSessionUsage('sess-1', {
      inputTokens: 50,
      outputTokens: 25,
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 2,
      webSearchRequests: 1,
      contextWindow: 200000,
    });

    expect(result.inputTokens).toBe(150);
    expect(result.outputTokens).toBe(75);
    expect(result.cacheReadInputTokens).toBe(15);
    expect(result.webSearchRequests).toBe(3);
    expect(result.contextWindow).toBe(200000);
  });

  it('handles null session fields by defaulting to 0', async () => {
    const { sessions } = await import('../database.js');
    sessions.getById.mockReturnValue({});

    const result = buildCumulativeSessionUsage('sess-1', {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
      contextWindow: 200000,
    });

    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });
});

// ── updateConversationUsage ──────────────────────────────────────────────

describe('updateConversationUsage', () => {
  it('returns null if no current conversation', () => {
    expect(updateConversationUsage('conv-1', null, {})).toBeNull();
  });

  it('cumulatively adds usage to existing conversation', async () => {
    const { conversations } = await import('../database.js');
    conversations.updateUsage.mockReturnValue({ id: 'conv-1', inputTokens: 150, outputTokens: 75 });

    const result = updateConversationUsage('conv-1', { inputTokens: 100, outputTokens: 50 }, {
      inputTokens: 50,
      outputTokens: 25,
    });

    expect(result.inputTokens).toBe(150);
    expect(result.outputTokens).toBe(75);
    expect(conversations.updateUsage).toHaveBeenCalledWith('conv-1', expect.objectContaining({
      inputTokens: 150,
      outputTokens: 75,
    }));
  });
});

// ── handleResultUsage ────────────────────────────────────────────────────

describe('handleResultUsage', () => {
  it('full flow: extracts, updates, broadcasts, and cleans up', async () => {
    const { sessions, conversations } = await import('../database.js');
    const { broadcastToSession, broadcastToProject } = await import('../websocket.js');

    mockActiveConversationIds.set('sess-1', 'conv-1');
    mockCurrentModels.set('sess-1', 'claude-sonnet');

    sessions.getById.mockReturnValue({ id: 'sess-1', inputTokens: 0, outputTokens: 0, projectId: 'proj-1' });
    sessions.updateUsage.mockReturnValue({ id: 'sess-1', inputTokens: 100, outputTokens: 50, projectId: 'proj-1' });
    conversations.getById.mockReturnValue({ id: 'conv-1', inputTokens: 0, outputTokens: 0 });
    conversations.updateUsage.mockReturnValue({ id: 'conv-1', inputTokens: 100, outputTokens: 50 });

    handleResultUsage('sess-1', {
      modelUsage: { 'claude-sonnet': { inputTokens: 100, outputTokens: 50 } },
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    // Should broadcast usage update (isFinal: true)
    expect(broadcastToSession).toHaveBeenCalledWith('sess-1', 'session_usage_update', expect.objectContaining({
      isFinal: true,
    }));

    // Should broadcast session update
    expect(broadcastToProject).toHaveBeenCalledWith('proj-1', 'session_updated', expect.any(Object));

    // Should broadcast conversation update
    expect(broadcastToSession).toHaveBeenCalledWith('sess-1', 'conversation_updated', expect.any(Object));

    // Should clean up Maps
    expect(mockActiveConversationIds.has('sess-1')).toBe(false);
  });
});
