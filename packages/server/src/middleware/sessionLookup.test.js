import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requireSession, requireSessionAndProject } from './sessionLookup.js';
import { sessions, projects } from '../database.js';

// Mock the database
vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
  },
  projects: {
    getById: vi.fn(),
  },
}));

describe('sessionLookup middleware', () => {
  let mockReq, mockRes, mockNext;

  beforeEach(() => {
    mockReq = {
      params: { id: 'session-123' },
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    mockNext = vi.fn();
    vi.clearAllMocks();
  });

  describe('requireSession', () => {
    it('should attach session to req.session_ and call next when session exists', () => {
      const mockSession = { id: 'session-123', name: 'Test Session' };
      sessions.getById.mockReturnValue(mockSession);

      requireSession(mockReq, mockRes, mockNext);

      expect(sessions.getById).toHaveBeenCalledWith('session-123');
      expect(mockReq.session_).toEqual(mockSession);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 404 when session not found', () => {
      sessions.getById.mockReturnValue(null);

      requireSession(mockReq, mockRes, mockNext);

      expect(sessions.getById).toHaveBeenCalledWith('session-123');
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Session not found' });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockReq.session_).toBeUndefined();
    });

    it('should use the session id from req.params.id', () => {
      const mockSession = { id: 'different-id', name: 'Different Session' };
      sessions.getById.mockReturnValue(mockSession);
      mockReq.params.id = 'different-id';

      requireSession(mockReq, mockRes, mockNext);

      expect(sessions.getById).toHaveBeenCalledWith('different-id');
      expect(mockReq.session_).toEqual(mockSession);
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('requireSessionAndProject', () => {
    const mockProject = {
      id: 'project-456',
      name: 'Test Project',
      workingDirectory: '/path/to/project',
    };

    const mockSession = {
      id: 'session-123',
      name: 'Test Session',
      projectId: 'project-456',
    };

    it('should attach session, project, and workingDirectory to req and call next when both exist', () => {
      sessions.getById.mockReturnValue(mockSession);
      projects.getById.mockReturnValue(mockProject);

      requireSessionAndProject(mockReq, mockRes, mockNext);

      expect(sessions.getById).toHaveBeenCalledWith('session-123');
      expect(projects.getById).toHaveBeenCalledWith('project-456');
      expect(mockReq.session_).toEqual(mockSession);
      expect(mockReq.project).toEqual(mockProject);
      expect(mockReq.workingDirectory).toBe(mockProject.workingDirectory);
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 404 when session not found', () => {
      sessions.getById.mockReturnValue(null);

      requireSessionAndProject(mockReq, mockRes, mockNext);

      expect(sessions.getById).toHaveBeenCalledWith('session-123');
      expect(projects.getById).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Session not found' });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockReq.session_).toBeUndefined();
      expect(mockReq.project).toBeUndefined();
      expect(mockReq.workingDirectory).toBeUndefined();
    });

    it('should return 404 when project not found', () => {
      sessions.getById.mockReturnValue(mockSession);
      projects.getById.mockReturnValue(null);

      requireSessionAndProject(mockReq, mockRes, mockNext);

      expect(sessions.getById).toHaveBeenCalledWith('session-123');
      expect(projects.getById).toHaveBeenCalledWith('project-456');
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Project not found' });
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockReq.session_).toBeUndefined();
      expect(mockReq.project).toBeUndefined();
      expect(mockReq.workingDirectory).toBeUndefined();
    });

    it('should use gitWorktree when session has one', () => {
      const sessionWithWorktree = {
        ...mockSession,
        gitWorktree: '/path/to/worktree',
      };

      sessions.getById.mockReturnValue(sessionWithWorktree);
      projects.getById.mockReturnValue(mockProject);

      requireSessionAndProject(mockReq, mockRes, mockNext);

      expect(mockReq.workingDirectory).toBe('/path/to/worktree');
      expect(mockNext).toHaveBeenCalled();
    });

    it('should use project workingDirectory when session has no gitWorktree', () => {
      sessions.getById.mockReturnValue(mockSession);
      projects.getById.mockReturnValue(mockProject);

      requireSessionAndProject(mockReq, mockRes, mockNext);

      expect(mockReq.workingDirectory).toBe('/path/to/project');
      expect(mockNext).toHaveBeenCalled();
    });
  });
});
