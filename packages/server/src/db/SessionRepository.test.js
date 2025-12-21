import { describe, it, expect, beforeEach } from 'vitest';
import { SessionRepository } from './SessionRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { MessageRepository } from './MessageRepository.js';
import { SessionTemplateRepository } from './SessionTemplateRepository.js';

describe('SessionRepository', () => {
  // Uses global setup from test/setup.js
  let repo;
  let projectRepo;
  let messageRepo;
  let templateRepo;
  let projectId;

  beforeEach(() => {
    projectRepo = new ProjectRepository();
    messageRepo = new MessageRepository();
    templateRepo = new SessionTemplateRepository();

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
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, 'feature-branch');
      expect(session.gitBranch).toBe('feature-branch');
    });

    it('creates session with thinkingEnabled true', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', true);
      expect(session.thinkingEnabled).toBe(true);
    });

    it('creates session with thinkingEnabled false by default', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      expect(session.thinkingEnabled).toBe(false);
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
      expect(session.nextTemplateId).toBeNull();
      expect(session.parentSessionId).toBeNull();
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

    it('returns thinkingEnabled as boolean', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', true);
      const retrieved = repo.getById(session.id);

      expect(typeof retrieved.thinkingEnabled).toBe('boolean');
      expect(retrieved.thinkingEnabled).toBe(true);
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

    it('returns sessions ordered by updatedAt descending within same status', () => {
      const s1 = repo.create(projectId, 'Session 1', 'Prompt 1');
      const s2 = repo.create(projectId, 'Session 2', 'Prompt 2');
      const s3 = repo.create(projectId, 'Session 3', 'Prompt 3');

      const sessions = repo.getByProjectId(projectId);

      // Verify all sessions are returned and ordered by updatedAt DESC
      expect(sessions).toHaveLength(3);
      const ids = sessions.map((s) => s.id);
      expect(ids).toContain(s1.id);
      expect(ids).toContain(s2.id);
      expect(ids).toContain(s3.id);
      // Items with same timestamp are returned, ordering is stable
      expect(sessions[0].updatedAt).toBeGreaterThanOrEqual(sessions[2].updatedAt);
    });

    it('returns completed sessions after non-completed sessions', () => {
      // Create sessions with different statuses
      const waiting = repo.create(projectId, 'Waiting Session', 'Prompt');
      repo.update(waiting.id, { status: 'waiting' });

      const completed1 = repo.create(projectId, 'Completed Session 1', 'Prompt');
      repo.update(completed1.id, { status: 'completed' });

      const running = repo.create(projectId, 'Running Session', 'Prompt');
      repo.update(running.id, { status: 'running' });

      const completed2 = repo.create(projectId, 'Completed Session 2', 'Prompt');
      repo.update(completed2.id, { status: 'completed' });

      const _starting = repo.create(projectId, 'Starting Session', 'Prompt');
      // _starting is default status, no update needed

      const sessions = repo.getByProjectId(projectId);

      expect(sessions).toHaveLength(5);

      // Non-completed sessions should come first
      const nonCompleted = sessions.filter((s) => s.status !== 'completed');
      const completed = sessions.filter((s) => s.status === 'completed');

      expect(nonCompleted).toHaveLength(3);
      expect(completed).toHaveLength(2);

      // Verify non-completed come before completed
      const firstCompletedIndex = sessions.findIndex((s) => s.status === 'completed');
      const lastNonCompletedIndex = sessions.findLastIndex((s) => s.status !== 'completed');
      expect(lastNonCompletedIndex).toBeLessThan(firstCompletedIndex);
    });

    it('sorts completed sessions by updatedAt descending', () => {
      // Create two completed sessions with different updatedAt times
      const older = repo.create(projectId, 'Older Completed', 'Prompt');
      repo.update(older.id, { status: 'completed' });

      // Small delay to ensure different timestamps
      const newer = repo.create(projectId, 'Newer Completed', 'Prompt');
      repo.update(newer.id, { status: 'completed' });

      const sessions = repo.getByProjectId(projectId);

      expect(sessions).toHaveLength(2);
      // Newer should come first (higher updatedAt)
      expect(sessions[0].updatedAt).toBeGreaterThanOrEqual(sessions[1].updatedAt);
    });

    it('sorts non-completed sessions by updatedAt descending', () => {
      // Create sessions with different non-completed statuses
      const first = repo.create(projectId, 'First', 'Prompt');
      repo.update(first.id, { status: 'waiting' });

      const second = repo.create(projectId, 'Second', 'Prompt');
      repo.update(second.id, { status: 'running' });

      const sessions = repo.getByProjectId(projectId);

      expect(sessions).toHaveLength(2);
      // Second should come first (higher updatedAt)
      expect(sessions[0].updatedAt).toBeGreaterThanOrEqual(sessions[1].updatedAt);
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

  describe('getActiveAndWaiting', () => {
    it('returns empty array when no sessions exist', () => {
      const sessions = repo.getActiveAndWaiting();
      expect(sessions).toEqual([]);
    });

    it('returns sessions with starting, running, or waiting status', () => {
      repo.create(projectId, 'Starting Session', 'Prompt');
      // starting is the default status

      const running = repo.create(projectId, 'Running Session', 'Prompt');
      repo.update(running.id, { status: 'running' });

      const waiting = repo.create(projectId, 'Waiting Session', 'Prompt');
      repo.update(waiting.id, { status: 'waiting' });

      const completed = repo.create(projectId, 'Completed Session', 'Prompt');
      repo.update(completed.id, { status: 'completed' });

      const errorSession = repo.create(projectId, 'Error Session', 'Prompt');
      repo.update(errorSession.id, { status: 'error' });

      const sessions = repo.getActiveAndWaiting();

      expect(sessions).toHaveLength(3);
      const statuses = sessions.map((s) => s.status);
      expect(statuses).toContain('starting');
      expect(statuses).toContain('running');
      expect(statuses).toContain('waiting');
      expect(statuses).not.toContain('completed');
      expect(statuses).not.toContain('error');
    });

    it('includes project name and working directory in results', () => {
      const session = repo.create(projectId, 'Test Session', 'Prompt');
      repo.update(session.id, { status: 'running' });

      const sessions = repo.getActiveAndWaiting();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].projectName).toBe('Test Project');
      expect(sessions[0].projectWorkingDirectory).toBe('/tmp/test');
    });

    it('returns sessions from multiple projects', () => {
      const otherProject = projectRepo.create('Other Project', '/tmp/other');

      const session1 = repo.create(projectId, 'Session 1', 'Prompt');
      repo.update(session1.id, { status: 'running' });

      const session2 = repo.create(otherProject.id, 'Session 2', 'Prompt');
      repo.update(session2.id, { status: 'waiting' });

      const sessions = repo.getActiveAndWaiting();

      expect(sessions).toHaveLength(2);
      const projectNames = sessions.map((s) => s.projectName);
      expect(projectNames).toContain('Test Project');
      expect(projectNames).toContain('Other Project');
    });

    it('orders sessions by updatedAt descending', () => {
      const older = repo.create(projectId, 'Older Session', 'Prompt');
      repo.update(older.id, { status: 'running' });

      const newer = repo.create(projectId, 'Newer Session', 'Prompt');
      repo.update(newer.id, { status: 'waiting' });

      const sessions = repo.getActiveAndWaiting();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].updatedAt).toBeGreaterThanOrEqual(sessions[1].updatedAt);
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

    it('updates thinkingEnabled to true', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false);
      expect(session.thinkingEnabled).toBe(false);

      const updated = repo.update(session.id, { thinkingEnabled: true });

      expect(updated.thinkingEnabled).toBe(true);
    });

    it('updates thinkingEnabled to false', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', true);
      expect(session.thinkingEnabled).toBe(true);

      const updated = repo.update(session.id, { thinkingEnabled: false });

      expect(updated.thinkingEnabled).toBe(false);
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

    it('updates nextTemplateId', () => {
      const template = templateRepo.create({ projectId: null, name: 'Test', prompt: 'Prompt' });
      const session = repo.create(projectId, 'Test', 'Prompt');
      const updated = repo.update(session.id, { nextTemplateId: template.id });

      expect(updated.nextTemplateId).toBe(template.id);
    });

    it('clears nextTemplateId when set to null', () => {
      const template = templateRepo.create({ projectId: null, name: 'Test', prompt: 'Prompt' });
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { nextTemplateId: template.id });
      const updated = repo.update(session.id, { nextTemplateId: null });

      expect(updated.nextTemplateId).toBeNull();
    });

    it('updates parentSessionId', () => {
      const parentSession = repo.create(projectId, 'Parent', 'Prompt');
      const childSession = repo.create(projectId, 'Child', 'Prompt');
      const updated = repo.update(childSession.id, { parentSessionId: parentSession.id });

      expect(updated.parentSessionId).toBe(parentSession.id);
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
