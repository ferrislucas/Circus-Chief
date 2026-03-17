import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the websocket module
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock the agentCallLogger
vi.mock('./agentCallLogger.js', () => ({
  agentCallLogger: {
    startCall: vi.fn().mockReturnValue('mock-call-id'),
    updateUsage: vi.fn(),
    completeCall: vi.fn(),
  },
}));

// Mock the SDK with intelligent mock
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(async function* (queryParams) {
    const prompt = queryParams?.prompt || '';
    const sessionStatusMatch = prompt.match(/Current session status:\s*(\w+)/i);
    const sessionStatus = sessionStatusMatch ? sessionStatusMatch[1] : 'running';

    let outcome = 'ongoing';
    if (sessionStatus === 'stopped') outcome = 'partial';
    if (sessionStatus === 'error') outcome = 'failed';
    if (sessionStatus === 'completed') outcome = 'completed';

    yield { type: 'system', subtype: 'init', session_id: 'test-session' };
    yield {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'StructuredOutput',
            input: {
              short_summary: 'Test session completed',
              full_summary: 'This is a test session summary',
              key_actions: ['Executed test'],
              files_modified: ['test.js'],
              outcome,
              pr_url: null,
              session_title: 'Mock: Test Session',
            },
          },
        ],
      },
    };
    yield { type: 'result', subtype: 'success' };
  }),
}));

// Mock VCR wrapper
vi.mock('../agents/vcr/VCRSummaryWrapper.js', () => ({
  createVCRQueryFn: vi.fn(),
}));

import { callClaude, SESSION_SUMMARY_SCHEMA } from './summaryClaudeClient.js';
import { agentCallLogger } from './agentCallLogger.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

