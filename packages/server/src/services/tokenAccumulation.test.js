/**
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { projects, sessions } from '../database.js';

// Mock the Claude SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summaryService to avoid side effects
vi.mock('./summaryService.js', () => ({
  onSessionActivity: vi.fn(),
  onSessionComplete: vi.fn(),
  extractPrUrlIfNeeded: vi.fn(),
  generateSummaryNow: vi.fn().mockResolvedValue({ id: 'summary-1' }),
}));

// Mock templateTriggerService
vi.mock('./templateTriggerService.js', () => ({
  checkAndTriggerNextTemplate: vi.fn().mockResolvedValue(undefined),
}));

// Mock diffService
vi.mock('./diffService.js', () => ({
  getChanges: vi.fn().mockResolvedValue({
    staged: null,
    unstaged: null,
    untracked: null,
  }),
}));

// Mock todoStore
vi.mock('./todoStore.js', () => ({
  updateTodos: vi.fn(),
  clearTodos: vi.fn(),
}));

// Import after mocks are set up
import { runSession } from './sessionManager.js';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

describe('Token Accumulation - Multi-Message Turns', () => {
  let tempDir;
  let projectId;
  let sessionId;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create temp directory for project
    tempDir = mkdtempSync(join(tmpdir(), 'token-accumulation-test-'));

    // Initialize as git repo
    execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
    execSync('touch test.txt && git add . && git commit -m "init"', { cwd: tempDir, stdio: 'ignore' });

    // Create project and session
    const project = projects.create('Test Project', tempDir);
    projectId = project.id;

    const session = sessions.create(projectId, 'Test Session', 'Test prompt', 'standard');
    sessionId = session.id;
  });

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('accumulates output tokens across multiple messages in a turn (tool use scenario)', async () => {
    // This simulates:
    // 1. Claude starts response (message_start with input tokens)
    // 2. Claude generates output (message_delta with cumulative output tokens)
    // 3. Claude calls a tool (ends message)
    // 4. Tool result returns, Claude starts NEW message (message_start)
    // 5. Claude generates more output (message_delta)
    // 6. Turn ends
    //
    // The bug was: output tokens would "cycle" - dropping when the second message started
    // because lastMessageOutput was being replaced instead of accumulated

    query.mockImplementation(async function* () {
      // System init
      yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };

      // FIRST MESSAGE: Claude starts responding
      yield {
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 1000,
              output_tokens: 1,
              cache_read_input_tokens: 500,
            },
          },
        },
      };

      // Claude generates 100 output tokens in first message
      yield {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          usage: { output_tokens: 100 },
        },
      };

      // Claude calls a tool
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Let me check that file.' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/test.txt' } },
          ],
        },
      };

      // Tool result
      yield {
        type: 'tool_result',
        tool_name: 'Read',
        content: 'file contents here',
      };

      // SECOND MESSAGE: Claude continues after tool result
      yield {
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 1500,  // Input grows with tool result context
              output_tokens: 1,
              cache_read_input_tokens: 500,
            },
          },
        },
      };

      // Claude generates 200 more output tokens in second message
      yield {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          usage: { output_tokens: 200 },
        },
      };

      // Final assistant message
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'The file contains...' }],
        },
      };

      // Turn ends - include final usage data
      yield {
        type: 'result',
        subtype: 'success',
        usage: {
          input_tokens: 1500,
          output_tokens: 300,  // Should be 100 + 200 from both messages
          cache_read_input_tokens: 500,
        },
      };
    });

    await runSession(sessionId, 'Test prompt', tempDir);

    // Find all SESSION_USAGE_UPDATE broadcasts
    const usageUpdateCalls = broadcastToSession.mock.calls.filter(
      (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE
    );

    // Extract output tokens from each update
    const outputTokenHistory = usageUpdateCalls.map(call => call[2].usage.outputTokens);

    // Count non-final (streaming) updates
    const streamingUpdates = usageUpdateCalls.filter(call => !call[2].isFinal);

    // CRITICAL TEST: Verify streaming values specifically
    // This tests the BUG: token count cycling during streaming
    // We should see 4 streaming updates (2 message_start + 2 message_delta)
    expect(streamingUpdates.length).toBe(4);

    // Streaming values should be monotonically increasing (never decrease)
    // Correct: [0, 100, 100, 300] - accumulated across messages
    // Bug: [0, 100, 0, 200] - would cycle back to 0 on second message_start
    const streamingOutputValues = streamingUpdates.map(call => call[2].usage.outputTokens);

    // Verify second message_start DOES NOT reset to 0
    // It should retain at least the output from the first message (100)
    expect(streamingOutputValues[2]).toBeGreaterThanOrEqual(100);

    // Verify final streaming value includes BOTH messages
    expect(streamingOutputValues[3]).toBeGreaterThanOrEqual(300);

    // KEY ASSERTION: Output tokens should NEVER decrease during a turn
    // This is THE bug we're testing for
    for (let i = 1; i < outputTokenHistory.length; i++) {
      const prev = outputTokenHistory[i - 1];
      const curr = outputTokenHistory[i];
      expect(curr).toBeGreaterThanOrEqual(prev,
        `Output tokens decreased from ${prev} to ${curr} at index ${i}`);
    }

    // Find the final update (isFinal: true)
    const finalUpdate = usageUpdateCalls.find(call => call[2].isFinal === true);
    expect(finalUpdate).toBeDefined();

    // Final output should be ~300 (100 from first message + 200 from second message)
    // NOT 200 (which would indicate the first message was lost)
    const finalOutput = finalUpdate[2].usage.outputTokens;
    expect(finalOutput).toBeGreaterThanOrEqual(300);

    // Input tokens should be the MAX seen (1500), not accumulated
    expect(finalUpdate[2].usage.inputTokens).toBe(1500);
  });

  it('handles three messages in a turn (multiple tool calls)', async () => {
    query.mockImplementation(async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };

      // Message 1: 50 output tokens
      yield {
        type: 'stream_event',
        event: { type: 'message_start', message: { usage: { input_tokens: 100, output_tokens: 1 } } },
      };
      yield {
        type: 'stream_event',
        event: { type: 'message_delta', usage: { output_tokens: 50 } },
      };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
      };
      yield { type: 'tool_result', tool_name: 'Bash', content: 'result 1' };

      // Message 2: 75 output tokens
      yield {
        type: 'stream_event',
        event: { type: 'message_start', message: { usage: { input_tokens: 200, output_tokens: 1 } } },
      };
      yield {
        type: 'stream_event',
        event: { type: 'message_delta', usage: { output_tokens: 75 } },
      };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: {} }] },
      };
      yield { type: 'tool_result', tool_name: 'Read', content: 'result 2' };

      // Message 3: 100 output tokens
      yield {
        type: 'stream_event',
        event: { type: 'message_start', message: { usage: { input_tokens: 300, output_tokens: 1 } } },
      };
      yield {
        type: 'stream_event',
        event: { type: 'message_delta', usage: { output_tokens: 100 } },
      };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Done' }] },
      };

      // Turn ends - include final usage data (50 + 75 + 100 = 225)
      yield {
        type: 'result',
        subtype: 'success',
        usage: {
          input_tokens: 300,
          output_tokens: 225,  // Should be 50 + 75 + 100 from all messages
        },
      };
    });

    await runSession(sessionId, 'Test', tempDir);

    const usageUpdateCalls = broadcastToSession.mock.calls.filter(
      call => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE
    );

    const outputTokenHistory = usageUpdateCalls.map(call => call[2].usage.outputTokens);
    console.log('Three-message output history:', outputTokenHistory);

    // Verify monotonic increase
    for (let i = 1; i < outputTokenHistory.length; i++) {
      expect(outputTokenHistory[i]).toBeGreaterThanOrEqual(outputTokenHistory[i - 1],
        `Tokens decreased at index ${i}: ${outputTokenHistory[i-1]} -> ${outputTokenHistory[i]}`);
    }

    // Final should be 50 + 75 + 100 = 225
    const finalUpdate = usageUpdateCalls.find(call => call[2].isFinal === true);
    expect(finalUpdate[2].usage.outputTokens).toBeGreaterThanOrEqual(225);
  });
});
