import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('../database.js', () => ({
  sessions: { getById: vi.fn(), create: vi.fn(), update: vi.fn() },
  sessionTemplates: { getById: vi.fn() },
  sessionSummaries: { getBySessionId: vi.fn() },
  projects: { getById: vi.fn() },
}));

vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

vi.mock('./templateTriggerService.js', () => ({
  renderTemplatePrompt: vi.fn(),
  getRootSession: vi.fn(),
}));

vi.mock('./gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn(),
}));

vi.mock('./sessionManager.js', () => ({
  runSession: vi.fn(),
}));

import { sessions, sessionTemplates, sessionSummaries, projects } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { renderTemplatePrompt, getRootSession } from './templateTriggerService.js';
import { setupGitForSession } from './gitSessionSetup.js';
import { runSession } from './sessionManager.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import {
  MAX_LANE_TRIGGER_DEPTH,
  getSessionAndProjectForTrigger,
  determineWorkingDirectory,
  startChildSession,
  getLaneSessionSettings,
  getTemplateSessionSettings,
  triggerOnEnterTemplate,
  triggerOnEnterPrompt,
} from './kanbanTriggers.js';

describe('kanbanTriggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MAX_LANE_TRIGGER_DEPTH', () => {
    it('is 5', () => {
      expect(MAX_LANE_TRIGGER_DEPTH).toBe(5);
    });
  });

  describe('getSessionAndProjectForTrigger', () => {
    it('returns null when session is not found', () => {
      sessions.getById.mockReturnValue(null);

      const result = getSessionAndProjectForTrigger('missing-session');

      expect(result).toBeNull();
      expect(projects.getById).not.toHaveBeenCalled();
    });

    it('returns null when project is not found', () => {
      sessions.getById.mockReturnValue({ id: 's1', projectId: 'p-missing' });
      projects.getById.mockReturnValue(null);

      const result = getSessionAndProjectForTrigger('s1');

      expect(result).toBeNull();
      expect(projects.getById).toHaveBeenCalledWith('p-missing');
    });

    it('returns session and project on success', () => {
      const session = { id: 's1', projectId: 'p1' };
      const project = { id: 'p1', workingDirectory: '/tmp/project' };
      sessions.getById.mockReturnValue(session);
      projects.getById.mockReturnValue(project);

      const result = getSessionAndProjectForTrigger('s1');

      expect(result).toEqual({ session, project });
      expect(sessions.getById).toHaveBeenCalledWith('s1');
      expect(projects.getById).toHaveBeenCalledWith('p1');
    });
  });

  describe('determineWorkingDirectory', () => {
    it('inherits parent worktree when present', async () => {
      const parentSession = { gitWorktree: '/tmp/worktree-abc' };
      const project = { workingDirectory: '/tmp/project' };

      const result = await determineWorkingDirectory(parentSession, project);

      expect(result).toEqual({
        workingDirectory: '/tmp/worktree-abc',
        gitWorktree: '/tmp/worktree-abc',
      });
      expect(setupGitForSession).not.toHaveBeenCalled();
    });

    it('calls setupGitForSession when gitOptions.sessionId is provided', async () => {
      const parentSession = { gitWorktree: null };
      const project = { workingDirectory: '/tmp/project' };
      setupGitForSession.mockResolvedValue({
        workingDirectory: '/tmp/git-setup-dir',
        gitWorktree: '/tmp/git-worktree',
      });

      const result = await determineWorkingDirectory(parentSession, project, {
        sessionId: 'new-session-1',
        gitMode: 'worktree',
        gitBranch: 'feature-branch',
      });

      expect(setupGitForSession).toHaveBeenCalledWith({
        projectDir: '/tmp/project',
        gitMode: 'worktree',
        gitBranch: 'feature-branch',
        sessionId: 'new-session-1',
      });
      expect(result).toEqual({
        workingDirectory: '/tmp/git-setup-dir',
        gitWorktree: '/tmp/git-worktree',
      });
    });

    it('uses null defaults for gitMode and gitBranch when not provided', async () => {
      const parentSession = { gitWorktree: null };
      const project = { workingDirectory: '/tmp/project' };
      setupGitForSession.mockResolvedValue({
        workingDirectory: '/tmp/project',
        gitWorktree: null,
      });

      await determineWorkingDirectory(parentSession, project, { sessionId: 'sess-1' });

      expect(setupGitForSession).toHaveBeenCalledWith({
        projectDir: '/tmp/project',
        gitMode: null,
        gitBranch: null,
        sessionId: 'sess-1',
      });
    });

    it('returns project working directory as default', async () => {
      const parentSession = { gitWorktree: null };
      const project = { workingDirectory: '/home/user/my-project' };

      const result = await determineWorkingDirectory(parentSession, project);

      expect(result).toEqual({
        workingDirectory: '/home/user/my-project',
        gitWorktree: null,
      });
      expect(setupGitForSession).not.toHaveBeenCalled();
    });
  });

  describe('startChildSession', () => {
    it('calls runSession with the correct arguments', () => {
      runSession.mockResolvedValue(undefined);
      const newSession = { id: 'child-1', projectId: 'p1' };

      startChildSession(newSession, 'do something', '/tmp/work', { model: 'opus' });

      expect(runSession).toHaveBeenCalledWith('child-1', 'do something', '/tmp/work', { model: 'opus' });
    });

    it('handles runSession error by updating session status and broadcasting', async () => {
      const error = new Error('spawn failed');
      runSession.mockRejectedValue(error);
      const errorSession = { id: 'child-1', projectId: 'p1', status: 'error' };
      sessions.update.mockReturnValue(errorSession);
      const newSession = { id: 'child-1', projectId: 'p1' };

      startChildSession(newSession, 'do something', '/tmp/work', {});

      // Wait for the promise rejection to be handled
      await vi.waitFor(() => {
        expect(sessions.update).toHaveBeenCalledWith('child-1', {
          status: 'error',
          error: 'spawn failed',
        });
      });

      expect(broadcastToProject).toHaveBeenCalledWith('p1', WS_MESSAGE_TYPES.SESSION_UPDATED, {
        projectId: 'p1',
        sessionId: 'child-1',
        session: errorSession,
      });
    });
  });

  describe('getLaneSessionSettings', () => {
    it('uses lane values when provided', () => {
      const lane = {
        onEnterThinkingEnabled: true,
        onEnterModel: 'lane-model',
        onEnterMode: 'lane-mode',
        onEnterEffortLevel: 'high',
      };
      const session = {
        thinkingEnabled: false,
        model: 'session-model',
        mode: 'session-mode',
        effortLevel: 'low',
        gitBranch: 'main',
      };

      const result = getLaneSessionSettings(lane, session);

      expect(result).toEqual({
        thinkingEnabled: true,
        model: 'lane-model',
        mode: 'lane-mode',
        effortLevel: 'high',
        gitBranch: 'main',
      });
    });

    it('falls back to session values when lane values are absent', () => {
      const lane = {
        onEnterThinkingEnabled: undefined,
        onEnterModel: null,
        onEnterMode: '',
        onEnterEffortLevel: null,
      };
      const session = {
        thinkingEnabled: true,
        model: 'session-model',
        mode: 'session-mode',
        effortLevel: 'medium',
        gitBranch: 'develop',
      };

      const result = getLaneSessionSettings(lane, session);

      expect(result).toEqual({
        thinkingEnabled: true,
        model: 'session-model',
        mode: 'session-mode',
        effortLevel: 'medium',
        gitBranch: 'develop',
      });
    });

    it('returns null effortLevel when neither lane nor session has one', () => {
      const lane = {};
      const session = { thinkingEnabled: false, model: 'm', mode: 'code', gitBranch: null };

      const result = getLaneSessionSettings(lane, session);

      expect(result.effortLevel).toBeNull();
    });

    it('uses lane thinkingEnabled even when false (nullish coalescing)', () => {
      const lane = { onEnterThinkingEnabled: false };
      const session = { thinkingEnabled: true, model: 'm', mode: 'code', gitBranch: null };

      const result = getLaneSessionSettings(lane, session);

      expect(result.thinkingEnabled).toBe(false);
    });
  });

  describe('getTemplateSessionSettings', () => {
    it('uses template values when provided', () => {
      const template = {
        thinkingEnabled: true,
        model: 'template-model',
        mode: 'template-mode',
        gitBranch: 'template-branch',
        gitMode: 'worktree',
      };
      const session = {
        thinkingEnabled: false,
        model: 'session-model',
        mode: 'session-mode',
        gitBranch: 'session-branch',
      };

      const result = getTemplateSessionSettings(template, session);

      expect(result).toEqual({
        thinkingEnabled: true,
        model: 'template-model',
        mode: 'template-mode',
        gitBranch: 'template-branch',
        gitMode: 'worktree',
      });
    });

    it('falls back to session values when template values are null/empty', () => {
      const template = {
        thinkingEnabled: null,
        model: '',
        mode: null,
        gitBranch: '',
        gitMode: null,
      };
      const session = {
        thinkingEnabled: true,
        model: 'session-model',
        mode: 'session-mode',
        gitBranch: 'main',
      };

      const result = getTemplateSessionSettings(template, session);

      expect(result).toEqual({
        thinkingEnabled: true,
        model: 'session-model',
        mode: 'session-mode',
        gitBranch: 'main',
        gitMode: null,
      });
    });

    it('uses template thinkingEnabled false over session value (strict null check)', () => {
      const template = {
        thinkingEnabled: false,
        model: null,
        mode: null,
        gitBranch: null,
        gitMode: null,
      };
      const session = {
        thinkingEnabled: true,
        model: 'session-model',
        mode: 'session-mode',
        gitBranch: 'main',
      };

      const result = getTemplateSessionSettings(template, session);

      expect(result.thinkingEnabled).toBe(false);
    });

    it('returns null gitMode when template gitMode is falsy', () => {
      const template = { thinkingEnabled: null, model: null, mode: null, gitBranch: null, gitMode: '' };
      const session = { thinkingEnabled: false, model: 'm', mode: 'code', gitBranch: null };

      const result = getTemplateSessionSettings(template, session);

      expect(result.gitMode).toBeNull();
    });
  });

  describe('triggerOnEnterTemplate', () => {
    const session = { id: 's1', projectId: 'p1', name: 'Test Session', model: 'opus', mode: 'code', thinkingEnabled: false, gitBranch: null, gitWorktree: null };
    const project = { id: 'p1', workingDirectory: '/tmp/project', systemPrompt: 'You are helpful.' };
    const template = { id: 't1', name: 'Review Template', prompt: 'Review: {{parentSession.summary}}', thinkingEnabled: null, model: null, mode: null, gitBranch: null, gitMode: null, nextTemplateId: null, targetLaneId: null };
    const lane = { id: 'lane-1', name: 'Review', onEnterTemplateId: 't1' };

    beforeEach(() => {
      sessions.getById.mockReturnValue(session);
      projects.getById.mockReturnValue(project);
      sessionTemplates.getById.mockReturnValue(template);
      sessionSummaries.getBySessionId.mockReturnValue({ fullSummary: 'Did some work' });
      getRootSession.mockReturnValue(session);
      renderTemplatePrompt.mockResolvedValue('Review: Did some work');
      sessions.create.mockReturnValue({ id: 'new-1', projectId: 'p1' });
      sessions.update.mockReturnValue({});
      runSession.mockResolvedValue(undefined);
    });

    it('returns early when depth exceeds MAX_LANE_TRIGGER_DEPTH', async () => {
      await triggerOnEnterTemplate('s1', lane, { depth: 5 });

      expect(sessionTemplates.getById).not.toHaveBeenCalled();
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('returns early when depth equals MAX_LANE_TRIGGER_DEPTH', async () => {
      await triggerOnEnterTemplate('s1', lane, { depth: MAX_LANE_TRIGGER_DEPTH });

      expect(sessionTemplates.getById).not.toHaveBeenCalled();
    });

    it('returns early when template is not found', async () => {
      sessionTemplates.getById.mockReturnValue(null);

      await triggerOnEnterTemplate('s1', lane);

      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('returns early when session is not found', async () => {
      sessions.getById.mockReturnValue(null);

      await triggerOnEnterTemplate('s1', lane);

      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('returns early when project is not found', async () => {
      sessions.getById.mockReturnValue(session);
      projects.getById.mockReturnValue(null);

      await triggerOnEnterTemplate('s1', lane);

      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('creates and starts a child session on success', async () => {
      await triggerOnEnterTemplate('s1', lane);

      // Renders the template prompt
      expect(renderTemplatePrompt).toHaveBeenCalledWith(
        template.prompt,
        expect.objectContaining({ parentSession: session })
      );

      // Creates the session with correct name and settings
      expect(sessions.create).toHaveBeenCalledWith(
        'p1',
        'Review Template (lane: Review)',
        'Review: Did some work',
        expect.objectContaining({ status: 'starting' })
      );

      // Updates session with parentSessionId and depth
      expect(sessions.update).toHaveBeenCalledWith('new-1', expect.objectContaining({
        parentSessionId: 's1',
        laneTriggerDepth: 1,
        nextTemplateId: null,
        targetLaneId: null,
      }));

      // Broadcasts SESSION_CREATED
      expect(broadcastToProject).toHaveBeenCalledWith('p1', WS_MESSAGE_TYPES.SESSION_CREATED, expect.objectContaining({
        projectId: 'p1',
      }));

      // Starts the child session
      expect(runSession).toHaveBeenCalledWith('new-1', 'Review: Did some work', '/tmp/project', {
        systemPrompt: 'You are helpful.',
        model: session.model,
      });
    });

    it('increments depth from options', async () => {
      await triggerOnEnterTemplate('s1', lane, { depth: 2 });

      expect(sessions.update).toHaveBeenCalledWith('new-1', expect.objectContaining({
        laneTriggerDepth: 3,
      }));
    });

    it('sets nextTemplateId and targetLaneId from template', async () => {
      sessionTemplates.getById.mockReturnValue({
        ...template,
        nextTemplateId: 'next-t1',
        targetLaneId: 'target-lane-1',
      });

      await triggerOnEnterTemplate('s1', lane);

      expect(sessions.update).toHaveBeenCalledWith('new-1', expect.objectContaining({
        nextTemplateId: 'next-t1',
        targetLaneId: 'target-lane-1',
      }));
    });

    it('sets gitWorktree when determineWorkingDirectory returns one', async () => {
      sessions.getById.mockReturnValue({ ...session, gitWorktree: '/tmp/existing-worktree' });

      await triggerOnEnterTemplate('s1', lane);

      // Should update the new session with the inherited gitWorktree
      expect(sessions.update).toHaveBeenCalledWith('new-1', { gitWorktree: '/tmp/existing-worktree' });
    });

    it('does not throw when renderTemplatePrompt fails', async () => {
      renderTemplatePrompt.mockRejectedValue(new Error('render failed'));

      // Should not throw -- error is caught internally
      await expect(triggerOnEnterTemplate('s1', lane)).resolves.toBeUndefined();
    });

    it('fetches parent and root summaries for template rendering', async () => {
      const rootSession = { id: 'root-1', projectId: 'p1', name: 'Root' };
      getRootSession.mockReturnValue(rootSession);
      sessionSummaries.getBySessionId
        .mockReturnValueOnce({ fullSummary: 'Parent summary' })  // parent
        .mockReturnValueOnce({ fullSummary: 'Root summary' });   // root

      await triggerOnEnterTemplate('s1', lane);

      expect(sessionSummaries.getBySessionId).toHaveBeenCalledWith('s1');
      expect(sessionSummaries.getBySessionId).toHaveBeenCalledWith('root-1');
      expect(renderTemplatePrompt).toHaveBeenCalledWith(
        template.prompt,
        {
          parentSession: session,
          parentSummary: { fullSummary: 'Parent summary' },
          rootSession,
          rootSummary: { fullSummary: 'Root summary' },
        }
      );
    });
  });

  describe('triggerOnEnterPrompt', () => {
    const session = { id: 's1', projectId: 'p1', name: 'Test Session', model: 'opus', mode: 'code', thinkingEnabled: true, effortLevel: 'high', gitBranch: 'main', gitWorktree: null };
    const project = { id: 'p1', workingDirectory: '/tmp/project', systemPrompt: 'Be helpful.' };
    const lane = {
      id: 'lane-1',
      name: 'In Progress',
      onEnterPrompt: 'Work on: {{parentSession.name}}',
      onEnterThinkingEnabled: undefined,
      onEnterModel: null,
      onEnterMode: null,
      onEnterEffortLevel: null,
      onEnterAutoRescheduleEnabled: false,
    };

    beforeEach(() => {
      sessions.getById.mockReturnValue(session);
      projects.getById.mockReturnValue(project);
      sessionSummaries.getBySessionId.mockReturnValue(null);
      getRootSession.mockReturnValue(session);
      renderTemplatePrompt.mockResolvedValue('Work on: Test Session');
      sessions.create.mockReturnValue({ id: 'new-prompt-1', projectId: 'p1' });
      sessions.update.mockReturnValue({});
      runSession.mockResolvedValue(undefined);
    });

    it('returns early when depth exceeds MAX_LANE_TRIGGER_DEPTH', async () => {
      await triggerOnEnterPrompt('s1', lane, { depth: 5 });

      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('returns early when session is not found', async () => {
      sessions.getById.mockReturnValue(null);

      await triggerOnEnterPrompt('s1', lane);

      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('returns early when project is not found', async () => {
      sessions.getById.mockReturnValue(session);
      projects.getById.mockReturnValue(null);

      await triggerOnEnterPrompt('s1', lane);

      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('creates and starts a child session on success', async () => {
      await triggerOnEnterPrompt('s1', lane);

      // Renders the prompt
      expect(renderTemplatePrompt).toHaveBeenCalledWith(
        lane.onEnterPrompt,
        expect.objectContaining({ parentSession: session })
      );

      // Creates session with lane settings
      expect(sessions.create).toHaveBeenCalledWith(
        'p1',
        'Lane prompt (lane: In Progress)',
        'Work on: Test Session',
        expect.objectContaining({ status: 'starting' })
      );

      // Updates with parentSessionId and depth
      expect(sessions.update).toHaveBeenCalledWith('new-prompt-1', expect.objectContaining({
        parentSessionId: 's1',
        laneTriggerDepth: 1,
      }));

      // Broadcasts SESSION_CREATED
      expect(broadcastToProject).toHaveBeenCalledWith('p1', WS_MESSAGE_TYPES.SESSION_CREATED, expect.objectContaining({
        projectId: 'p1',
      }));

      // Starts the session
      expect(runSession).toHaveBeenCalledWith('new-prompt-1', 'Work on: Test Session', '/tmp/project', {
        systemPrompt: 'Be helpful.',
        model: session.model,
      });
    });

    it('increments depth from options', async () => {
      await triggerOnEnterPrompt('s1', lane, { depth: 3 });

      expect(sessions.update).toHaveBeenCalledWith('new-prompt-1', expect.objectContaining({
        laneTriggerDepth: 4,
      }));
    });

    it('applies auto-reschedule settings when enabled', async () => {
      const autoRescheduleLane = {
        ...lane,
        onEnterAutoRescheduleEnabled: true,
        onEnterRescheduleDelayMinutes: 30,
        onEnterRescheduleOnTokenLimit: false,
        onEnterRescheduleOnServiceError: false,
        onEnterMaxRescheduleCount: 10,
        onEnterMaxTotalTokens: 50000,
        onEnterRescheduleAtTokenCount: 40000,
      };

      await triggerOnEnterPrompt('s1', autoRescheduleLane);

      expect(sessions.update).toHaveBeenCalledWith('new-prompt-1', expect.objectContaining({
        parentSessionId: 's1',
        laneTriggerDepth: 1,
        autoRescheduleEnabled: true,
        rescheduleDelayMinutes: 30,
        rescheduleOnTokenLimit: false,
        rescheduleOnServiceError: false,
        maxRescheduleCount: 10,
        maxTotalTokens: 50000,
        rescheduleAtTokenCount: 40000,
      }));
    });

    it('uses default auto-reschedule values when not specified', async () => {
      const autoRescheduleLane = {
        ...lane,
        onEnterAutoRescheduleEnabled: true,
        onEnterRescheduleDelayMinutes: null,
        onEnterRescheduleOnTokenLimit: undefined,
        onEnterRescheduleOnServiceError: undefined,
        onEnterMaxRescheduleCount: null,
        onEnterMaxTotalTokens: null,
        onEnterRescheduleAtTokenCount: null,
      };

      await triggerOnEnterPrompt('s1', autoRescheduleLane);

      expect(sessions.update).toHaveBeenCalledWith('new-prompt-1', expect.objectContaining({
        autoRescheduleEnabled: true,
        rescheduleDelayMinutes: 15,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: true,
        maxRescheduleCount: null,
        maxTotalTokens: null,
        rescheduleAtTokenCount: null,
      }));
    });

    it('does not include auto-reschedule fields when disabled', async () => {
      await triggerOnEnterPrompt('s1', lane);

      const updateCall = sessions.update.mock.calls.find(
        (call) => call[0] === 'new-prompt-1' && call[1].parentSessionId
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[1]).not.toHaveProperty('autoRescheduleEnabled');
      expect(updateCall[1]).not.toHaveProperty('rescheduleDelayMinutes');
    });

    it('does not throw when renderTemplatePrompt fails', async () => {
      renderTemplatePrompt.mockRejectedValue(new Error('render error'));

      await expect(triggerOnEnterPrompt('s1', lane)).resolves.toBeUndefined();
    });

    it('sets gitWorktree on new session when parent has worktree', async () => {
      sessions.getById.mockReturnValue({ ...session, gitWorktree: '/tmp/parent-worktree' });

      await triggerOnEnterPrompt('s1', lane);

      expect(sessions.update).toHaveBeenCalledWith('new-prompt-1', { gitWorktree: '/tmp/parent-worktree' });
    });
  });
});
