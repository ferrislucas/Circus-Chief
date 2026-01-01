import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { projects, sessions, sessionTemplates } from '../database.js';

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
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { generateSummaryNow } from './summaryService.js';
import { checkAndTriggerNextTemplate } from './templateTriggerService.js';
import { getChanges } from './diffService.js';
import { updateTodos } from './todoStore.js';

describe('sessionManager broadcasts', () => {
  let tempDir;
  let projectId;
  let sessionId;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create temp directory for project
    tempDir = mkdtempSync(join(tmpdir(), 'session-manager-broadcast-test-'));

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

  describe('result error handling', () => {
    it('broadcasts error status to project subscribers when result error occurs', async () => {
      // Mock query to return an error result event
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'error', error: 'Something went wrong' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify broadcastToProject was called with SESSION_UPDATED for error status
      // (broadcastSessionStatus sends SESSION_UPDATED to project subscribers)
      const projectUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      expect(projectUpdatedCalls.length).toBeGreaterThan(0);

      // Find the error status broadcast
      const errorStatusCall = projectUpdatedCalls.find(
        (call) => call[2]?.session?.status === 'error'
      );
      expect(errorStatusCall).toBeDefined();
      expect(errorStatusCall[0]).toBe(projectId);
    });

    it('broadcasts SESSION_ERROR to session subscribers when result error occurs', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'error', error: 'Test error message' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify broadcastToSession was called with SESSION_ERROR
      const sessionErrorCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_ERROR
      );

      expect(sessionErrorCalls.length).toBe(1);
      expect(sessionErrorCalls[0][2].error).toBe('Test error message');
    });

    it('broadcasts error to session with correct error message', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'error', error: 'Database test error' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify the error was broadcast with the correct message
      const sessionErrorCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_ERROR
      );
      expect(sessionErrorCalls.length).toBe(1);
      expect(sessionErrorCalls[0][2].error).toBe('Database test error');
    });
  });

  describe('cost update handling', () => {
    it('broadcasts SESSION_UPDATED to project subscribers when costUsd is received', async () => {
      // Mock query to return a result with cost
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.0025 };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify broadcastToProject was called with SESSION_UPDATED containing cost
      const sessionUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      expect(sessionUpdatedCalls.length).toBeGreaterThan(0);

      // Find the cost update broadcast - check for costUsd > 0 since session might have default 0
      const costUpdateCall = sessionUpdatedCalls.find(
        (call) => call[2]?.session?.costUsd > 0
      );
      expect(costUpdateCall).toBeDefined();
      expect(costUpdateCall[0]).toBe(projectId);
      expect(costUpdateCall[2].session.costUsd).toBe(0.0025);
    });

    it('stores costUsd in database', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.0050 };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const session = sessions.getById(sessionId);
      expect(session.costUsd).toBe(0.0050);
    });

    it('includes projectId in cost update broadcast payload', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.001 };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const sessionUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      const costUpdateCall = sessionUpdatedCalls.find(
        (call) => call[2]?.session?.costUsd > 0
      );
      expect(costUpdateCall).toBeDefined();
      expect(costUpdateCall[2].projectId).toBe(projectId);
      expect(costUpdateCall[2].sessionId).toBe(sessionId);
    });
  });

  describe('status transitions', () => {
    it('broadcasts running status to project subscribers at start', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify running status broadcast via SESSION_UPDATED (broadcastSessionStatus sends SESSION_UPDATED to project)
      const projectUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      const runningStatusCall = projectUpdatedCalls.find(
        (call) => call[2]?.session?.status === 'running'
      );
      expect(runningStatusCall).toBeDefined();
    });

    it('broadcasts waiting status to project subscribers on success', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify waiting status broadcast via SESSION_UPDATED (broadcastSessionStatus sends SESSION_UPDATED to project)
      // Note: Sessions go to 'waiting' status (not 'completed') when they finish a turn
      const projectUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      const waitingStatusCall = projectUpdatedCalls.find(
        (call) => call[2]?.session?.status === 'waiting'
      );
      expect(waitingStatusCall).toBeDefined();
      expect(waitingStatusCall[0]).toBe(projectId);
    });
  });

  describe('usage tracking', () => {
    it('broadcasts partial usage update during assistant message', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Test response' }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 20,
              cache_creation_input_tokens: 10,
            },
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find SESSION_USAGE_UPDATE broadcasts
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE
      );

      expect(usageUpdateCalls.length).toBeGreaterThan(0);

      // Find the partial update (isFinal = false)
      const partialUpdate = usageUpdateCalls.find((call) => call[2]?.isFinal === false);
      expect(partialUpdate).toBeDefined();
      expect(partialUpdate[2].usage.inputTokens).toBe(100);
      expect(partialUpdate[2].usage.outputTokens).toBe(50);
    });

    it('broadcasts final usage update on result', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: 200,
            output_tokens: 100,
            cache_read_input_tokens: 50,
            cache_creation_input_tokens: 25,
          },
        };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find SESSION_USAGE_UPDATE broadcasts
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE
      );

      // Find the final update (isFinal = true)
      const finalUpdate = usageUpdateCalls.find((call) => call[2]?.isFinal === true);
      expect(finalUpdate).toBeDefined();
      expect(finalUpdate[2].usage.inputTokens).toBe(200);
      expect(finalUpdate[2].usage.outputTokens).toBe(100);
    });

    it('stores cumulative usage in database on result', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: 300,
            output_tokens: 150,
            cache_read_input_tokens: 75,
            cache_creation_input_tokens: 30,
          },
        };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const session = sessions.getById(sessionId);
      expect(session.inputTokens).toBe(300);
      expect(session.outputTokens).toBe(150);
      expect(session.cacheReadInputTokens).toBe(75);
      expect(session.cacheCreationInputTokens).toBe(30);
    });

    it('accumulates usage across multiple assistant messages', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'First response' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Second response' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find all partial usage updates
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE && call[2]?.isFinal === false
      );

      // Should have 2 partial updates
      expect(usageUpdateCalls.length).toBe(2);

      // First update should have first message's usage
      expect(usageUpdateCalls[0][2].usage.inputTokens).toBe(100);

      // Second update should have accumulated usage
      expect(usageUpdateCalls[1][2].usage.inputTokens).toBe(200);
      expect(usageUpdateCalls[1][2].usage.outputTokens).toBe(100);
    });

    it('uses modelUsage when available in result', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-sonnet-4-5-20250929' };
        yield {
          type: 'result',
          subtype: 'success',
          modelUsage: {
            'claude-sonnet-4-5-20250929': {
              inputTokens: 500,
              outputTokens: 250,
              cacheReadInputTokens: 100,
              cacheCreationInputTokens: 50,
              webSearchRequests: 2,
              contextWindow: 200000,
            },
          },
        };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const session = sessions.getById(sessionId);
      expect(session.inputTokens).toBe(500);
      expect(session.outputTokens).toBe(250);
      expect(session.cacheReadInputTokens).toBe(100);
      expect(session.cacheCreationInputTokens).toBe(50);
      expect(session.webSearchRequests).toBe(2);
      expect(session.contextWindow).toBe(200000);
    });

    it('broadcasts turnUsage in final update', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: 400,
            output_tokens: 200,
          },
        };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find the final update
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE
      );

      const finalUpdate = usageUpdateCalls.find((call) => call[2]?.isFinal === true);
      expect(finalUpdate).toBeDefined();
      expect(finalUpdate[2].turnUsage).toBeDefined();
      expect(finalUpdate[2].turnUsage.inputTokens).toBe(400);
      expect(finalUpdate[2].turnUsage.outputTokens).toBe(200);
    });

    it('broadcasts session update with usage to project', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: 600,
            output_tokens: 300,
          },
        };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find SESSION_UPDATED broadcasts to project
      const projectUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      // Find the one with usage info
      const usageUpdate = projectUpdatedCalls.find(
        (call) => call[2]?.session?.inputTokens === 600
      );

      expect(usageUpdate).toBeDefined();
      expect(usageUpdate[0]).toBe(projectId);
      expect(usageUpdate[2].session.inputTokens).toBe(600);
      expect(usageUpdate[2].session.outputTokens).toBe(300);
    });

    it('broadcasts usage from message_start stream event', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: {
              usage: {
                input_tokens: 150,
                output_tokens: 1,
                cache_read_input_tokens: 50,
                cache_creation_input_tokens: 0,
              },
            },
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find SESSION_USAGE_UPDATE broadcasts
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE
      );

      // Should have at least one partial update from message_start
      const partialUpdate = usageUpdateCalls.find((call) => call[2]?.isFinal === false);
      expect(partialUpdate).toBeDefined();
      expect(partialUpdate[2].usage.inputTokens).toBe(150);
      expect(partialUpdate[2].usage.cacheReadInputTokens).toBe(50);
    });

    it('broadcasts usage from message_delta stream event', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'stream_event',
          event: {
            type: 'message_delta',
            usage: {
              output_tokens: 75,
            },
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find SESSION_USAGE_UPDATE broadcasts
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE
      );

      // Should have at least one partial update from message_delta
      const partialUpdate = usageUpdateCalls.find((call) => call[2]?.isFinal === false);
      expect(partialUpdate).toBeDefined();
      expect(partialUpdate[2].usage.outputTokens).toBe(75);
    });

    it('accumulates usage from message_start and message_delta events', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        // message_start with initial input tokens
        yield {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: {
              usage: {
                input_tokens: 200,
                output_tokens: 1,
              },
            },
          },
        };
        // message_delta with streaming output tokens
        yield {
          type: 'stream_event',
          event: {
            type: 'message_delta',
            usage: {
              output_tokens: 50,
            },
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find all partial usage updates
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE && call[2]?.isFinal === false
      );

      // Should have 2 partial updates (message_start + message_delta)
      expect(usageUpdateCalls.length).toBe(2);

      // First update from message_start
      expect(usageUpdateCalls[0][2].usage.inputTokens).toBe(200);
      expect(usageUpdateCalls[0][2].usage.outputTokens).toBe(1);

      // Second update from message_delta (accumulated)
      expect(usageUpdateCalls[1][2].usage.inputTokens).toBe(200);
      expect(usageUpdateCalls[1][2].usage.outputTokens).toBe(51); // 1 + 50
    });

    it('handles message_start without usage gracefully', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: {}, // No usage field
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      // Should not throw
      await expect(runSession(sessionId, 'Test prompt', tempDir)).resolves.not.toThrow();

      // Should not broadcast any partial usage updates
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE && call[2]?.isFinal === false
      );
      expect(usageUpdateCalls.length).toBe(0);
    });

    it('handles message_delta without usage gracefully', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'stream_event',
          event: {
            type: 'message_delta',
            // No usage field
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      // Should not throw
      await expect(runSession(sessionId, 'Test prompt', tempDir)).resolves.not.toThrow();

      // Should not broadcast any partial usage updates
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE && call[2]?.isFinal === false
      );
      expect(usageUpdateCalls.length).toBe(0);
    });

    it('includes conversationId in message_start usage updates', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: {
              usage: { input_tokens: 100, output_tokens: 1 },
            },
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE && call[2]?.isFinal === false
      );

      expect(usageUpdateCalls.length).toBe(1);
      expect(usageUpdateCalls[0][2]).toHaveProperty('conversationId');
      expect(usageUpdateCalls[0][2].conversationId).not.toBeNull();
    });

    it('accumulates multiple message_delta events correctly', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: { usage: { input_tokens: 100, output_tokens: 1 } },
          },
        };
        // Multiple message_delta events simulating streaming
        yield {
          type: 'stream_event',
          event: { type: 'message_delta', usage: { output_tokens: 10 } },
        };
        yield {
          type: 'stream_event',
          event: { type: 'message_delta', usage: { output_tokens: 25 } },
        };
        yield {
          type: 'stream_event',
          event: { type: 'message_delta', usage: { output_tokens: 50 } },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE && call[2]?.isFinal === false
      );

      // Should have 4 partial updates (1 message_start + 3 message_delta)
      expect(usageUpdateCalls.length).toBe(4);

      // Verify accumulation: 1 + 10 + 25 + 50 = 86
      expect(usageUpdateCalls[0][2].usage.outputTokens).toBe(1);
      expect(usageUpdateCalls[1][2].usage.outputTokens).toBe(11);  // 1 + 10
      expect(usageUpdateCalls[2][2].usage.outputTokens).toBe(36);  // 11 + 25
      expect(usageUpdateCalls[3][2].usage.outputTokens).toBe(86);  // 36 + 50
    });

    it('handles realistic full streaming flow with text content', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        // message_start - initial tokens
        yield {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: { usage: { input_tokens: 500, output_tokens: 1 } },
          },
        };
        // content_block_delta - text streaming (no usage)
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello ' },
          },
        };
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'world!' },
          },
        };
        // message_delta - final output tokens
        yield {
          type: 'stream_event',
          event: { type: 'message_delta', usage: { output_tokens: 15 } },
        };
        // assistant message with complete content
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hello world!' }] },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify partial text was streamed
      const partialCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_PARTIAL
      );
      expect(partialCalls.length).toBe(2);
      expect(partialCalls[0][2].text).toBe('Hello ');
      expect(partialCalls[1][2].text).toBe('world!');

      // Verify usage was streamed
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE && call[2]?.isFinal === false
      );
      expect(usageUpdateCalls.length).toBe(2); // message_start + message_delta

      // First from message_start
      expect(usageUpdateCalls[0][2].usage.inputTokens).toBe(500);
      expect(usageUpdateCalls[0][2].usage.outputTokens).toBe(1);

      // Second from message_delta (accumulated)
      expect(usageUpdateCalls[1][2].usage.inputTokens).toBe(500);
      expect(usageUpdateCalls[1][2].usage.outputTokens).toBe(16); // 1 + 15
    });

    it('combines stream event usage with assistant message usage', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        // Initial stream events
        yield {
          type: 'stream_event',
          event: {
            type: 'message_start',
            message: { usage: { input_tokens: 100, output_tokens: 1 } },
          },
        };
        yield {
          type: 'stream_event',
          event: { type: 'message_delta', usage: { output_tokens: 20 } },
        };
        // Assistant message with additional usage (e.g., tool use)
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Response 1' }],
            usage: { input_tokens: 50, output_tokens: 30 },
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE && call[2]?.isFinal === false
      );

      // Should have 3 partial updates: message_start, message_delta, assistant
      expect(usageUpdateCalls.length).toBe(3);

      // Final accumulated values: 100+50=150 input, 1+20+30=51 output
      const lastUpdate = usageUpdateCalls[usageUpdateCalls.length - 1];
      expect(lastUpdate[2].usage.inputTokens).toBe(150);
      expect(lastUpdate[2].usage.outputTokens).toBe(51);
    });
  });

  // Issue #175 - Conversation-level token tracking
  describe('conversation-level usage tracking', () => {
    it('includes conversationId in usage updates', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Test response' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find SESSION_USAGE_UPDATE broadcasts
      const usageUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE
      );

      expect(usageUpdateCalls.length).toBeGreaterThan(0);

      // All usage updates should include conversationId
      usageUpdateCalls.forEach((call) => {
        expect(call[2]).toHaveProperty('conversationId');
      });
    });

    it('stores usage in conversation on final result', async () => {
      // Import conversations repo to verify
      const { conversations } = await import('../database.js');

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'result',
          subtype: 'success',
          usage: {
            input_tokens: 500,
            output_tokens: 250,
            cache_read_input_tokens: 100,
            cache_creation_input_tokens: 50,
          },
        };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Get the active conversation for this session
      const activeConversation = conversations.getActiveBySessionId(sessionId);
      expect(activeConversation).not.toBeNull();
      expect(activeConversation.inputTokens).toBe(500);
      expect(activeConversation.outputTokens).toBe(250);
      expect(activeConversation.cacheReadInputTokens).toBe(100);
      expect(activeConversation.cacheCreationInputTokens).toBe(50);
    });

    it('stores model in conversation when modelUsage is available', async () => {
      const { conversations } = await import('../database.js');

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-sonnet-4-20250514' };
        yield {
          type: 'result',
          subtype: 'success',
          modelUsage: {
            'claude-sonnet-4-20250514': {
              inputTokens: 600,
              outputTokens: 300,
              cacheReadInputTokens: 120,
              cacheCreationInputTokens: 60,
              webSearchRequests: 1,
              contextWindow: 200000,
            },
          },
        };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const activeConversation = conversations.getActiveBySessionId(sessionId);
      expect(activeConversation).not.toBeNull();
      expect(activeConversation.model).toBe('claude-sonnet-4-20250514');
      expect(activeConversation.contextWindow).toBe(200000);
      expect(activeConversation.webSearchRequests).toBe(1);
    });

    it('broadcasts CONVERSATION_UPDATED with usage after final result', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 400, output_tokens: 200 },
        };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find CONVERSATION_UPDATED broadcasts
      const convUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CONVERSATION_UPDATED
      );

      expect(convUpdateCalls.length).toBeGreaterThan(0);

      // Should include conversation with usage data
      const lastUpdate = convUpdateCalls[convUpdateCalls.length - 1];
      expect(lastUpdate[2].conversation).toBeDefined();
      expect(lastUpdate[2].conversation.inputTokens).toBe(400);
      expect(lastUpdate[2].conversation.outputTokens).toBe(200);
    });

    it('usage is tracked per-conversation, not per-session', async () => {
      const { conversations, messages } = await import('../database.js');

      // Create first conversation and run session
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      });

      await runSession(sessionId, 'First prompt', tempDir);

      const firstConv = conversations.getActiveBySessionId(sessionId);
      expect(firstConv.inputTokens).toBe(100);
      expect(firstConv.outputTokens).toBe(50);

      // Create a new conversation
      const newConv = conversations.create(sessionId, 'Second Conversation');

      // Update session with new claude session ID for continueSession
      sessions.update(sessionId, { claudeSessionId: 'claude-session-456' });

      // Run second turn in new conversation
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-456', model: 'claude-3' };
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 200, output_tokens: 100 },
        };
      });

      const { continueSession } = await import('./sessionManager.js');
      await continueSession(sessionId, 'Second prompt', tempDir);

      // Verify each conversation has its own usage
      const conv1 = conversations.getById(firstConv.id);
      const conv2 = conversations.getById(newConv.id);

      expect(conv1.inputTokens).toBe(100);
      expect(conv1.outputTokens).toBe(50);
      expect(conv2.inputTokens).toBe(200);
      expect(conv2.outputTokens).toBe(100);
    });
  });

  describe('template triggering (handleTemplateTriggerIfNeeded)', () => {
    let templateId;

    beforeEach(() => {
      // Create a real template for foreign key constraint
      const template = sessionTemplates.create({
        name: 'Test Template',
        prompt: 'Test prompt',
        projectId: projectId,
      });
      templateId = template.id;
    });

    afterEach(() => {
      // Clean up template
      if (templateId) {
        try {
          sessionTemplates.delete(templateId);
        } catch {
          // Template may already be deleted
        }
      }
    });

    it('triggers template after successful turn when nextTemplateId is set', async () => {
      // Set up session with nextTemplateId
      sessions.update(sessionId, { nextTemplateId: templateId });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify summary was generated first
      expect(generateSummaryNow).toHaveBeenCalledWith(sessionId);

      // Verify template trigger was called
      expect(checkAndTriggerNextTemplate).toHaveBeenCalledWith(sessionId);
    });

    it('does not trigger template when session has no nextTemplateId', async () => {
      // Ensure no nextTemplateId is set
      sessions.update(sessionId, { nextTemplateId: null });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify template trigger was NOT called
      expect(checkAndTriggerNextTemplate).not.toHaveBeenCalled();
    });

    it('clears nextTemplateId after triggering template', async () => {
      // Set up session with nextTemplateId
      sessions.update(sessionId, { nextTemplateId: templateId });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify nextTemplateId was cleared
      const session = sessions.getById(sessionId);
      expect(session.nextTemplateId).toBeNull();
    });

    it('broadcasts SESSION_UPDATED after clearing nextTemplateId', async () => {
      sessions.update(sessionId, { nextTemplateId: templateId });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Find the broadcast with nextTemplateId cleared
      const projectUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      const clearedTemplateCall = projectUpdatedCalls.find(
        (call) => call[2]?.session?.nextTemplateId === null
      );
      expect(clearedTemplateCall).toBeDefined();
    });

    it('still triggers template after error result (session goes to waiting after loop)', async () => {
      // Note: The current implementation triggers templates even after error results
      // because the error is handled inside the event loop, but the template trigger
      // happens after the loop completes (when status becomes 'waiting')
      sessions.update(sessionId, { nextTemplateId: templateId });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'error', error: 'Something went wrong' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Template IS triggered even on error because session transitions to 'waiting'
      expect(checkAndTriggerNextTemplate).toHaveBeenCalledWith(sessionId);
    });
  });

  describe('changes update broadcasting (broadcastChangesUpdate)', () => {
    it('broadcasts CHANGES_UPDATE message when turn completes successfully', async () => {
      getChanges.mockResolvedValue({
        staged: null,
        unstaged: null,
        untracked: null,
      });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify CHANGES_UPDATE was broadcast to session
      const changesUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CHANGES_UPDATE
      );

      expect(changesUpdateCalls.length).toBeGreaterThan(0);
      expect(changesUpdateCalls[0][0]).toBe(sessionId);
    });

    it('includes sessionId, hasChanges, and changeCount in CHANGES_UPDATE broadcast', async () => {
      getChanges.mockResolvedValue({
        staged: 'diff --git a/file1.txt b/file1.txt\n',
        unstaged: null,
        untracked: null,
      });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const changesUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CHANGES_UPDATE
      );

      expect(changesUpdateCalls.length).toBeGreaterThan(0);
      const payload = changesUpdateCalls[0][2];
      expect(payload).toHaveProperty('sessionId');
      expect(payload).toHaveProperty('hasChanges');
      expect(payload).toHaveProperty('changeCount');
      expect(payload.sessionId).toBe(sessionId);
    });

    it('detects hasChanges as true when staged files exist', async () => {
      getChanges.mockResolvedValue({
        staged: 'diff --git a/staged.txt b/staged.txt\n',
        unstaged: null,
        untracked: null,
      });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const changesUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CHANGES_UPDATE
      );

      const payload = changesUpdateCalls[0][2];
      expect(payload.hasChanges).toBe(true);
      expect(payload.changeCount).toBeGreaterThan(0);
    });

    it('detects hasChanges as true when unstaged files exist', async () => {
      getChanges.mockResolvedValue({
        staged: null,
        unstaged: 'diff --git a/unstaged.txt b/unstaged.txt\n',
        untracked: null,
      });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const changesUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CHANGES_UPDATE
      );

      const payload = changesUpdateCalls[0][2];
      expect(payload.hasChanges).toBe(true);
    });

    it('detects hasChanges as true when untracked files exist', async () => {
      getChanges.mockResolvedValue({
        staged: null,
        unstaged: null,
        untracked: 'diff --git a/untracked.txt b/untracked.txt\n',
      });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const changesUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CHANGES_UPDATE
      );

      const payload = changesUpdateCalls[0][2];
      expect(payload.hasChanges).toBe(true);
    });

    it('sets hasChanges to false when no changes exist', async () => {
      getChanges.mockResolvedValue({
        staged: null,
        unstaged: null,
        untracked: null,
      });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const changesUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CHANGES_UPDATE
      );

      const payload = changesUpdateCalls[0][2];
      expect(payload.hasChanges).toBe(false);
      expect(payload.changeCount).toBe(0);
    });

    it('correctly counts multiple staged files', async () => {
      getChanges.mockResolvedValue({
        staged: 'diff --git a/file1.txt b/file1.txt\ndiff --git a/file2.txt b/file2.txt\ndiff --git a/file3.txt b/file3.txt\n',
        unstaged: null,
        untracked: null,
      });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const changesUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CHANGES_UPDATE
      );

      const payload = changesUpdateCalls[0][2];
      expect(payload.changeCount).toBe(3);
    });

    it('sums file counts across staged, unstaged, and untracked', async () => {
      getChanges.mockResolvedValue({
        staged: 'diff --git a/staged1.txt b/staged1.txt\n',
        unstaged: 'diff --git a/unstaged1.txt b/unstaged1.txt\ndiff --git a/unstaged2.txt b/unstaged2.txt\n',
        untracked: 'diff --git a/untracked1.txt b/untracked1.txt\n',
      });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      const changesUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CHANGES_UPDATE
      );

      const payload = changesUpdateCalls[0][2];
      // 1 staged + 2 unstaged + 1 untracked = 4
      expect(payload.changeCount).toBe(4);
      expect(payload.hasChanges).toBe(true);
    });

    it('silently handles errors in non-git directories', async () => {
      getChanges.mockRejectedValue(new Error('Not a git repository'));

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      // Should not throw
      await expect(runSession(sessionId, 'Test prompt', tempDir)).resolves.not.toThrow();
    });

    it('does not prevent session from completing when changes broadcast fails', async () => {
      getChanges.mockRejectedValue(new Error('Permission denied'));

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Session should still go to waiting status
      const session = sessions.getById(sessionId);
      expect(session.status).toBe('waiting');
    });

    it('calls diffService with correct working directory', async () => {
      getChanges.mockResolvedValue({
        staged: null,
        unstaged: null,
        untracked: null,
      });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify diffService was called with correct working directory
      expect(getChanges).toHaveBeenCalledWith(tempDir);
    });

    it('broadcasts CHANGES_UPDATE in continueSession after turn completes', async () => {
      const { continueSession } = await import('./sessionManager.js');

      // Update claude session ID
      sessions.update(sessionId, { claudeSessionId: 'claude-session-456' });

      getChanges.mockResolvedValue({
        staged: 'diff --git a/file.txt b/file.txt\n',
        unstaged: null,
        untracked: null,
      });

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-456', model: 'claude-3' };
        yield { type: 'result', subtype: 'success' };
      });

      await continueSession(sessionId, 'Continue prompt', tempDir);

      // Verify CHANGES_UPDATE was broadcast
      const changesUpdateCalls = broadcastToSession.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.CHANGES_UPDATE
      );

      expect(changesUpdateCalls.length).toBeGreaterThan(0);
      expect(changesUpdateCalls[0][0]).toBe(sessionId);
    });
  });

  describe('TodoWrite tool detection', () => {
    it('detects TodoWrite when message has ONLY tool_use content (no text)', async () => {
      // This test verifies the bug fix for Issue: TodoWrite detection was inside
      // the `if (textContent)` block, so tool-only messages were never processed.
      //
      // Scenario: Claude calls TodoWrite without any accompanying text content.
      // This is a common pattern where Claude just updates the todo list.
      const testTodos = [
        { content: 'Research existing code', status: 'completed' },
        { content: 'Implement feature', status: 'in_progress' },
        { content: 'Write tests', status: 'pending' },
      ];

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        // Assistant message with ONLY tool_use, no text content
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'TodoWrite',
                input: { todos: testTodos },
              },
            ],
            // No text blocks at all - this is the bug scenario
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify updateTodos was called with the correct arguments
      expect(updateTodos).toHaveBeenCalledWith(sessionId, testTodos);
    });

    it('detects TodoWrite when message has both text AND tool_use content', async () => {
      // This case should already work - verifying it still works after the fix
      const testTodos = [
        { content: 'First task', status: 'pending' },
        { content: 'Second task', status: 'in_progress' },
      ];

      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Let me update the todo list for you.' },
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'TodoWrite',
                input: { todos: testTodos },
              },
            ],
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify updateTodos was called
      expect(updateTodos).toHaveBeenCalledWith(sessionId, testTodos);
    });

    it('does not call updateTodos when no TodoWrite tool is used', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Just a regular response.' },
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Read',
                input: { file_path: '/some/file.txt' },
              },
            ],
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Verify updateTodos was NOT called
      expect(updateTodos).not.toHaveBeenCalled();
    });

    it('handles TodoWrite with empty todos array', async () => {
      query.mockImplementation(async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'claude-session-123', model: 'claude-3' };
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'TodoWrite',
                input: { todos: [] },
              },
            ],
          },
        };
        yield { type: 'result', subtype: 'success' };
      });

      await runSession(sessionId, 'Test prompt', tempDir);

      // Empty array should still trigger updateTodos
      expect(updateTodos).toHaveBeenCalledWith(sessionId, []);
    });
  });
});
