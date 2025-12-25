import { describe, it, expect, beforeEach } from 'vitest';
import { SessionRepository } from './SessionRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { MessageRepository } from './MessageRepository.js';
import { ConversationRepository } from './ConversationRepository.js';
import { SessionTemplateRepository } from './SessionTemplateRepository.js';

describe('SessionRepository', () => {
  // Uses global setup from test/setup.js
  let repo;
  let projectRepo;
  let messageRepo;
  let conversationRepo;
  let templateRepo;
  let projectId;

  beforeEach(() => {
    projectRepo = new ProjectRepository();
    messageRepo = new MessageRepository();
    conversationRepo = new ConversationRepository();
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

    it('creates initial conversation on session creation', () => {
      const session = repo.create(projectId, 'Test', 'Hello Claude');

      const conversations = conversationRepo.getBySessionId(session.id);

      expect(conversations).toHaveLength(1);
      expect(conversations[0].name).toBe('Initial');
      expect(conversations[0].isActive).toBe(true);
    });

    it('associates initial message with the initial conversation', () => {
      const session = repo.create(projectId, 'Test', 'Hello Claude');

      const conversations = conversationRepo.getBySessionId(session.id);
      expect(conversations).toHaveLength(1);

      const conversationMessages = messageRepo.getByConversationId(conversations[0].id);
      expect(conversationMessages).toHaveLength(1);
      expect(conversationMessages[0].role).toBe('user');
      expect(conversationMessages[0].content).toBe('Hello Claude');
    });

    it('has null optional fields by default', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');

      expect(session.gitBranch).toBeNull();
      expect(session.gitWorktree).toBeNull();
      expect(session.prUrl).toBeNull();
      expect(session.error).toBeNull();
      expect(session.nextTemplateId).toBeNull();
      expect(session.parentSessionId).toBeNull();
      expect(session.model).toBeNull();
    });

    it('creates session with model', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, 'claude-opus-4-5-20251101');
      expect(session.model).toBe('claude-opus-4-5-20251101');
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

    it('updates model', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      expect(session.model).toBeNull();

      const updated = repo.update(session.id, { model: 'claude-haiku-4-5-20251001' });

      expect(updated.model).toBe('claude-haiku-4-5-20251001');
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

  describe('getSessionsWithPrUrls', () => {
    it('returns empty array when no sessions have PR URLs', () => {
      repo.create(projectId, 'Session 1', 'Prompt 1');
      repo.create(projectId, 'Session 2', 'Prompt 2');

      const result = repo.getSessionsWithPrUrls();
      expect(result).toEqual([]);
    });

    it('returns only sessions that have PR URLs', () => {
      const session1 = repo.create(projectId, 'Session 1', 'Prompt 1');
      repo.create(projectId, 'Session 2', 'Prompt 2');
      const session3 = repo.create(projectId, 'Session 3', 'Prompt 3');

      // Set PR URL on session 1 and 3
      repo.update(session1.id, { prUrl: 'https://github.com/org/repo/pull/1' });
      repo.update(session3.id, { prUrl: 'https://github.com/org/repo/pull/3' });

      const result = repo.getSessionsWithPrUrls();
      expect(result).toHaveLength(2);
      expect(result.map(s => s.id)).toContain(session1.id);
      expect(result.map(s => s.id)).toContain(session3.id);
    });

    it('orders sessions by updated_at descending', () => {
      const session1 = repo.create(projectId, 'Session 1', 'Prompt 1');
      const session2 = repo.create(projectId, 'Session 2', 'Prompt 2');

      // Set PR URLs
      repo.update(session1.id, { prUrl: 'https://github.com/org/repo/pull/1' });
      // Update session2 after session1 so it has a later updated_at
      repo.update(session2.id, { prUrl: 'https://github.com/org/repo/pull/2' });

      const result = repo.getSessionsWithPrUrls();
      expect(result).toHaveLength(2);
      // Session 2 should be first because it was updated more recently
      expect(result[0].id).toBe(session2.id);
      expect(result[1].id).toBe(session1.id);
    });

    it('includes sessions from all projects', () => {
      const project2 = projectRepo.create('Project 2', '/tmp/project2');

      const session1 = repo.create(projectId, 'Session 1', 'Prompt 1');
      const session2 = repo.create(project2.id, 'Session 2', 'Prompt 2');

      repo.update(session1.id, { prUrl: 'https://github.com/org/repo1/pull/1' });
      repo.update(session2.id, { prUrl: 'https://github.com/org/repo2/pull/2' });

      const result = repo.getSessionsWithPrUrls();
      expect(result).toHaveLength(2);
      expect(result.map(s => s.projectId)).toContain(projectId);
      expect(result.map(s => s.projectId)).toContain(project2.id);
    });

    it('returns correct session properties', () => {
      const session = repo.create(projectId, 'Test Session', 'Prompt');
      repo.update(session.id, {
        prUrl: 'https://github.com/org/repo/pull/123',
        status: 'completed',
        gitBranch: 'feature/test',
      });

      const result = repo.getSessionsWithPrUrls();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: session.id,
        projectId: projectId,
        name: 'Test Session',
        prUrl: 'https://github.com/org/repo/pull/123',
        status: 'completed',
        gitBranch: 'feature/test',
      });
    });
  });

  describe('updateUsage', () => {
    it('updates all token usage fields', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');

      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
        webSearchRequests: 2,
        contextWindow: 200000,
      };

      const updated = repo.updateUsage(session.id, usage);

      expect(updated.inputTokens).toBe(1000);
      expect(updated.outputTokens).toBe(500);
      expect(updated.cacheReadInputTokens).toBe(200);
      expect(updated.cacheCreationInputTokens).toBe(100);
      expect(updated.webSearchRequests).toBe(2);
      expect(updated.contextWindow).toBe(200000);
    });

    it('updates usage with zero values', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');

      const usage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        contextWindow: 200000,
      };

      const updated = repo.updateUsage(session.id, usage);

      expect(updated.inputTokens).toBe(0);
      expect(updated.outputTokens).toBe(0);
      expect(updated.cacheReadInputTokens).toBe(0);
      expect(updated.cacheCreationInputTokens).toBe(0);
    });

    it('updates usage with large token counts', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');

      const usage = {
        inputTokens: 1500000,
        outputTokens: 500000,
        cacheReadInputTokens: 1000000,
        cacheCreationInputTokens: 50000,
        webSearchRequests: 10,
        contextWindow: 200000,
      };

      const updated = repo.updateUsage(session.id, usage);

      expect(updated.inputTokens).toBe(1500000);
      expect(updated.outputTokens).toBe(500000);
      expect(updated.cacheReadInputTokens).toBe(1000000);
    });

    it('updates updatedAt timestamp', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const originalUpdatedAt = session.updatedAt;

      // Small delay to ensure different timestamp
      const usage = {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        contextWindow: 200000,
      };

      const updated = repo.updateUsage(session.id, usage);

      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('returns updated session with all fields', () => {
      const session = repo.create(projectId, 'Test Session', 'Prompt');

      const usage = {
        inputTokens: 500,
        outputTokens: 250,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
        webSearchRequests: 1,
        contextWindow: 200000,
      };

      const updated = repo.updateUsage(session.id, usage);

      // Verify other fields are preserved
      expect(updated.id).toBe(session.id);
      expect(updated.name).toBe('Test Session');
      expect(updated.projectId).toBe(projectId);
      expect(updated.status).toBe('starting');
    });

    it('can be retrieved after update', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');

      const usage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
        webSearchRequests: 3,
        contextWindow: 200000,
      };

      repo.updateUsage(session.id, usage);

      // Retrieve and verify
      const retrieved = repo.getById(session.id);
      expect(retrieved.inputTokens).toBe(1000);
      expect(retrieved.outputTokens).toBe(500);
      expect(retrieved.cacheReadInputTokens).toBe(200);
      expect(retrieved.cacheCreationInputTokens).toBe(100);
      expect(retrieved.webSearchRequests).toBe(3);
    });
  });

  describe('token usage in getById', () => {
    it('returns default token usage values for new session', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const retrieved = repo.getById(session.id);

      expect(retrieved.inputTokens).toBe(0);
      expect(retrieved.outputTokens).toBe(0);
      expect(retrieved.cacheReadInputTokens).toBe(0);
      expect(retrieved.cacheCreationInputTokens).toBe(0);
      expect(retrieved.webSearchRequests).toBe(0);
      expect(retrieved.contextWindow).toBe(200000);
    });
  });

  describe('token usage in getByProjectId', () => {
    it('includes token usage in session list', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.updateUsage(session.id, {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
        webSearchRequests: 2,
        contextWindow: 200000,
      });

      const sessions = repo.getByProjectId(projectId);

      expect(sessions).toHaveLength(1);
      expect(sessions[0].inputTokens).toBe(1000);
      expect(sessions[0].outputTokens).toBe(500);
    });
  });

  describe('token usage in getActiveAndWaiting', () => {
    it('includes token usage in active sessions', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { status: 'running' });
      repo.updateUsage(session.id, {
        inputTokens: 750,
        outputTokens: 350,
        cacheReadInputTokens: 150,
        cacheCreationInputTokens: 75,
        webSearchRequests: 1,
        contextWindow: 200000,
      });

      const sessions = repo.getActiveAndWaiting();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].inputTokens).toBe(750);
      expect(sessions[0].outputTokens).toBe(350);
    });
  });
});
