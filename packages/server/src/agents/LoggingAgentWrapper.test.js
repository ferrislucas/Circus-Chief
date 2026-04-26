import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoggingAgentWrapper } from './LoggingAgentWrapper.js';

// Mock the agentCallLogger service
vi.mock('../services/agentCallLogger.js', () => ({
  agentCallLogger: {
    startCall: vi.fn(() => 'mock-call-id'),
    updateUsage: vi.fn(),
    completeCall: vi.fn(),
  },
}));

import { agentCallLogger } from '../services/agentCallLogger.js';

// Helper: create a mock agent that yields given events
function createMockAgent(events, capabilities = {}) {
  return {
    async *execute(_queryParams) {
      for (const event of events) {
        yield event;
      }
    },
    supportsResume() {
      return capabilities.resume || false;
    },
    getCapabilities() {
      return {
        streaming: true,
        thinking: true,
        toolUse: true,
        resume: true,
        ...capabilities,
      };
    },
  };
}

describe('LoggingAgentWrapper', () => {
  const meta = {
    sessionId: 'session-1',
    conversationId: 'conv-1',
    callType: 'runSession',
    agentType: 'claude-code',
    model: 'claude-sonnet-4-20250514',
    promptLength: 500,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('yields all events from inner agent unchanged', async () => {
    const events = [
      { type: 'system', subtype: 'system.init' },
      { type: 'assistant', message: { content: 'Hello' } },
      { type: 'result', subtype: 'result.success' },
    ];

    const wrapper = new LoggingAgentWrapper(createMockAgent(events));
    const collected = [];
    for await (const event of wrapper.execute({ prompt: 'test' }, meta)) {
      collected.push(event);
    }

    expect(collected).toEqual(events);
  });

  it('calls agentCallLogger.startCall() before first yield', async () => {
    const events = [{ type: 'system' }];
    const wrapper = new LoggingAgentWrapper(createMockAgent(events));

    for await (const _event of wrapper.execute({ prompt: 'test' }, meta)) {
      // By the time we get the first event, startCall should have been called
      expect(agentCallLogger.startCall).toHaveBeenCalledWith(meta);
    }
  });

  it('calls agentCallLogger.updateUsage() on result events with modelUsage', async () => {
    const events = [
      { type: 'system' },
      {
        type: 'result',
        subtype: 'result.success',
        modelUsage: {
          'claude-sonnet-4-20250514': {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadInputTokens: 300,
            cacheCreationInputTokens: 100,
          },
        },
      },
    ];

    const wrapper = new LoggingAgentWrapper(createMockAgent(events));
    const collected = [];
    for await (const event of wrapper.execute({ prompt: 'test' }, meta)) {
      collected.push(event);
    }

    expect(agentCallLogger.updateUsage).toHaveBeenCalledWith('mock-call-id', {
      inputTokens: 1000,
      outputTokens: 500,
      thinkingTokens: 0,
      cacheReadInputTokens: 300,
      cacheCreationInputTokens: 100,
    });
  });

  it('calls agentCallLogger.updateUsage() on result events with usage field', async () => {
    const events = [
      {
        type: 'result',
        subtype: 'result.success',
        usage: {
          input_tokens: 800,
          output_tokens: 400,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 50,
        },
      },
    ];

    const wrapper = new LoggingAgentWrapper(createMockAgent(events));
    for await (const _event of wrapper.execute({ prompt: 'test' }, meta)) {
      // consume
    }

    expect(agentCallLogger.updateUsage).toHaveBeenCalledWith('mock-call-id', {
      inputTokens: 800,
      outputTokens: 400,
      thinkingTokens: 0,
      cacheReadInputTokens: 200,
      cacheCreationInputTokens: 50,
    });
  });

  it('does NOT call updateUsage on result.error events', async () => {
    const events = [
      {
        type: 'result',
        subtype: 'error',
        error: { message: 'fail' },
      },
    ];

    const wrapper = new LoggingAgentWrapper(createMockAgent(events));
    for await (const _event of wrapper.execute({ prompt: 'test' }, meta)) {
      // consume
    }

    expect(agentCallLogger.updateUsage).not.toHaveBeenCalled();
  });

  it('calls agentCallLogger.completeCall(success: true) after generator exhaustion', async () => {
    const events = [{ type: 'system' }, { type: 'result', subtype: 'result.success' }];

    const wrapper = new LoggingAgentWrapper(createMockAgent(events));
    for await (const _event of wrapper.execute({ prompt: 'test' }, meta)) {
      // consume
    }

    expect(agentCallLogger.completeCall).toHaveBeenCalledWith('mock-call-id', {
      success: true,
    });
  });

  it('calls agentCallLogger.completeCall(success: false, error) when inner agent throws', async () => {
    const error = new Error('SDK crash');
    const mockAgent = {
      async *execute() {
        yield { type: 'system' };
        throw error;
      },
      supportsResume: () => false,
      getCapabilities: () => ({}),
    };

    const wrapper = new LoggingAgentWrapper(mockAgent);

    await expect(async () => {
      for await (const _event of wrapper.execute({ prompt: 'test' }, meta)) {
        // consume
      }
    }).rejects.toThrow('SDK crash');

    expect(agentCallLogger.completeCall).toHaveBeenCalledWith('mock-call-id', {
      success: false,
      error,
    });
  });

  it('does NOT swallow errors - re-throws after logging', async () => {
    const mockAgent = {
      async *execute() { // eslint-disable-line require-yield
        throw new Error('original error');
      },
      supportsResume: () => false,
      getCapabilities: () => ({}),
    };

    const wrapper = new LoggingAgentWrapper(mockAgent);

    await expect(async () => {
      for await (const _event of wrapper.execute({ prompt: 'test' }, meta)) {
        // consume
      }
    }).rejects.toThrow('original error');
  });

  it('delegates supportsResume() to inner agent', () => {
    const wrapper = new LoggingAgentWrapper(createMockAgent([], { resume: true }));
    expect(wrapper.supportsResume()).toBe(true);

    const wrapper2 = new LoggingAgentWrapper(createMockAgent([], { resume: false }));
    expect(wrapper2.supportsResume()).toBe(false);
  });

  it('delegates getCapabilities() to inner agent', () => {
    const caps = { streaming: true, thinking: false, reasoningEffort: true, toolUse: true, resume: false };
    const wrapper = new LoggingAgentWrapper(createMockAgent([], caps));
    expect(wrapper.getCapabilities()).toEqual(caps);
  });

  it('handles Codex-shaped events and extracts usage from the terminal result', async () => {
    const codexEvents = [
      { type: 'system', subtype: 'init', session_id: 'codex-abc', model: 'gpt-4o' },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
      { type: 'result', subtype: 'success', usage: { input_tokens: 7, output_tokens: 3 } },
    ];

    const wrapper = new LoggingAgentWrapper(createMockAgent(codexEvents));

    const collected = [];
    for await (const event of wrapper.execute({ prompt: 'say hi' }, { ...meta, agentType: 'codex' })) {
      collected.push(event);
    }

    // All events pass through in order
    expect(collected).toEqual(codexEvents);

    // updateUsage called exactly once with Codex-shaped usage
    expect(agentCallLogger.updateUsage).toHaveBeenCalledTimes(1);
    expect(agentCallLogger.updateUsage).toHaveBeenCalledWith('mock-call-id', {
      inputTokens: 7,
      outputTokens: 3,
      thinkingTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    });

    // completeCall(success: true)
    expect(agentCallLogger.completeCall).toHaveBeenCalledWith('mock-call-id', {
      success: true,
    });
  });
});
