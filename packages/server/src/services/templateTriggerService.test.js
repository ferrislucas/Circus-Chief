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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary, rootSession, rootSummary });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary, rootSession, rootSummary });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary, rootSession, rootSummary });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary, rootSession, rootSummary });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary, rootSession, rootSummary });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary, rootSession, rootSummary });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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

      const rendered = await renderTemplatePrompt(templatePrompt, { parentSession, parentSummary: null, rootSession, rootSummary: null });

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
        mode: 'plan',
        effortLevel: 'low'
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
        { systemPrompt: null, model: 'claude-sonnet-4-20250514' } // options object
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
        { systemPrompt: null, model: 'claude-sonnet-4-20250514' } // options object
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

    it('inherits model from root session when template has no model', async () => {
      // Template has no model set (null)
      // Parent session has model: 'claude-sonnet-4-20250514'

      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify the broadcasted session has the root session's model
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      expect(sessionCreatedCalls[0][2].session.model).toBe('claude-sonnet-4-20250514');
    });

    it('passes resolved inherited model to runSession when template model is null', async () => {
      // beforeEach: template has model: null, root session has model: 'claude-sonnet-4-20250514'
      await checkAndTriggerNextTemplate(parentSessionId);

      expect(runSession).toHaveBeenCalledTimes(1);
      expect(runSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ model: 'claude-sonnet-4-20250514' })
      );
    });

    it('passes template explicit model to runSession when template has a model set', async () => {
      sessionTemplates.update(templateId, { model: 'claude-opus-4-20250514' });
      await checkAndTriggerNextTemplate(parentSessionId);

      expect(runSession).toHaveBeenCalledTimes(1);
      expect(runSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ model: 'claude-opus-4-20250514' })
      );
    });

    it('passes root model to runSession in multi-level chain when intermediate template has no model', async () => {
      // Set up A -> B chain where B's template has model: null
      sessions.update(parentSessionId, { thinkingEnabled: true });

      const templateB = sessionTemplates.create({ projectId, name: 'Template B', prompt: 'B prompt' });
      // templateB.model is null by default (inherit)

      sessions.update(parentSessionId, { nextTemplateId: templateB.id });
      await checkAndTriggerNextTemplate(parentSessionId);

      // Get session B
      const sessionBCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      const sessionB = sessionBCalls[0][2].session;

      // Verify runSession was called with the root session's model (not null)
      expect(runSession).toHaveBeenCalledWith(
        sessionB.id,
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ model: 'claude-sonnet-4-20250514' })
      );
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

    it('inherits mode from root session when template has no mode', async () => {
      // Template has no mode set (defaults to null in DB after create() fix)
      // Parent session has mode: 'plan' — which is also the root session
      // So the child should inherit 'plan' from root session

      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify the broadcasted session has the root session's mode
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      // Template mode is null, so child inherits mode from root session ('plan')
      expect(sessionCreatedCalls[0][2].session.mode).toBe('plan');
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

    // ============================================================
    // Rescheduling inheritance tests
    // ============================================================

    it('inherits rescheduling properties from root session', async () => {
      sessions.update(parentSessionId, {
        autoRescheduleEnabled: true,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: true,
        rescheduleDelayMinutes: 30,
        rescheduleAtTokenCount: 150000,
        maxRescheduleCount: 5,
        maxTotalTokens: 1000000,
      });

      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      const childSession = sessionCreatedCalls[0][2].session;
      expect(childSession.autoRescheduleEnabled).toBe(true);
      expect(childSession.rescheduleOnTokenLimit).toBe(true);
      expect(childSession.rescheduleOnServiceError).toBe(true);
      expect(childSession.rescheduleDelayMinutes).toBe(30);
      expect(childSession.rescheduleAtTokenCount).toBe(150000);
      expect(childSession.maxRescheduleCount).toBe(5);
      expect(childSession.maxTotalTokens).toBe(1000000);
    });

    it('inherits rescheduling defaults from root when rescheduling is not configured', async () => {
      // Root session uses DB defaults (no rescheduling updates)
      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      const childSession = sessionCreatedCalls[0][2].session;
      expect(childSession.autoRescheduleEnabled).toBe(false);
      expect(childSession.rescheduleOnTokenLimit).toBe(true);
      expect(childSession.rescheduleOnServiceError).toBe(true);
      expect(childSession.rescheduleDelayMinutes).toBe(15);
    });

    it('does not inherit rescheduleCount from root (resets to 0)', async () => {
      sessions.update(parentSessionId, { rescheduleCount: 3 });

      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      const childSession = sessionCreatedCalls[0][2].session;
      expect(childSession.rescheduleCount).toBe(0);
    });

    // ============================================================
    // Root-vs-parent inheritance tests (multi-level chain)
    // ============================================================

    it('inherits settings from root session, not intermediate parent, in a chain', async () => {
      // Create a 3-level chain: root (A) -> parent (B) -> child (C)
      // Session A is the root already set up as parentSessionId with mode: 'plan', model: 'claude-sonnet-4-20250514'
      // Explicitly set thinkingEnabled: true on root A to distinguish from B's templateB override of false
      sessions.update(parentSessionId, { thinkingEnabled: true });

      // Create template B (with mode: 'standard', thinkingEnabled: false overrides)
      const templateB = sessionTemplates.create({
        projectId,
        name: 'Template B',
        prompt: 'Template B prompt',
      });
      sessionTemplates.update(templateB.id, { mode: 'standard', thinkingEnabled: false });

      // Create session B by triggering template B from session A
      // First set A to use templateB
      sessions.update(parentSessionId, { nextTemplateId: templateB.id });

      await checkAndTriggerNextTemplate(parentSessionId);

      // Get the created session B
      const sessionBCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionBCreatedCalls.length).toBe(1);
      const sessionB = sessionBCreatedCalls[0][2].session;

      // Verify B got template overrides
      expect(sessionB.mode).toBe('standard');
      expect(sessionB.thinkingEnabled).toBe(false);
      expect(sessionB.model).toBe('claude-sonnet-4-20250514'); // inherited from root A

      // Now create template C (all null settings — should inherit from root A, not parent B)
      const templateC = sessionTemplates.create({
        projectId,
        name: 'Template C',
        prompt: 'Template C prompt',
      });

      // Set session B to trigger template C
      sessions.update(sessionB.id, {
        nextTemplateId: templateC.id,
        status: 'stopped',
      });

      // Clear broadcast calls
      broadcastToProject.mockClear();

      // Trigger from B -> creates C
      await checkAndTriggerNextTemplate(sessionB.id);

      const sessionCCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionCCreatedCalls.length).toBe(1);
      const sessionC = sessionCCreatedCalls[0][2].session;

      // C should inherit from root A, not intermediate parent B
      expect(sessionC.mode).toBe('plan');             // from root A, not B's 'standard'
      expect(sessionC.thinkingEnabled).toBe(true);    // from root A (true), not B's false (templateB override)
      expect(sessionC.model).toBe('claude-sonnet-4-20250514'); // from root A
    });

    it('template overrides still take precedence over root session in a chain', async () => {
      // Create template B
      const templateB = sessionTemplates.create({
        projectId,
        name: 'Template B Override',
        prompt: 'Template B prompt',
      });
      sessionTemplates.update(templateB.id, { mode: 'standard', thinkingEnabled: false });

      sessions.update(parentSessionId, { nextTemplateId: templateB.id });
      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionBCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      const sessionB = sessionBCalls[0][2].session;

      // Create template C with explicit mode override
      const templateC = sessionTemplates.create({
        projectId,
        name: 'Template C Override',
        prompt: 'Template C prompt',
      });
      sessionTemplates.update(templateC.id, { mode: 'yolo' });

      sessions.update(sessionB.id, { nextTemplateId: templateC.id, status: 'stopped' });
      broadcastToProject.mockClear();

      await checkAndTriggerNextTemplate(sessionB.id);

      const sessionCCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionCCalls.length).toBe(1);
      const sessionC = sessionCCalls[0][2].session;

      // C's template overrides root A's mode
      expect(sessionC.mode).toBe('yolo');
      // model is null in template C, so inherits from root A
      expect(sessionC.model).toBe('claude-sonnet-4-20250514');
    });

    // ============================================================
    // Template-vs-root precedence tests (single-level, root = parent)
    // ============================================================

    it('inherits mode from root when template mode is null', async () => {
      // Template already has null mode (default after create() fix)
      // Root session has mode: 'plan'
      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionCreatedCalls[0][2].session.mode).toBe('plan');
    });

    it('template mode overrides root mode when set', async () => {
      sessionTemplates.update(templateId, { mode: 'standard' });

      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionCreatedCalls[0][2].session.mode).toBe('standard');
    });

    it('inherits thinkingEnabled from root when template thinkingEnabled is null', async () => {
      // Template has null thinkingEnabled by default
      // Update root with thinkingEnabled: true
      sessions.update(parentSessionId, { thinkingEnabled: true });

      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionCreatedCalls[0][2].session.thinkingEnabled).toBe(true);
    });

    it('template thinkingEnabled=false overrides root thinkingEnabled=true', async () => {
      // Update template to explicitly disable thinking
      sessionTemplates.update(templateId, { thinkingEnabled: false });
      // Update root session to enable thinking
      sessions.update(parentSessionId, { thinkingEnabled: true });

      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      // Explicit false from template overrides root's true
      expect(sessionCreatedCalls[0][2].session.thinkingEnabled).toBe(false);
    });

    it('inherits gitBranch from root when template gitBranch is null', async () => {
      // Template has null gitBranch
      sessions.update(parentSessionId, { gitBranch: 'feature/my-branch' });

      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionCreatedCalls[0][2].session.gitBranch).toBe('feature/my-branch');
    });

    it('template gitBranch overrides root gitBranch when set', async () => {
      sessionTemplates.update(templateId, { gitBranch: 'template-branch' });
      sessions.update(parentSessionId, { gitBranch: 'root-branch' });

      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionCreatedCalls[0][2].session.gitBranch).toBe('template-branch');
    });

    it('empty string gitBranch update coerces to null and inherits from root', async () => {
      // After update() fix, gitBranch: '' is stored as null
      sessionTemplates.update(templateId, { gitBranch: '' });

      // Verify the template now has null gitBranch
      const template = sessionTemplates.getById(templateId);
      expect(template.gitBranch).toBeNull();

      // Set root gitBranch
      sessions.update(parentSessionId, { gitBranch: 'root-branch' });

      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      // Template gitBranch is null, so inherits from root
      expect(sessionCreatedCalls[0][2].session.gitBranch).toBe('root-branch');
    });

    it('inherits effortLevel from root when template effortLevel is null', async () => {
      // Template has null effortLevel by default
      // Update root with effortLevel: 'high'
      sessions.update(parentSessionId, { effortLevel: 'high' });

      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionCreatedCalls[0][2].session.effortLevel).toBe('high');
    });

    it('template effortLevel overrides root effortLevel when set', async () => {
      sessionTemplates.update(templateId, { effortLevel: 'max' });
      sessions.update(parentSessionId, { effortLevel: 'low' });

      await checkAndTriggerNextTemplate(parentSessionId);

      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionCreatedCalls[0][2].session.effortLevel).toBe('max');
    });

    it('uses effortLevel from template when set', async () => {
      // Update template to have a specific effortLevel
      sessionTemplates.update(templateId, { effortLevel: 'medium' });

      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify the broadcasted session has the template's effortLevel
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      expect(sessionCreatedCalls[0][2].session.effortLevel).toBe('medium');
    });

    it('inherits effortLevel from root session when template has no effortLevel', async () => {
      // Template has no effortLevel set (null)
      // Parent session has effortLevel: 'low' — which is also the root session

      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify the broadcasted session has the root session's effortLevel
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      // Template effortLevel is null, so child inherits effortLevel from root session ('low')
      expect(sessionCreatedCalls[0][2].session.effortLevel).toBe('low');
    });

    it('uses both effortLevel and mode from template when both are set', async () => {
      // Update template to have both effortLevel and mode
      sessionTemplates.update(templateId, {
        effortLevel: 'high',
        mode: 'plan'
      });

      await checkAndTriggerNextTemplate(parentSessionId);

      // Verify the broadcasted session was created with both values
      const sessionCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );

      expect(sessionCreatedCalls.length).toBe(1);
      expect(sessionCreatedCalls[0][2].session.effortLevel).toBe('high');
      expect(sessionCreatedCalls[0][2].session.mode).toBe('plan');
    });

    it('template effortLevel overrides root effortLevel in a multi-level chain', async () => {
      // Create a 3-level chain: root (A) -> parent (B) -> child (C)
      // Session A is the root already set up as parentSessionId with mode: 'plan', model: 'claude-sonnet-4-20250514'
      // Set root effortLevel to 'medium'
      sessions.update(parentSessionId, { effortLevel: 'medium' });

      // Create template B
      const templateB = sessionTemplates.create({
        projectId,
        name: 'Template B',
        prompt: 'Template B prompt',
      });
      sessions.update(parentSessionId, { nextTemplateId: templateB.id, status: 'stopped' });
      broadcastToProject.mockClear();

      await checkAndTriggerNextTemplate(parentSessionId);

      // Get the created session B
      const sessionBCreatedCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionBCreatedCalls.length).toBe(1);
      const sessionB = sessionBCreatedCalls[0][2].session;

      // Verify B inherited effortLevel from root A
      expect(sessionB.effortLevel).toBe('medium');

      // Now create template C with explicit effortLevel override
      const templateC = sessionTemplates.create({
        projectId,
        name: 'Template C Override',
        prompt: 'Template C prompt',
      });
      sessionTemplates.update(templateC.id, { effortLevel: 'max' });

      sessions.update(sessionB.id, { nextTemplateId: templateC.id, status: 'stopped' });
      broadcastToProject.mockClear();

      await checkAndTriggerNextTemplate(sessionB.id);

      const sessionCCalls = broadcastToProject.mock.calls.filter(
        (call) => call[1] === WS_MESSAGE_TYPES.SESSION_CREATED
      );
      expect(sessionCCalls.length).toBe(1);
      const sessionC = sessionCCalls[0][2].session;

      // C's template overrides root A's effortLevel
      expect(sessionC.effortLevel).toBe('max');
    });
  });
});
