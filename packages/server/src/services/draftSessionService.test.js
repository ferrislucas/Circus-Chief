import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateDraftSession, startDraft, DraftSessionError } from './draftSessionService.js';
import { sessions, messages, projects, conversations, attachments } from '../database.js';

// Mock database
vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
    update: vi.fn(),
  },
  messages: {
    getBySessionId: vi.fn(),
    create: vi.fn(),
    updateContent: vi.fn(),
  },
  projects: {
    getById: vi.fn(),
  },
  conversations: {
    getActiveBySessionId: vi.fn(),
  },
  attachments: {
    getBySessionId: vi.fn(),
  },
}));

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock slashCommandService
vi.mock('./slashCommandService.js', () => ({
  resolvePromptSkillOrCommand: vi.fn().mockResolvedValue(null),
}));

// Mock sessionManager
vi.mock('./sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
}));

describe('draftSessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateDraftSession', () => {
    it('returns valid for a waiting session with no assistant messages', () => {
      const session = { id: 's1', status: 'waiting' };
      messages.getBySessionId.mockReturnValue([
        { id: 'm1', role: 'user', content: 'Hello' },
      ]);

      const result = validateDraftSession(session);

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns invalid when session is not in waiting status', () => {
      const session = { id: 's1', status: 'running' };

      const result = validateDraftSession(session);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Session must be in waiting status to start');
    });

    it('returns invalid when session has assistant messages', () => {
      const session = { id: 's1', status: 'waiting' };
      messages.getBySessionId.mockReturnValue([
        { id: 'm1', role: 'user', content: 'Hello' },
        { id: 'm2', role: 'assistant', content: 'Hi there' },
      ]);

      const result = validateDraftSession(session);

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Session is not a draft - it already has responses');
    });

    it('returns invalid for stopped status', () => {
      const session = { id: 's1', status: 'stopped' };

      const result = validateDraftSession(session);

      expect(result.valid).toBe(false);
    });

    it('returns invalid for error status', () => {
      const session = { id: 's1', status: 'error' };

      const result = validateDraftSession(session);

      expect(result.valid).toBe(false);
    });
  });

  describe('startDraft', () => {
    const mockProject = { id: 'p1', workingDirectory: '/tmp/test', systemPrompt: 'You are helpful' };
    const mockSession = {
      id: 's1',
      projectId: 'p1',
      status: 'waiting',
      pendingPrompt: null,
      pendingModel: null,
      model: null,
      gitWorktree: null,
    };
    const mockConversation = { id: 'c1', sessionId: 's1' };
    const mockMessage = { id: 'm1', role: 'user', content: 'Hello' };

    beforeEach(() => {
      projects.getById.mockReturnValue(mockProject);
      conversations.getActiveBySessionId.mockReturnValue(mockConversation);
      attachments.getBySessionId.mockReturnValue([]);
      sessions.update.mockReturnValue({ ...mockSession, status: 'starting' });
      sessions.getById.mockReturnValue({ ...mockSession, status: 'starting' });
    });

    it('throws DraftSessionError with 404 when project not found', async () => {
      projects.getById.mockReturnValue(null);

      await expect(startDraft(mockSession))
        .rejects.toThrow(DraftSessionError);

      try {
        await startDraft(mockSession);
      } catch (error) {
        expect(error.statusCode).toBe(404);
        expect(error.message).toBe('Project not found');
      }
    });

    it('creates initial message from pendingPrompt when no user messages exist', async () => {
      messages.getBySessionId.mockReturnValue([]);
      const sessionWithPending = { ...mockSession, pendingPrompt: 'My pending prompt' };
      messages.create.mockReturnValue({ id: 'new-m1', role: 'user', content: 'My pending prompt' });

      await startDraft(sessionWithPending);

      expect(messages.create).toHaveBeenCalledWith(
        's1', 'user', 'My pending prompt', null, 'c1'
      );
      expect(sessions.update).toHaveBeenCalledWith('s1', { pendingPrompt: null });
    });

    it('creates initial message from options.prompt when provided and no user messages exist', async () => {
      messages.getBySessionId.mockReturnValue([]);
      const sessionWithPending = { ...mockSession, pendingPrompt: 'fallback' };
      messages.create.mockReturnValue({ id: 'new-m1', role: 'user', content: 'explicit prompt' });

      await startDraft(sessionWithPending, { prompt: 'explicit prompt' });

      expect(messages.create).toHaveBeenCalledWith(
        's1', 'user', 'explicit prompt', null, 'c1'
      );
    });

    it('throws DraftSessionError with 400 when no prompt available and no user messages', async () => {
      messages.getBySessionId.mockReturnValue([]);

      await expect(startDraft(mockSession))
        .rejects.toThrow(DraftSessionError);

      try {
        await startDraft(mockSession);
      } catch (error) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('No initial prompt found');
      }
    });

    it('throws DraftSessionError with 500 when no active conversation found', async () => {
      messages.getBySessionId.mockReturnValue([]);
      conversations.getActiveBySessionId.mockReturnValue(null);
      const sessionWithPending = { ...mockSession, pendingPrompt: 'Some prompt' };

      await expect(startDraft(sessionWithPending))
        .rejects.toThrow(DraftSessionError);

      try {
        await startDraft(sessionWithPending);
      } catch (error) {
        expect(error.statusCode).toBe(500);
        expect(error.message).toBe('No active conversation found');
      }
    });

    it('uses existing user message when messages already exist', async () => {
      messages.getBySessionId.mockReturnValue([mockMessage]);

      await startDraft(mockSession);

      expect(messages.create).not.toHaveBeenCalled();
      expect(sessions.update).toHaveBeenCalledWith('s1', {
        status: 'starting',
        pendingModel: null,
      });
    });

    it('updates existing user message when options.prompt is provided and messages exist', async () => {
      messages.getBySessionId.mockReturnValue([mockMessage]);
      const updatedMsg = { ...mockMessage, content: 'Updated prompt' };
      messages.updateContent.mockReturnValue(updatedMsg);

      await startDraft(mockSession, { prompt: 'Updated prompt' });

      expect(messages.updateContent).toHaveBeenCalledWith('m1', 'Updated prompt');
    });

    it('throws DraftSessionError with 400 when prompt option is empty string', async () => {
      messages.getBySessionId.mockReturnValue([mockMessage]);

      await expect(startDraft(mockSession, { prompt: '' }))
        .rejects.toThrow(DraftSessionError);

      try {
        await startDraft(mockSession, { prompt: '' });
      } catch (error) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toBe('Prompt must be a non-empty string');
      }
    });

    it('uses model fallback chain: options.model > pendingModel > session.model', async () => {
      messages.getBySessionId.mockReturnValue([mockMessage]);

      const sessionWithModel = {
        ...mockSession,
        pendingModel: 'claude-3-haiku',
        model: 'claude-3-sonnet',
      };

      // options.model takes priority
      await startDraft(sessionWithModel, { model: 'claude-3-opus' });

      // The runSession call should get the model from options
      const { runSession } = await import('./sessionManager.js');
      const lastCallArgs = runSession.mock.calls[runSession.mock.calls.length - 1];
      expect(lastCallArgs[5]).toBe('claude-3-opus');
    });

    it('uses gitWorktree as working directory when set', async () => {
      messages.getBySessionId.mockReturnValue([mockMessage]);

      const sessionWithWorktree = {
        ...mockSession,
        gitWorktree: '/tmp/worktree',
      };

      await startDraft(sessionWithWorktree);

      const { runSession } = await import('./sessionManager.js');
      const lastCallArgs = runSession.mock.calls[runSession.mock.calls.length - 1];
      expect(lastCallArgs[2]).toBe('/tmp/worktree');
    });

    it('returns updated session', async () => {
      messages.getBySessionId.mockReturnValue([mockMessage]);

      const result = await startDraft(mockSession);

      expect(result).toEqual({ ...mockSession, status: 'starting' });
    });
  });

  describe('DraftSessionError', () => {
    it('has correct name', () => {
      const error = new DraftSessionError('test', 400);
      expect(error.name).toBe('DraftSessionError');
    });

    it('carries statusCode', () => {
      const error = new DraftSessionError('not found', 404);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe('not found');
    });

    it('is an instance of Error', () => {
      const error = new DraftSessionError('test', 400);
      expect(error).toBeInstanceOf(Error);
    });
  });
});
