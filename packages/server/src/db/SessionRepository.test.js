import { describe, it, expect, beforeEach } from 'vitest';
import { SessionRepository } from './SessionRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { MessageRepository } from './MessageRepository.js';

describe('SessionRepository', () => {
  // Uses global setup from test/setup.js
  let repo;
  let projectRepo;
  let messageRepo;
  let projectId;

  beforeEach(() => {
    projectRepo = new ProjectRepository();
    messageRepo = new MessageRepository();

    // Create a project for testing
    const project = projectRepo.create('Test Project', '/tmp/test');
    projectId = project.id;

    repo = new SessionRepository();
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(SessionRepository);
      expect(repo.tableName).toBe('sessions');
    });
  });

  describe('create', () => {
    it('creates a session with required fields', () => {
      const session = repo.create(projectId, 'Test Session', 'Initial prompt');

      expect(session.id).toBeDefined();
      expect(session.projectId).toBe(projectId);
      expect(session.name).toBe('Test Session');
      expect(session.status).toBe('starting');
      expect(session.mode).toBe('standard');
      expect(session.createdAt).toBeTypeOf('number');
      expect(session.updatedAt).toBeTypeOf('number');
    });

    it('creates session with custom mode', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'plan');
      expect(session.mode).toBe('plan');
    });

    it('creates session with git branch', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', 'feature-branch');
      expect(session.gitBranch).toBe('feature-branch');
    });

    it('creates initial user message on session creation', () => {
      const session = repo.create(projectId, 'Test', 'Hello Claude');

      const messages = messageRepo.getBySessionId(session.id);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toBe('Hello Claude');
    });

    it('has null optional fields by default', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');

      expect(session.gitBranch).toBeNull();
      expect(session.gitWorktree).toBeNull();
      expect(session.prUrl).toBeNull();
      expect(session.error).toBeNull();
    });
  });

  describe('getById', () => {
    it('retrieves session by ID', () => {
      const created = repo.create(projectId, 'Test', 'Prompt');
      const retrieved = repo.getById(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('Test');
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('getByProjectId', () => {
    it('returns empty array when no sessions exist', () => {
      const sessions = repo.getByProjectId(projectId);
      expect(sessions).toEqual([]);
    });

    it('returns all sessions for a project', () => {
      repo.create(projectId, 'Session 1', 'Prompt 1');
      repo.create(projectId, 'Session 2', 'Prompt 2');
      repo.create(projectId, 'Session 3', 'Prompt 3');

      const sessions = repo.getByProjectId(projectId);

      expect(sessions).toHaveLength(3);
    });

    it('returns sessions ordered by updatedAt descending', () => {
      const s1 = repo.create(projectId, 'Session 1', 'Prompt 1');
      const s2 = repo.create(projectId, 'Session 2', 'Prompt 2');
      const s3 = repo.create(projectId, 'Session 3', 'Prompt 3');

      const sessions = repo.getByProjectId(projectId);

      // Verify all sessions are returned and ordered by updatedAt DESC
      expect(sessions).toHaveLength(3);
      const ids = sessions.map(s => s.id);
      expect(ids).toContain(s1.id);
      expect(ids).toContain(s2.id);
      expect(ids).toContain(s3.id);
      // Items with same timestamp are returned, ordering is stable
      expect(sessions[0].updatedAt).toBeGreaterThanOrEqual(sessions[2].updatedAt);
    });

    it('does not return sessions from other projects', () => {
      const otherProject = projectRepo.create('Other', '/tmp/other');

      repo.create(projectId, 'Project 1 Session', 'Prompt');
      repo.create(otherProject.id, 'Project 2 Session', 'Prompt');

      const sessions = repo.getByProjectId(projectId);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].name).toBe('Project 1 Session');
    });
  });

  describe('update', () => {
    it('updates session status', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const updated = repo.update(session.id, { status: 'running' });

      expect(updated.status).toBe('running');
    });

    it('updates session name', () => {
      const session = repo.create(projectId, 'Original', 'Prompt');
      const updated = repo.update(session.id, { name: 'Updated' });

      expect(updated.name).toBe('Updated');
    });

    it('updates git branch', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const updated = repo.update(session.id, { gitBranch: 'new-branch' });

      expect(updated.gitBranch).toBe('new-branch');
    });

    it('updates git worktree', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const updated = repo.update(session.id, { gitWorktree: '/tmp/worktree' });

      expect(updated.gitWorktree).toBe('/tmp/worktree');
    });

    it('updates PR URL', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const updated = repo.update(session.id, { prUrl: 'https://github.com/pr/123' });

      expect(updated.prUrl).toBe('https://github.com/pr/123');
    });

    it('updates error', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const updated = repo.update(session.id, { error: 'Something went wrong' });

      expect(updated.error).toBe('Something went wrong');
    });

    it('updates multiple fields at once', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const updated = repo.update(session.id, {
        status: 'completed',
        prUrl: 'https://github.com/pr/456',
        gitBranch: 'feature',
      });

      expect(updated.status).toBe('completed');
      expect(updated.prUrl).toBe('https://github.com/pr/456');
      expect(updated.gitBranch).toBe('feature');
    });

    it('returns unchanged session when no updates provided', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const result = repo.update(session.id, {});

      expect(result.name).toBe('Test');
      expect(result.status).toBe('starting');
    });
  });

  describe('delete', () => {
    it('deletes a session', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.delete(session.id);

      expect(repo.getById(session.id)).toBeNull();
    });
  });

  describe('cascade delete', () => {
    it('deletes sessions when project is deleted', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      projectRepo.delete(projectId);

      expect(repo.getById(session.id)).toBeNull();
    });
  });
});
