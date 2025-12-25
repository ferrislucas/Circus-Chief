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

// Import after mocks are set up
import { runSession } from './sessionManager.js';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { generateSummaryNow } from './summaryService.js';
import { checkAndTriggerNextTemplate } from './templateTriggerService.js';

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
});