describe('summaryClaudeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SESSION_SUMMARY_SCHEMA', () => {
    it('defines required fields', () => {
      expect(SESSION_SUMMARY_SCHEMA.type).toBe('object');
      expect(SESSION_SUMMARY_SCHEMA.required).toEqual(
        expect.arrayContaining(['short_summary', 'full_summary', 'key_actions', 'files_modified', 'outcome'])
      );
    });

    it('includes optional pr_url and session_title fields', () => {
      expect(SESSION_SUMMARY_SCHEMA.properties.pr_url).toBeDefined();
      expect(SESSION_SUMMARY_SCHEMA.properties.session_title).toBeDefined();
    });
  });

  describe('callClaude', () => {
    it('returns valid JSON string from structured output', async () => {
      const result = await callClaude('Test prompt', [], 'running');
      const parsed = JSON.parse(result);

      expect(parsed.short_summary).toBeDefined();
      expect(parsed.full_summary).toBeDefined();
      expect(parsed.key_actions).toBeDefined();
      expect(parsed.files_modified).toBeDefined();
      expect(parsed.outcome).toBeDefined();
    });

    it('passes system prompt to query when provided', async () => {
      await callClaude('Test prompt', [], 'running', { systemPrompt: 'System instructions' });

      expect(query).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            systemPrompt: 'System instructions',
          }),
        })
      );
    });

    it('does not include systemPrompt when not provided', async () => {
      await callClaude('Test prompt', [], 'running');

      const callArgs = query.mock.calls[0][0];
      expect(callArgs.options.systemPrompt).toBeUndefined();
    });

    it('uses default schema when no custom schema provided', async () => {
      await callClaude('Test prompt', [], 'running');

      const callArgs = query.mock.calls[0][0];
      expect(callArgs.options.outputFormat.schema).toEqual(SESSION_SUMMARY_SCHEMA);
    });

    it('uses custom schema when provided', async () => {
      const customSchema = {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      };

      await callClaude('Test prompt', [], 'running', { jsonSchema: customSchema });

      const callArgs = query.mock.calls[0][0];
      expect(callArgs.options.outputFormat.schema).toEqual(customSchema);
    });

    it('starts agent call logging when logMeta provided', async () => {
      await callClaude('Test prompt', [], 'running', {
        logMeta: {
          sessionId: 'sess-1',
          callType: 'generateSessionSummary',
        },
      });

      expect(agentCallLogger.startCall).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-1',
          agentType: 'summary',
          model: 'claude-haiku-4-5-20251001',
          callType: 'generateSessionSummary',
        })
      );
    });

    it('completes agent call on success', async () => {
      await callClaude('Test prompt', [], 'running', {
        logMeta: {
          sessionId: 'sess-1',
          callType: 'test',
        },
      });

      expect(agentCallLogger.completeCall).toHaveBeenCalledWith('mock-call-id', { success: true });
    });

    it('completes agent call with error on failure', async () => {
      query.mockImplementationOnce(async function* () {
        yield { type: 'result', subtype: 'error', error: 'Test error' };
      });

      await expect(
        callClaude('Test prompt', [], 'running', {
          logMeta: {
            sessionId: 'sess-1',
            callType: 'test',
          },
        })
      ).rejects.toThrow('Test error');

      expect(agentCallLogger.completeCall).toHaveBeenCalledWith('mock-call-id', {
        success: false,
        error: expect.any(Error),
      });
    });

    it('does not log when logMeta is null', async () => {
      await callClaude('Test prompt', [], 'running', null);

      expect(agentCallLogger.startCall).not.toHaveBeenCalled();
    });

    it('includes conversationId in logging when provided', async () => {
      await callClaude('Test prompt', [], 'running', {
        logMeta: {
          sessionId: 'sess-1',
          conversationId: 'conv-1',
          callType: 'test',
        },
      });

      expect(agentCallLogger.startCall).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: 'conv-1',
        })
      );
    });

    it('handles text-only response when no structured output', async () => {
      query.mockImplementationOnce(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: '{"short_summary": "text response"}' }],
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      const result = await callClaude('Test prompt', [], 'running');
      expect(result).toBe('{"short_summary": "text response"}');
    });

    it('prefers structured output over text response', async () => {
      query.mockImplementationOnce(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'text version' },
              {
                type: 'tool_use',
                name: 'StructuredOutput',
                input: { short_summary: 'structured version' },
              },
            ],
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      const result = await callClaude('Test prompt', [], 'running');
      const parsed = JSON.parse(result);
      expect(parsed.short_summary).toBe('structured version');
    });

    it('captures usage data from modelUsage for logging', async () => {
      query.mockImplementationOnce(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: { short_summary: 'test' } }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          modelUsage: {
            'claude-haiku': {
              inputTokens: 100,
              outputTokens: 50,
              cacheReadInputTokens: 10,
              cacheCreationInputTokens: 5,
            },
          },
        };
      });

      await callClaude('Test prompt', [], 'running', {
        logMeta: {
          sessionId: 'sess-1',
          callType: 'test',
        },
      });

      expect(agentCallLogger.updateUsage).toHaveBeenCalledWith('mock-call-id', {
        inputTokens: 100,
        outputTokens: 50,
        thinkingTokens: 0,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 5,
      });
    });

    it('captures usage data from event.usage fallback when no modelUsage', async () => {
      query.mockImplementationOnce(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: { short_summary: 'test' } }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: 200,
            output_tokens: 80,
            cache_read_input_tokens: 15,
            cache_creation_input_tokens: 8,
          },
        };
      });

      await callClaude('Test prompt', [], 'running', {
        logMeta: {
          sessionId: 'sess-1',
          callType: 'test',
        },
      });

      expect(agentCallLogger.updateUsage).toHaveBeenCalledWith('mock-call-id', {
        inputTokens: 200,
        outputTokens: 80,
        thinkingTokens: 0,
        cacheReadInputTokens: 15,
        cacheCreationInputTokens: 8,
      });
    });

    it('does not log usage when neither modelUsage nor usage are present', async () => {
      query.mockImplementationOnce(async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'StructuredOutput', input: { short_summary: 'test' } }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          // No modelUsage and no usage fields
        };
      });

      await callClaude('Test prompt', [], 'running', {
        logMeta: {
          sessionId: 'sess-1',
          callType: 'test',
        },
      });

      expect(agentCallLogger.updateUsage).not.toHaveBeenCalled();
    });

    it('ignores non-StructuredOutput tool_use blocks', async () => {
      query.mockImplementationOnce(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'SomeOtherTool', input: { foo: 'bar' } },
              { type: 'text', text: 'fallback text response' },
            ],
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      const result = await callClaude('Test prompt', [], 'running');
      // Should only capture text, since tool_use is not StructuredOutput
      expect(result).toBe('fallback text response');
    });

    it('handles empty content array gracefully', async () => {
      query.mockImplementationOnce(async function* () {
        yield {
          type: 'assistant',
          message: { content: [] },
        };
        yield { type: 'result', subtype: 'success' };
      });

      const result = await callClaude('Test prompt', [], 'running');
      expect(result).toBe('');
    });

    it('handles missing message.content gracefully', async () => {
      query.mockImplementationOnce(async function* () {
        yield {
          type: 'assistant',
          message: {},
        };
        yield { type: 'result', subtype: 'success' };
      });

      const result = await callClaude('Test prompt', [], 'running');
      expect(result).toBe('');
    });

    it('concatenates text from multiple text blocks', async () => {
      query.mockImplementationOnce(async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'part one ' },
              { type: 'text', text: 'part two' },
            ],
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      const result = await callClaude('Test prompt', [], 'running');
      expect(result).toBe('part one part two');
    });
  });
});
