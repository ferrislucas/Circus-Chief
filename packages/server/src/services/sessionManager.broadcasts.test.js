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
