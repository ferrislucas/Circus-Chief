import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { projects, sessions, sessionTemplates, sessionSummaries } from '../database.js';

// Mock websocket and sessionManager before importing the service
vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

vi.mock('./sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks are set up
import { renderTemplatePrompt, checkAndTriggerNextTemplate, getRootSession } from './templateTriggerService.js';
import { broadcastToProject } from '../websocket.js';
import { runSession } from './sessionManager.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

describe('templateTriggerService', () => {
  describe('renderTemplatePrompt', () => {
    it('renders template with parentSession.summary', async () => {
      const templatePrompt = 'Review the work: {{parentSession.summary}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test Session',
        status: 'stopped',
      };
      const parentSummary = {
        fullSummary: 'Built a new feature for user authentication.',
        shortSummary: 'Built auth feature',
      };
      const rootSession = parentSession; // Same as parent for single-level
      const rootSummary = parentSummary;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, parentSummary, rootSession, rootSummary);

      expect(rendered).toBe('Review the work: Built a new feature for user authentication.');
    });

    it('renders template with parentSession.id', async () => {
      const templatePrompt = 'Parent session ID: {{parentSession.id}}';
      const parentSession = {
        id: 'abc-123-def',
        name: 'Test',
        status: 'stopped',
      };
      const rootSession = parentSession;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('Parent session ID: abc-123-def');
    });

    it('renders template with parentSession.name', async () => {
      const templatePrompt = 'Following up on: {{parentSession.name}}';
      const parentSession = {
        id: 'session-123',
        name: 'Build login page',
        status: 'stopped',
      };
      const rootSession = parentSession;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('Following up on: Build login page');
    });

    it('renders template with parentSession.status', async () => {
      const templatePrompt = 'Session ended with status: {{parentSession.status}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'error',
      };
      const rootSession = parentSession;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('Session ended with status: error');
    });

    it('uses shortSummary when fullSummary is not available', async () => {
      const templatePrompt = 'Summary: {{parentSession.summary}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'stopped',
      };
      const parentSummary = {
        shortSummary: 'Short summary only',
        fullSummary: null,
      };
      const rootSession = parentSession;
      const rootSummary = parentSummary;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, parentSummary, rootSession, rootSummary);

      expect(rendered).toBe('Summary: Short summary only');
    });

    it('uses fallback when no summary is available', async () => {
      const templatePrompt = 'Summary: {{parentSession.summary}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'stopped',
      };
      const rootSession = parentSession;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('Summary: No summary available');
    });

    it('renders template with keyActions array', async () => {
      const templatePrompt = '{% for action in parentSession.keyActions %}{{action}}, {% endfor %}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'stopped',
      };
      const parentSummary = {
        keyActions: ['Added login form', 'Updated API', 'Fixed bug'],
      };
      const rootSession = parentSession;
      const rootSummary = parentSummary;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, parentSummary, rootSession, rootSummary);

      expect(rendered).toBe('Added login form, Updated API, Fixed bug, ');
    });

    it('renders template with filesModified array', async () => {
      const templatePrompt = 'Modified: {% for file in parentSession.filesModified %}{{file}}{% unless forloop.last %}, {% endunless %}{% endfor %}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'stopped',
      };
      const parentSummary = {
        filesModified: ['src/login.js', 'src/api.js'],
      };
      const rootSession = parentSession;
      const rootSummary = parentSummary;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, parentSummary, rootSession, rootSummary);

      expect(rendered).toBe('Modified: src/login.js, src/api.js');
    });

    it('renders template with outcome', async () => {
      const templatePrompt = 'Outcome: {{parentSession.outcome}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'stopped',
      };
      const parentSummary = {
        outcome: 'partial',
      };
      const rootSession = parentSession;
      const rootSummary = parentSummary;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, parentSummary, rootSession, rootSummary);

      expect(rendered).toBe('Outcome: partial');
    });

    it('uses session status as fallback outcome', async () => {
      const templatePrompt = 'Outcome: {{parentSession.outcome}}';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'error',
      };
      const rootSession = parentSession;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('Outcome: error');
    });

    it('renders complex template with multiple variables', async () => {
      const templatePrompt = `
## Review Session: {{parentSession.name}}

Status: {{parentSession.status}}
Summary: {{parentSession.summary}}

Please review the above work.
      `.trim();

      const parentSession = {
        id: 'session-123',
        name: 'Build feature X',
        status: 'stopped',
      };
      const parentSummary = {
        fullSummary: 'Implemented feature X with tests.',
      };
      const rootSession = parentSession;
      const rootSummary = parentSummary;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, parentSummary, rootSession, rootSummary);

      expect(rendered).toContain('Review Session: Build feature X');
      expect(rendered).toContain('Status: stopped');
      expect(rendered).toContain('Summary: Implemented feature X with tests.');
    });

    it('handles template with no variables', async () => {
      const templatePrompt = 'This is a static prompt with no variables.';
      const parentSession = {
        id: 'session-123',
        name: 'Test',
        status: 'stopped',
      };
      const rootSession = parentSession;

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('This is a static prompt with no variables.');
    });

    it('renders template with rootSession.id', async () => {
      const templatePrompt = 'Root session ID: {{rootSession.id}}';
      const parentSession = {
        id: 'parent-456',
        name: 'Parent',
        status: 'stopped',
      };
      const rootSession = {
        id: 'root-123',
        name: 'Root',
        status: 'stopped',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('Root session ID: root-123');
    });

    it('renders template with rootSession.name', async () => {
      const templatePrompt = 'Root session name: {{rootSession.name}}';
      const parentSession = {
        id: 'parent-456',
        name: 'Parent Session',
        status: 'stopped',
      };
      const rootSession = {
        id: 'root-123',
        name: 'Original Session',
        status: 'stopped',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('Root session name: Original Session');
    });

    it('renders template with rootSession.summary', async () => {
      const templatePrompt = 'Root summary: {{rootSession.summary}}';
      const parentSession = {
        id: 'parent-456',
        name: 'Parent',
        status: 'stopped',
      };
      const rootSession = {
        id: 'root-123',
        name: 'Root',
        status: 'stopped',
      };
      const rootSummary = {
        fullSummary: 'This is the root session summary.',
        shortSummary: 'Root summary',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, rootSummary);

      expect(rendered).toBe('Root summary: This is the root session summary.');
    });

    it('renders template with rootSession.status', async () => {
      const templatePrompt = 'Root status: {{rootSession.status}}';
      const parentSession = {
        id: 'parent-456',
        name: 'Parent',
        status: 'stopped',
      };
      const rootSession = {
        id: 'root-123',
        name: 'Root',
        status: 'completed',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('Root status: completed');
    });

    it('rootSession equals parentSession when there is no chain', async () => {
      const templatePrompt = 'Parent: {{parentSession.id}}, Root: {{rootSession.id}}';
      const parentSession = {
        id: 'session-123',
        name: 'Single Session',
        status: 'stopped',
      };
      const rootSession = parentSession; // Same as parent for single-level

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('Parent: session-123, Root: session-123');
    });

    it('rootSession differs from parentSession in multi-level chain', async () => {
      const templatePrompt = 'Chain: {{rootSession.name}} -> {{parentSession.name}}';
      const rootSession = {
        id: 'root-123',
        name: 'Root Session',
        status: 'stopped',
      };
      const parentSession = {
        id: 'parent-456',
        name: 'Parent Session',
        status: 'stopped',
        parentSessionId: 'root-123',
      };

      const rendered = await renderTemplatePrompt(templatePrompt, parentSession, null, rootSession, null);

      expect(rendered).toBe('Chain: Root Session -> Parent Session');
    });
  });

  describe('checkAndTriggerNextTemplate', () => {
    let tempDir;
    let projectId;
    let parentSessionId;
    let templateId;

    beforeEach(() => {
      vi.clearAllMocks();

      // Create temp directory for git repo
      tempDir = mkdtempSync(join(tmpdir(), 'template-trigger-test-'));

      // Initialize as git repo
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'ignore' });
      execSync('touch test.txt && git add . && git commit -m "init"', { cwd: tempDir, stdio: 'ignore' });

      // Create project
      const project = projects.create('Test Project', tempDir);
      projectId = project.id;

      // Create template
      const template = sessionTemplates.create({
        projectId,
        name: 'Follow-up Template',
        prompt: 'Follow up: {{parentSession.summary}}',
      });
      templateId = template.id;

      // Create parent session with nextTemplateId and model
      const session = sessions.create(projectId, 'Parent Session', 'Initial prompt', 'standard');
      parentSessionId = session.id;
      sessions.update(parentSessionId, {
        nextTemplateId: templateId,
        status: 'stopped',
        model: 'claude-sonnet-4-20250514',
        mode: 'plan'
      });
    });

    afterEach(() => {
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('broadcasts SESSION_CREATED to project subscribers when new session is created', async () => {
      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify broadcastToProject was called with SESSION_CREATED
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      expect(sessionCreatedCalls[0][0]).toBe(projectId);
      expect(sessionCreatedCalls[0][2].projectId).toBe(projectId);
      expect(sessionCreatedCalls[0][2].session).toBeDefined();
      expect(sessionCreatedCalls[0][2].session.name).toContain('Follow-up Template');
    });

    it('includes parent session reference in broadcasted session', async () => {
      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls[0][2].session.parentSessionId).toBe(parentSessionId);
    });

    it('does not broadcast if session has no nextTemplateId', async () => {
      // Remove the nextTemplateId
      sessions.update(parentSessionId, { nextTemplateId: null });

      await checkAndTriggerNextTemplate(parentSessionId);

      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('does not broadcast if session does not exist', async () => {
      await checkAndTriggerNextTemplate('non-existent-session-id');

      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('does not broadcast if template does not exist', async () => {
      // Delete the template so it doesn't exist anymore
      sessionTemplates.delete(templateId);

      await checkAndTriggerNextTemplate(parentSessionId);

      // Only the session update to set nextTemplateId happened, no SESSION_CREATED
      expect(broadcastToProject).not.toHaveBeenCalled();
    });

    it('broadcasts SESSION_UPDATED with error status when runSession fails', async () => {
      // Make runSession reject with an error
      runSession.mockRejectedValueOnce(new Error('Session execution failed'));

      await checkAndTriggerNextTemplate(parentSessionId);

      // Wait for the catch block to execute (runSession is called non-blocking)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify SESSION_UPDATED was broadcast with error status
      const sessionUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      expect(sessionUpdatedCalls.length).toBe(1);
      expect(sessionUpdatedCalls[0][0]).toBe(projectId);
      expect(sessionUpdatedCalls[0][2].projectId).toBe(projectId);
      expect(sessionUpdatedCalls[0][2].session.status).toBe('error');
      expect(sessionUpdatedCalls[0][2].session.error).toBe('Session execution failed');
    });

    it('includes sessionId in error broadcast payload', async () => {
      runSession.mockRejectedValueOnce(new Error('Test error'));

      await checkAndTriggerNextTemplate(parentSessionId);
      await new Promise((resolve) => setTimeout(resolve, 50));

      const sessionUpdatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_UPDATED
      );

      expect(sessionUpdatedCalls[0][2].sessionId).toBeDefined();
    });

    it('calls runSession with correct parameters', async () => {
      await checkAndTriggerNextTemplate(parentSessionId);

      expect(runSession).toHaveBeenCalledTimes(1);
      expect(runSession).toHaveBeenCalledWith(
        expect.any(String), // new session id
        expect.stringContaining('Follow up:'), // rendered prompt
        expect.stringContaining(tempDir), // working directory
        null, // system prompt (project has none)
        [], // attachments (empty for template-triggered sessions)
        null // model (template has none set, so parent's model is not passed directly)
      );
    });

    it('uses summary context in rendered prompt', async () => {
      // Create a summary for the parent session
      sessionSummaries.upsert(parentSessionId, {
        shortSummary: 'Short summary',
        fullSummary: 'Full summary of the parent session work',
        keyActions: ['action1'],
        filesModified: ['file.js'],
        outcome: 'partial',
        messageCount: 5,
      });

      await checkAndTriggerNextTemplate(parentSessionId);

      expect(runSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('Full summary of the parent session work'),
        expect.any(String),
        null,
        [], // attachments
        null // model (template has none set)
      );
    });

    it('uses model from template when set', async () => {
      // Update template to have a model
      sessionTemplates.update(templateId, { model: 'claude-opus-4-20250514' });

      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify the broadcasted session has the template's model
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      expect(sessionCreatedCalls[0][2].session.model).toBe('claude-opus-4-20250514');
    });

    it('inherits model from parent session when template has no model', async () => {
      // Template has no model set (null)
      // Parent session has model: 'claude-sonnet-4-20250514'

      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify the broadcasted session has the parent's model
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      expect(sessionCreatedCalls[0][2].session.model).toBe('claude-sonnet-4-20250514');
    });

    it('uses mode from template when set', async () => {
      // Update template to have a different mode
      sessionTemplates.update(templateId, { mode: 'standard' });

      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify the broadcasted session has the template's mode
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      expect(sessionCreatedCalls[0][2].session.mode).toBe('standard');
    });

    it('inherits mode from parent session when template has no mode', async () => {
      // Template has no mode set (defaults to 'yolo' in DB)
      // But the service should use template.mode if it exists, or fall back to session.mode
      // Parent session has mode: 'plan'

      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify the broadcasted session has the template's mode (or parent's if template is null)
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      // Template defaults to 'yolo', so the new session should have 'yolo' mode
      expect(sessionCreatedCalls[0][2].session.mode).toBe('yolo');
    });

    it('uses both model and mode from template when both are set', async () => {
      // Update template to have both model and mode
      sessionTemplates.update(templateId, {
        model: 'claude-opus-4-20250514',
        mode: 'plan'
      });

      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify the broadcasted session was created with both values
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      expect(sessionCreatedCalls[0][2].session.model).toBe('claude-opus-4-20250514');
      expect(sessionCreatedCalls[0][2].session.mode).toBe('plan');
    });

    it('getRootSession walks up a multi-level chain correctly', () => {
      // Create a 3-level chain: A -> B -> C
      // A is the root (no parent)
      const sessionA = sessions.create(projectId, 'Session A', 'Prompt A', 'standard');

      // B is child of A
      const sessionB = sessions.create(projectId, 'Session B', 'Prompt B', 'standard');
      sessions.update(sessionB.id, { parentSessionId: sessionA.id });

      // C is child of B
      const sessionC = sessions.create(projectId, 'Session C', 'Prompt C', 'standard');
      sessions.update(sessionC.id, { parentSessionId: sessionB.id });

      // Get the updated sessions
      const updatedB = sessions.getById(sessionB.id);
      const updatedC = sessions.getById(sessionC.id);

      // From C, getRootSession should return A
      const rootFromC = getRootSession(updatedC);
      expect(rootFromC.id).toBe(sessionA.id);
      expect(rootFromC.name).toBe('Session A');

      // From B, getRootSession should return A
      const rootFromB = getRootSession(updatedB);
      expect(rootFromB.id).toBe(sessionA.id);
      expect(rootFromB.name).toBe('Session A');

      // From A, getRootSession should return A (itself)
      const rootFromA = getRootSession(sessionA);
      expect(rootFromA.id).toBe(sessionA.id);
      expect(rootFromA.name).toBe('Session A');
    });

    it('getRootSession handles orphaned chains gracefully', () => {
      // Create a chain where the middle session gets deleted
      const sessionA = sessions.create(projectId, 'Session A', 'Prompt A', 'standard');
      const sessionB = sessions.create(projectId, 'Session B', 'Prompt B', 'standard');
      sessions.update(sessionB.id, { parentSessionId: sessionA.id });
      const sessionC = sessions.create(projectId, 'Session C', 'Prompt C', 'standard');
      sessions.update(sessionC.id, { parentSessionId: sessionB.id });

      // Delete session A (the root)
      sessions.delete(sessionA.id);

      // Get updated C
      const updatedC = sessions.getById(sessionC.id);

      // From C, getRootSession should return B (the deepest valid ancestor)
      const root = getRootSession(updatedC);
      expect(root.id).toBe(sessionB.id);
      expect(root.name).toBe('Session B');
    });
  });
});
