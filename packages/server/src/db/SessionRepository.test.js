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

    it('creates session with effortLevel option', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, null, 'starting', null, { effortLevel: 'high' });
      expect(session.effortLevel).toBe('high');
    });

    it('creates session with effortLevel null by default', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      expect(session.effortLevel).toBeNull();
    });

    it('accepts all valid effortLevel values', () => {
      for (const effortLevel of ['low', 'medium', 'high', 'max', 'auto']) {
        const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, null, 'starting', null, { effortLevel });
        expect(session.effortLevel).toBe(effortLevel);
      }
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
      expect(session.pendingModel).toBeNull();
    });

    it('creates session with archived set to false', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      expect(session.archived).toBe(false);
    });

    it('creates session with starred set to false by default', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      expect(session.starred).toBe(false);
    });

    // New options object signature tests
    describe('options object signature', () => {
      it('creates session with options object containing mode', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', { mode: 'plan' });
        expect(session.mode).toBe('plan');
      });

      it('creates session with options object containing thinkingEnabled', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', { thinkingEnabled: true });
        expect(session.thinkingEnabled).toBe(true);
      });

      it('creates session with options object containing gitBranch', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', { gitBranch: 'feature-branch' });
        expect(session.gitBranch).toBe('feature-branch');
      });

      it('creates session with options object containing parentSessionId', () => {
        const parent = repo.create(projectId, 'Parent', 'Parent prompt');
        const child = repo.create(projectId, 'Child', 'Child prompt', { parentSessionId: parent.id });
        expect(child.parentSessionId).toBe(parent.id);
      });

      it('creates session with options object containing status', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', { status: 'waiting' });
        expect(session.status).toBe('waiting');
      });

      it('creates session with options object containing model', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', { model: 'claude-sonnet-4-5' });
        expect(session.model).toBe('claude-sonnet-4-5');
      });

      it('creates session with multiple options', () => {
        const parent = repo.create(projectId, 'Parent', 'Parent prompt');
        const session = repo.create(projectId, 'Test', 'Prompt', {
          mode: 'plan',
          thinkingEnabled: true,
          gitBranch: 'feature-branch',
          parentSessionId: parent.id,
          status: 'waiting',
          model: 'claude-sonnet-4-5',
        });

        expect(session.mode).toBe('plan');
        expect(session.thinkingEnabled).toBe(true);
        expect(session.gitBranch).toBe('feature-branch');
        expect(session.parentSessionId).toBe(parent.id);
        expect(session.status).toBe('waiting');
        expect(session.model).toBe('claude-sonnet-4-5');
      });

      it('creates session with empty options object', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', {});
        expect(session.mode).toBe('standard');
        expect(session.thinkingEnabled).toBe(false);
        expect(session.status).toBe('starting');
      });

      it('does not create initial message for waiting status sessions', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', { status: 'waiting' });
        const messages = messageRepo.getBySessionId(session.id);
        expect(messages).toHaveLength(0);
      });

      it('does not create initial message for scheduled status sessions', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', { status: 'scheduled' });
        const messages = messageRepo.getBySessionId(session.id);
        expect(messages).toHaveLength(0);
      });

      it('creates initial message for starting status sessions with options object', () => {
        const session = repo.create(projectId, 'Test', 'Hello', { status: 'starting' });
        const messages = messageRepo.getBySessionId(session.id);
        expect(messages).toHaveLength(1);
        expect(messages[0].content).toBe('Hello');
      });

      it('creates session with effortLevel in options object', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', { effortLevel: 'high' });
        expect(session.effortLevel).toBe('high');
      });

      it('creates session with null effortLevel in options object', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', { effortLevel: null });
        expect(session.effortLevel).toBeNull();
      });

      it('creates session with all options including effortLevel', () => {
        const parent = repo.create(projectId, 'Parent', 'Parent prompt');
        const session = repo.create(projectId, 'Test', 'Prompt', {
          mode: 'plan',
          thinkingEnabled: true,
          gitBranch: 'feature-branch',
          parentSessionId: parent.id,
          status: 'waiting',
          model: 'claude-sonnet-4-5',
          effortLevel: 'max',
        });

        expect(session.mode).toBe('plan');
        expect(session.thinkingEnabled).toBe(true);
        expect(session.gitBranch).toBe('feature-branch');
        expect(session.parentSessionId).toBe(parent.id);
        expect(session.status).toBe('waiting');
        expect(session.model).toBe('claude-sonnet-4-5');
        expect(session.effortLevel).toBe('max');
      });

      it('accepts all valid effortLevel values via options object', () => {
        for (const effortLevel of ['low', 'medium', 'high', 'max', 'auto']) {
          const session = repo.create(projectId, 'Test', 'Prompt', { effortLevel });
          expect(session.effortLevel).toBe(effortLevel);
        }
      });

      it('defaults effortLevel to null when not specified in options object', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', { mode: 'plan' });
        expect(session.effortLevel).toBeNull();
      });
    });

    // Backward compatibility tests for legacy positional parameters
    describe('backward compatibility with legacy positional parameters', () => {
      it('supports legacy call with mode as 4th parameter', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', 'plan');
        expect(session.mode).toBe('plan');
        expect(session.thinkingEnabled).toBe(false);
        expect(session.gitBranch).toBeNull();
      });

      it('supports legacy call with mode and thinkingEnabled', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', 'plan', true);
        expect(session.mode).toBe('plan');
        expect(session.thinkingEnabled).toBe(true);
      });

      it('supports legacy call with mode, thinkingEnabled, and gitBranch', () => {
        const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, 'feature-branch');
        expect(session.mode).toBe('standard');
        expect(session.thinkingEnabled).toBe(false);
        expect(session.gitBranch).toBe('feature-branch');
      });

      it('supports legacy call with all positional parameters', () => {
        const parent = repo.create(projectId, 'Parent', 'Parent prompt');
        const session = repo.create(projectId, 'Test', 'Prompt', 'plan', true, 'feature-branch', parent.id, 'waiting', 'claude-sonnet-4-5');

        expect(session.mode).toBe('plan');
        expect(session.thinkingEnabled).toBe(true);
        expect(session.gitBranch).toBe('feature-branch');
        expect(session.parentSessionId).toBe(parent.id);
        expect(session.status).toBe('waiting');
        expect(session.model).toBe('claude-sonnet-4-5');
      });

      it('creates initial message with legacy positional parameters for non-waiting status', () => {
        const session = repo.create(projectId, 'Test', 'Hello Claude', 'standard', false, null, null, 'starting');
        const messages = messageRepo.getBySessionId(session.id);
        expect(messages).toHaveLength(1);
        expect(messages[0].content).toBe('Hello Claude');
      });

      it('does not create initial message with legacy positional parameters for waiting status', () => {
        const session = repo.create(projectId, 'Test', 'Hello Claude', 'standard', false, null, null, 'waiting');
        const messages = messageRepo.getBySessionId(session.id);
        expect(messages).toHaveLength(0);
      });
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

    it('returns all sessions sorted by updatedAt descending regardless of status', () => {
      // Create sessions with different statuses
      const waiting = repo.create(projectId, 'Waiting Session', 'Prompt');
      repo.update(waiting.id, { status: 'waiting' });

      const stopped1 = repo.create(projectId, 'Stopped Session 1', 'Prompt');
      repo.update(stopped1.id, { status: 'stopped' });

      const running = repo.create(projectId, 'Running Session', 'Prompt');
      repo.update(running.id, { status: 'running' });

      const stopped2 = repo.create(projectId, 'Stopped Session 2', 'Prompt');
      repo.update(stopped2.id, { status: 'stopped' });

      const _starting = repo.create(projectId, 'Starting Session', 'Prompt');
      // _starting is default status, no update needed

      const sessions = repo.getByProjectId(projectId);

      expect(sessions).toHaveLength(5);

      // Sessions should be sorted by updatedAt descending (most recent first)
      for (let i = 0; i < sessions.length - 1; i++) {
        expect(sessions[i].updatedAt).toBeGreaterThanOrEqual(sessions[i + 1].updatedAt);
      }
    });

    it('sorts sessions by updatedAt descending', () => {
      // Create two sessions with different updatedAt times
      const older = repo.create(projectId, 'Older Session', 'Prompt');
      repo.update(older.id, { status: 'stopped' });

      // Small delay to ensure different timestamps
      const newer = repo.create(projectId, 'Newer Session', 'Prompt');
      repo.update(newer.id, { status: 'stopped' });

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

    it('filters by archived=false', () => {
      const session1 = repo.create(projectId, 'Active Session', 'Prompt');
      const session2 = repo.create(projectId, 'Archived Session', 'Prompt');
      repo.update(session2.id, { archived: true });

      const sessions = repo.getByProjectId(projectId, { archived: false });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session1.id);
    });

    it('filters by archived=true', () => {
      repo.create(projectId, 'Active Session', 'Prompt');
      const session2 = repo.create(projectId, 'Archived Session', 'Prompt');
      repo.update(session2.id, { archived: true });

      const sessions = repo.getByProjectId(projectId, { archived: true });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session2.id);
    });

    it('returns all sessions when archived filter is null', () => {
      repo.create(projectId, 'Active Session', 'Prompt');
      const session2 = repo.create(projectId, 'Archived Session', 'Prompt');
      repo.update(session2.id, { archived: true });

      const sessions = repo.getByProjectId(projectId, { archived: null });

      expect(sessions).toHaveLength(2);
    });

    it('returns all sessions when no filter option provided', () => {
      repo.create(projectId, 'Active Session', 'Prompt');
      const session2 = repo.create(projectId, 'Archived Session', 'Prompt');
      repo.update(session2.id, { archived: true });

      const sessions = repo.getByProjectId(projectId);

      expect(sessions).toHaveLength(2);
    });

    it('filters by starred=false', () => {
      const session1 = repo.create(projectId, 'Regular Session', 'Prompt');
      const session2 = repo.create(projectId, 'Starred Session', 'Prompt');
      repo.update(session2.id, { starred: true });

      const sessions = repo.getByProjectId(projectId, { starred: false });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session1.id);
    });

    it('filters by starred=true', () => {
      repo.create(projectId, 'Regular Session', 'Prompt');
      const session2 = repo.create(projectId, 'Starred Session', 'Prompt');
      repo.update(session2.id, { starred: true });

      const sessions = repo.getByProjectId(projectId, { starred: true });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session2.id);
      expect(sessions[0].starred).toBe(true);
    });

    it('returns all sessions when starred filter is null', () => {
      repo.create(projectId, 'Regular Session', 'Prompt');
      const session2 = repo.create(projectId, 'Starred Session', 'Prompt');
      repo.update(session2.id, { starred: true });

      const sessions = repo.getByProjectId(projectId, { starred: null });

      expect(sessions).toHaveLength(2);
    });

    it('combines archived and starred filters', () => {
      const starred = repo.create(projectId, 'Starred', 'Prompt');
      repo.update(starred.id, { starred: true });

      const archivedRegular = repo.create(projectId, 'Archived Regular', 'Prompt');
      repo.update(archivedRegular.id, { archived: true });

      const archivedStarred = repo.create(projectId, 'Archived Starred', 'Prompt');
      repo.update(archivedStarred.id, { archived: true, starred: true });

      // Non-archived, starred
      const sessions = repo.getByProjectId(projectId, { archived: false, starred: true });

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(starred.id);
    });

    it('sorts starred sessions first within the same status', () => {
      const regular = repo.create(projectId, 'Regular Session', 'Prompt');
      const starred = repo.create(projectId, 'Starred Session', 'Prompt');
      repo.update(starred.id, { starred: true });

      const sessions = repo.getByProjectId(projectId);

      expect(sessions).toHaveLength(2);
      // Starred session should come first
      expect(sessions[0].id).toBe(starred.id);
      expect(sessions[1].id).toBe(regular.id);
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

      const stopped = repo.create(projectId, 'Stopped Session', 'Prompt');
      repo.update(stopped.id, { status: 'stopped' });

      const errorSession = repo.create(projectId, 'Error Session', 'Prompt');
      repo.update(errorSession.id, { status: 'error' });

      const sessions = repo.getActiveAndWaiting();

      expect(sessions).toHaveLength(3);
      const statuses = sessions.map((s) => s.status);
      expect(statuses).toContain('starting');
      expect(statuses).toContain('running');
      expect(statuses).toContain('waiting');
      expect(statuses).not.toContain('stopped');
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

    it('excludes archived sessions', () => {
      const running = repo.create(projectId, 'Running Session', 'Prompt');
      repo.update(running.id, { status: 'running' });

      const archivedRunning = repo.create(projectId, 'Archived Running', 'Prompt');
      repo.update(archivedRunning.id, { status: 'running', archived: true });

      const sessions = repo.getActiveAndWaiting();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(running.id);
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

    it('updates effortLevel', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      expect(session.effortLevel).toBeNull();

      const updated = repo.update(session.id, { effortLevel: 'high' });

      expect(updated.effortLevel).toBe('high');
    });

    it('updates effortLevel from one value to another', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, null, 'starting', null, { effortLevel: 'low' });
      expect(session.effortLevel).toBe('low');

      const updated = repo.update(session.id, { effortLevel: 'max' });

      expect(updated.effortLevel).toBe('max');
    });

    it('updates effortLevel to null', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, null, 'starting', null, { effortLevel: 'high' });
      expect(session.effortLevel).toBe('high');

      const updated = repo.update(session.id, { effortLevel: null });

      expect(updated.effortLevel).toBeNull();
    });

    it('updates multiple fields at once', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const updated = repo.update(session.id, {
        status: 'stopped',
        prUrl: 'https://github.com/pr/456',
        gitBranch: 'feature',
      });

      expect(updated.status).toBe('stopped');
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

    it('updates archived to true', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      expect(session.archived).toBe(false);

      const updated = repo.update(session.id, { archived: true });

      expect(updated.archived).toBe(true);
    });

    it('updates archived to false', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { archived: true });

      const updated = repo.update(session.id, { archived: false });

      expect(updated.archived).toBe(false);
    });

    it('updates starred to true', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      expect(session.starred).toBe(false);

      const updated = repo.update(session.id, { starred: true });

      expect(updated.starred).toBe(true);
    });

    it('updates starred to false', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { starred: true });

      const updated = repo.update(session.id, { starred: false });

      expect(updated.starred).toBe(false);
    });

    it('defaults manuallyNamed to false', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      expect(session.manuallyNamed).toBe(false);
    });

    it('updates manuallyNamed to true', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      expect(session.manuallyNamed).toBe(false);

      const updated = repo.update(session.id, { manuallyNamed: true });

      expect(updated.manuallyNamed).toBe(true);
    });

    it('updates manuallyNamed back to false', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { manuallyNamed: true });

      const updated = repo.update(session.id, { manuallyNamed: false });

      expect(updated.manuallyNamed).toBe(false);
    });

    it('preserves manuallyNamed when updating other fields', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { manuallyNamed: true });

      const updated = repo.update(session.id, { status: 'running' });

      expect(updated.manuallyNamed).toBe(true);
      expect(updated.status).toBe('running');
    });

    it('updates pendingModel', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const updated = repo.update(session.id, { pendingModel: 'claude-sonnet-4-5' });

      expect(updated.pendingModel).toBe('claude-sonnet-4-5');
    });

    it('clears pendingModel when set to null', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { pendingModel: 'claude-opus-4-5' });
      const updated = repo.update(session.id, { pendingModel: null });

      expect(updated.pendingModel).toBeNull();
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
        status: 'stopped',
        gitBranch: 'feature/test',
      });

      const result = repo.getSessionsWithPrUrls();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: session.id,
        projectId,
        name: 'Test Session',
        prUrl: 'https://github.com/org/repo/pull/123',
        status: 'stopped',
        gitBranch: 'feature/test',
      });
    });
  });

  describe('parent-child relationships', () => {
    it('creates a session with a parent', () => {
      const parentSession = repo.create(projectId, 'Parent', 'Parent prompt');
      const childSession = repo.create(projectId, 'Child', 'Child prompt', 'standard', false, null, parentSession.id);

      expect(childSession.parentSessionId).toBe(parentSession.id);
    });

    it('allows creating parent session without parentSessionId', () => {
      const session = repo.create(projectId, 'Parent', 'Parent prompt');
      expect(session.parentSessionId).toBeNull();
    });

    it('getChildSessions returns all children of a parent', () => {
      const parent = repo.create(projectId, 'Parent', 'Parent prompt');
      const child1 = repo.create(projectId, 'Child 1', 'Prompt 1', 'standard', false, null, parent.id);
      const child2 = repo.create(projectId, 'Child 2', 'Prompt 2', 'standard', false, null, parent.id);
      const orphan = repo.create(projectId, 'Orphan', 'Orphan prompt');

      const children = repo.getChildSessions(parent.id);

      expect(children).toHaveLength(2);
      expect(children.map(c => c.id)).toContain(child1.id);
      expect(children.map(c => c.id)).toContain(child2.id);
      expect(children.map(c => c.id)).not.toContain(orphan.id);
      expect(children.map(c => c.id)).not.toContain(parent.id);
    });

    it('getChildSessions returns empty array for parent with no children', () => {
      const parent = repo.create(projectId, 'Parent', 'Parent prompt');
      const children = repo.getChildSessions(parent.id);
      expect(children).toEqual([]);
    });

    it('update can set parentSessionId', () => {
      const parent = repo.create(projectId, 'Parent', 'Parent prompt');
      const child = repo.create(projectId, 'Child', 'Child prompt');

      repo.update(child.id, { parentSessionId: parent.id });
      const updated = repo.getById(child.id);

      expect(updated.parentSessionId).toBe(parent.id);
    });

    it('children are ordered by updatedAt DESC when fetched', async () => {
      const parent = repo.create(projectId, 'Parent', 'Parent prompt');
      const child1 = repo.create(projectId, 'Child 1', 'Prompt 1', 'standard', false, null, parent.id);

      // Wait to ensure different millisecond timestamps
      await new Promise((resolve) => setTimeout(resolve, 2));

      const child2 = repo.create(projectId, 'Child 2', 'Prompt 2', 'standard', false, null, parent.id);

      // Wait again before update to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 2));

      // Update child1 to be more recent (happens after child2 is created)
      repo.update(child1.id, { status: 'stopped' });

      const children = repo.getChildSessions(parent.id);

      expect(children[0].id).toBe(child1.id);
      expect(children[1].id).toBe(child2.id);
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

  describe('duplicate', () => {
    it('should create a new session with same settings', () => {
      const original = repo.create(projectId, 'Original Session', 'Prompt', 'plan', true);

      const duplicate = repo.duplicate(original.id);

      expect(duplicate.id).not.toBe(original.id);
      expect(duplicate.name).toBe('Original Session (Copy)');
      expect(duplicate.mode).toBe('plan');
      expect(duplicate.thinkingEnabled).toBe(true);
      expect(duplicate.projectId).toBe(projectId);
    });

    it('should reset status to waiting', () => {
      const original = repo.create(projectId, 'Test', 'Prompt');
      repo.update(original.id, { status: 'stopped' });

      const duplicate = repo.duplicate(original.id);

      expect(duplicate.status).toBe('waiting');
    });

    it('should preserve token counts and cost', () => {
      const original = repo.create(projectId, 'Test', 'Prompt');
      repo.updateUsage(original.id, {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 200,
        cacheCreationInputTokens: 100,
        webSearchRequests: 3,
        contextWindow: 200000,
      });
      repo.update(original.id, { costUsd: 0.05 });

      const duplicate = repo.duplicate(original.id);

      expect(duplicate.inputTokens).toBe(1000);
      expect(duplicate.outputTokens).toBe(500);
      expect(duplicate.cacheReadInputTokens).toBe(200);
      expect(duplicate.cacheCreationInputTokens).toBe(100);
      expect(duplicate.webSearchRequests).toBe(3);
      expect(duplicate.costUsd).toBe(0.05);
    });

    it('should copy gitBranch but not gitWorktree', () => {
      const original = repo.create(projectId, 'Test', 'Prompt', 'standard', false, 'feature-branch');
      repo.update(original.id, { gitWorktree: '/path/.worktrees/original-id' });

      const duplicate = repo.duplicate(original.id);

      expect(duplicate.gitBranch).toBe('feature-branch');
      expect(duplicate.gitWorktree).toBeNull();
    });

    it('should allow custom name override', () => {
      const original = repo.create(projectId, 'Original', 'Prompt');

      const duplicate = repo.duplicate(original.id, { name: 'My Custom Name' });

      expect(duplicate.name).toBe('My Custom Name');
    });

    it('should throw error for non-existent session', () => {
      expect(() => repo.duplicate('non-existent-id')).toThrow('Session not found: non-existent-id');
    });

    it('should generate new timestamps', () => {
      const original = repo.create(projectId, 'Test', 'Prompt');

      const duplicate = repo.duplicate(original.id);

      // Timestamps should be created (not null) and equal or newer than original
      expect(duplicate.createdAt).toBeGreaterThanOrEqual(original.createdAt);
      expect(duplicate.updatedAt).toBeGreaterThanOrEqual(duplicate.createdAt);
      expect(duplicate.createdAt).toBeTypeOf('number');
      expect(duplicate.updatedAt).toBeTypeOf('number');
    });

    it('should not copy error, prUrl, or claudeSessionId', () => {
      const original = repo.create(projectId, 'Test', 'Prompt');
      repo.update(original.id, {
        error: 'Some error',
        prUrl: 'https://github.com/pr/123',
        claudeSessionId: 'claude-session-xyz',
      });

      const duplicate = repo.duplicate(original.id);

      expect(duplicate.error).toBeNull();
      expect(duplicate.prUrl).toBeNull();
      expect(duplicate.claudeSessionId).toBeNull();
    });

    it('should preserve context window', () => {
      const original = repo.create(projectId, 'Test', 'Prompt');
      repo.updateUsage(original.id, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        webSearchRequests: 0,
        contextWindow: 100000,
      });

      const duplicate = repo.duplicate(original.id);

      expect(duplicate.contextWindow).toBe(100000);
    });

    it('should have null optional fields not copied', () => {
      const original = repo.create(projectId, 'Test', 'Prompt');

      const duplicate = repo.duplicate(original.id);

      expect(duplicate.nextTemplateId).toBeNull();
      expect(duplicate.parentSessionId).toBeNull();
    });

    it('should preserve effortLevel', () => {
      const original = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, null, 'starting', null, { effortLevel: 'high' });

      const duplicate = repo.duplicate(original.id);

      expect(duplicate.effortLevel).toBe('high');
    });

    it('should preserve null effortLevel', () => {
      const original = repo.create(projectId, 'Test', 'Prompt');

      const duplicate = repo.duplicate(original.id);

      expect(duplicate.effortLevel).toBeNull();
    });

    it('should preserve model', () => {
      const original = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, null, 'starting', 'claude-sonnet-4-20250514');

      const duplicate = repo.duplicate(original.id);

      expect(duplicate.model).toBe('claude-sonnet-4-20250514');
    });
  });

  describe('getScheduledSessions', () => {
    it('should return all scheduled sessions across all projects', () => {
      const project1 = projectRepo.create('Project 1', '/tmp/p1');
      const project2 = projectRepo.create('Project 2', '/tmp/p2');

      const session1 = repo.create(project1.id, 'Session 1', 'Prompt 1', 'standard', false, null, null, 'scheduled');
      repo.update(session1.id, { scheduledAt: Date.now() + 1000 });

      const session2 = repo.create(project2.id, 'Session 2', 'Prompt 2', 'standard', false, null, null, 'scheduled');
      repo.update(session2.id, { scheduledAt: Date.now() + 2000 });

      const result = repo.getScheduledSessions();

      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id)).toContain(session1.id);
      expect(result.map((s) => s.id)).toContain(session2.id);
    });

    it('should return scheduled sessions sorted by scheduledAt (earliest first)', () => {
      const now = Date.now();

      const session1 = repo.create(projectId, 'Session 1', 'Prompt 1', 'standard', false, null, null, 'scheduled');
      repo.update(session1.id, { scheduledAt: now + 3000 }); // Latest

      const session2 = repo.create(projectId, 'Session 2', 'Prompt 2', 'standard', false, null, null, 'scheduled');
      repo.update(session2.id, { scheduledAt: now + 1000 }); // Earliest

      const session3 = repo.create(projectId, 'Session 3', 'Prompt 3', 'standard', false, null, null, 'scheduled');
      repo.update(session3.id, { scheduledAt: now + 2000 }); // Middle

      const result = repo.getScheduledSessions();

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(session2.id); // Earliest first
      expect(result[1].id).toBe(session3.id);
      expect(result[2].id).toBe(session1.id); // Latest last
    });

    it('should filter scheduled sessions by project ID', () => {
      const project1 = projectRepo.create('Project 1', '/tmp/p1');
      const project2 = projectRepo.create('Project 2', '/tmp/p2');

      const session1 = repo.create(project1.id, 'Session 1', 'Prompt 1', 'standard', false, null, null, 'scheduled');
      repo.update(session1.id, { scheduledAt: Date.now() + 1000 });

      const session2 = repo.create(project2.id, 'Session 2', 'Prompt 2', 'standard', false, null, null, 'scheduled');
      repo.update(session2.id, { scheduledAt: Date.now() + 2000 });

      const result = repo.getScheduledSessions(project1.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(session1.id);
      expect(result[0].projectId).toBe(project1.id);
    });

    it('should exclude non-scheduled sessions', () => {
      repo.create(projectId, 'Running', 'Prompt', 'standard', false, null, null, 'running');
      repo.create(projectId, 'Completed', 'Prompt', 'standard', false, null, null, 'completed');
      repo.create(projectId, 'Waiting', 'Prompt', 'standard', false, null, null, 'waiting');

      const scheduledSession = repo.create(projectId, 'Scheduled', 'Prompt', 'standard', false, null, null, 'scheduled');
      repo.update(scheduledSession.id, { scheduledAt: Date.now() + 1000 });

      const result = repo.getScheduledSessions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(scheduledSession.id);
    });

    it('should exclude archived scheduled sessions', () => {
      const session1 = repo.create(projectId, 'Session 1', 'Prompt 1', 'standard', false, null, null, 'scheduled');
      repo.update(session1.id, { scheduledAt: Date.now() + 1000 });

      const session2 = repo.create(projectId, 'Session 2', 'Prompt 2', 'standard', false, null, null, 'scheduled');
      repo.update(session2.id, { scheduledAt: Date.now() + 2000, archived: true });

      const result = repo.getScheduledSessions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(session1.id);
    });

    it('should include project name in results', () => {
      const project = projectRepo.create('My Project', '/tmp/project');
      const session = repo.create(project.id, 'Session', 'Prompt', 'standard', false, null, null, 'scheduled');
      repo.update(session.id, { scheduledAt: Date.now() + 1000 });

      const result = repo.getScheduledSessions();

      expect(result).toHaveLength(1);
      expect(result[0].projectName).toBe('My Project');
    });

    it('should return empty array when no scheduled sessions exist', () => {
      repo.create(projectId, 'Running', 'Prompt', 'standard', false, null, null, 'running');

      const result = repo.getScheduledSessions();

      expect(result).toHaveLength(0);
    });

    it('should return empty array when filtering by project with no scheduled sessions', () => {
      const project1 = projectRepo.create('Project 1', '/tmp/p1');
      const project2 = projectRepo.create('Project 2', '/tmp/p2');

      const session = repo.create(project1.id, 'Session', 'Prompt', 'standard', false, null, null, 'scheduled');
      repo.update(session.id, { scheduledAt: Date.now() + 1000 });

      const result = repo.getScheduledSessions(project2.id);

      expect(result).toHaveLength(0);
    });
  });

  describe('lastActivityAt', () => {
    it('populates lastActivityAt on session objects returned by getById', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const retrieved = repo.getById(session.id);

      expect(retrieved.lastActivityAt).toBeDefined();
      expect(retrieved.lastActivityAt).toBeTypeOf('number');
    });

    it('populates lastActivityAt on session objects returned by getByProjectId', () => {
      repo.create(projectId, 'Session 1', 'Prompt 1');
      repo.create(projectId, 'Session 2', 'Prompt 2');

      const sessions = repo.getByProjectId(projectId);

      expect(sessions).toHaveLength(2);
      sessions.forEach((session) => {
        expect(session.lastActivityAt).toBeDefined();
        expect(session.lastActivityAt).toBeTypeOf('number');
      });
    });

    it('reflects the latest message timestamp when messages are added', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');

      // Get the initial message created by create()
      const initialMessages = messageRepo.getBySessionId(session.id);
      expect(initialMessages).toHaveLength(1);

      const retrieved = repo.getById(session.id);
      expect(retrieved.lastActivityAt).toBeGreaterThanOrEqual(initialMessages[0].timestamp);

      // Add another message with a later timestamp
      const conversations = conversationRepo.getBySessionId(session.id);
      const newMessage = messageRepo.create(session.id, 'assistant', 'Response', null, conversations[0].id);

      const retrievedAfter = repo.getById(session.id);
      expect(retrievedAfter.lastActivityAt).toBeGreaterThanOrEqual(retrieved.lastActivityAt);
      expect(retrievedAfter.lastActivityAt).toBeGreaterThanOrEqual(newMessage.timestamp);
    });

    it('falls back to updatedAt when there are no messages', () => {
      // Create a waiting session (which doesn't create initial message)
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, null, 'waiting');

      const retrieved = repo.getById(session.id);

      expect(retrieved.lastActivityAt).toBeDefined();
      expect(retrieved.lastActivityAt).toBeTypeOf('number');
      // For a new session with no messages, lastActivityAt should equal updatedAt
      expect(retrieved.lastActivityAt).toBe(retrieved.updatedAt);
    });

    it('falls back to createdAt when there are no messages and updatedAt equals createdAt', () => {
      // Create a scheduled session (which doesn't create initial message)
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, null, 'scheduled');

      const retrieved = repo.getById(session.id);

      expect(retrieved.lastActivityAt).toBeDefined();
      expect(retrieved.lastActivityAt).toBeTypeOf('number');
      // For a new session with no messages and no updates, lastActivityAt should equal createdAt
      expect(retrieved.lastActivityAt).toBe(retrieved.createdAt);
    });

    it('is included in getActiveAndWaiting results', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { status: 'running' });

      const sessions = repo.getActiveAndWaiting();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].lastActivityAt).toBeDefined();
      expect(sessions[0].lastActivityAt).toBeTypeOf('number');
    });

    it('is included in getChildSessions results', () => {
      const parent = repo.create(projectId, 'Parent', 'Prompt');
      repo.create(projectId, 'Child', 'Prompt', 'standard', false, null, parent.id);

      const children = repo.getChildSessions(parent.id);

      expect(children).toHaveLength(1);
      expect(children[0].lastActivityAt).toBeDefined();
      expect(children[0].lastActivityAt).toBeTypeOf('number');
    });

    it('is included in getSessionsWithPrUrls results', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { prUrl: 'https://github.com/org/repo/pull/123' });

      const sessions = repo.getSessionsWithPrUrls();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].lastActivityAt).toBeDefined();
      expect(sessions[0].lastActivityAt).toBeTypeOf('number');
    });

    it('is included in getScheduledSessions results', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, null, 'scheduled');
      repo.update(session.id, { scheduledAt: Date.now() + 1000 });

      const sessions = repo.getScheduledSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].lastActivityAt).toBeDefined();
      expect(sessions[0].lastActivityAt).toBeTypeOf('number');
    });
  });

  describe('activeTimeMs', () => {
    it('returns 0 for a session with no messages', () => {
      const session = repo.create(projectId, 'Test', 'Prompt', 'standard', false, null, null, 'waiting');
      const retrieved = repo.getById(session.id);
      expect(retrieved.activeTimeMs).toBe(0);
    });

    it('returns 0 for a session with a single message', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const retrieved = repo.getById(session.id);
      expect(retrieved.activeTimeMs).toBe(0);
    });

    it('computes time span between first and last message', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      // First message already created by create()
      const conversations = conversationRepo.getBySessionId(session.id);
      // Create a second message
      messageRepo.create(session.id, 'assistant', 'Response', null, conversations[0].id);

      // Manually set the timestamp of the new message to 60s later
      const later = session.createdAt + 60000;
      const db = repo.db;
      db.prepare('UPDATE conversation_messages SET timestamp = ? WHERE session_id = ? AND role = ? ORDER BY timestamp DESC LIMIT 1')
        .run(later, session.id, 'assistant');

      const retrieved = repo.getById(session.id);
      expect(retrieved.activeTimeMs).toBeGreaterThanOrEqual(59000);
    });

    it('returns activeTimeMs in getByProjectId results', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const results = repo.getByProjectId(projectId);
      const found = results.find(s => s.id === session.id);
      expect(found).toBeDefined();
      expect(found.activeTimeMs).toBeTypeOf('number');
    });

    it('returns activeTimeMs in getActiveAndWaiting results', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { status: 'running' });

      const sessions = repo.getActiveAndWaiting();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].activeTimeMs).toBeTypeOf('number');
    });

    it('returns activeTimeMs in getChildSessions results', () => {
      const parent = repo.create(projectId, 'Parent', 'Prompt');
      repo.create(projectId, 'Child', 'Prompt', 'standard', false, null, parent.id);

      const children = repo.getChildSessions(parent.id);
      expect(children).toHaveLength(1);
      expect(children[0].activeTimeMs).toBeTypeOf('number');
    });

    it('returns activeTimeMs in getSessionsWithPrUrls results', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { prUrl: 'https://github.com/org/repo/pull/123' });

      const sessions = repo.getSessionsWithPrUrls();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].activeTimeMs).toBeTypeOf('number');
    });
  });

  describe('getRootSessionId', () => {
    it('returns the session itself when it has no parent', () => {
      const root = repo.create(projectId, 'Root Session', 'Prompt');
      const rootId = repo.getRootSessionId(root.id);

      expect(rootId).toBe(root.id);
    });

    it('returns the root for a 2-level hierarchy', () => {
      const root = repo.create(projectId, 'Root', 'Prompt');
      const child = repo.create(projectId, 'Child', 'Prompt', 'standard', false, null, root.id);

      const childRootId = repo.getRootSessionId(child.id);

      expect(childRootId).toBe(root.id);
    });

    it('returns the root for a 3-level hierarchy', () => {
      const root = repo.create(projectId, 'Root', 'Prompt');
      const child = repo.create(projectId, 'Child', 'Prompt', 'standard', false, null, root.id);
      const grandchild = repo.create(projectId, 'Grandchild', 'Prompt', 'standard', false, null, child.id);

      const grandchildRootId = repo.getRootSessionId(grandchild.id);

      expect(grandchildRootId).toBe(root.id);
    });

    it('returns the root for a 4-level hierarchy', () => {
      const root = repo.create(projectId, 'Root', 'Prompt');
      const levelA = repo.create(projectId, 'A', 'Prompt', 'standard', false, null, root.id);
      const levelB = repo.create(projectId, 'B', 'Prompt', 'standard', false, null, levelA.id);
      const levelC = repo.create(projectId, 'C', 'Prompt', 'standard', false, null, levelB.id);

      const levelCRootId = repo.getRootSessionId(levelC.id);

      expect(levelCRootId).toBe(root.id);
    });

    it('handles cycle gracefully', () => {
      const session1 = repo.create(projectId, 'Session 1', 'Prompt');
      const session2 = repo.create(projectId, 'Session 2', 'Prompt');

      // Manually create a cycle by updating both to point to each other
      repo.update(session1.id, { parentSessionId: session2.id });
      repo.update(session2.id, { parentSessionId: session1.id });

      // Should not hang and should return one of the session IDs
      const result = repo.getRootSessionId(session1.id);

      // Just verify it returns something and doesn't hang
      expect(result).toBeDefined();
    });

    it('returns null for non-existent session', () => {
      const result = repo.getRootSessionId('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getAllDescendantIds', () => {
    it('returns empty array when session has no children', () => {
      const session = repo.create(projectId, 'Solo Session', 'Prompt');
      const descendants = repo.getAllDescendantIds(session.id);
      expect(descendants).toEqual([]);
    });

    it('returns direct child IDs', () => {
      const parent = repo.create(projectId, 'Parent', 'Prompt');
      const child = repo.create(projectId, 'Child', 'Prompt', { parentSessionId: parent.id });

      const descendants = repo.getAllDescendantIds(parent.id);

      expect(descendants).toHaveLength(1);
      expect(descendants).toContain(child.id);
    });

    it('returns grandchildren recursively', () => {
      const root = repo.create(projectId, 'Root', 'Prompt');
      const child = repo.create(projectId, 'Child', 'Prompt', { parentSessionId: root.id });
      const grandchild = repo.create(projectId, 'Grandchild', 'Prompt', { parentSessionId: child.id });

      const descendants = repo.getAllDescendantIds(root.id);

      expect(descendants).toHaveLength(2);
      expect(descendants).toContain(child.id);
      expect(descendants).toContain(grandchild.id);
    });

    it('does not include the starting session itself', () => {
      const root = repo.create(projectId, 'Root', 'Prompt');
      const child = repo.create(projectId, 'Child', 'Prompt', { parentSessionId: root.id });

      const descendants = repo.getAllDescendantIds(root.id);

      expect(descendants).not.toContain(root.id);
      expect(descendants).toContain(child.id);
    });

    it('handles multiple children at same level', () => {
      const parent = repo.create(projectId, 'Parent', 'Prompt');
      const child1 = repo.create(projectId, 'Child 1', 'Prompt', { parentSessionId: parent.id });
      const child2 = repo.create(projectId, 'Child 2', 'Prompt', { parentSessionId: parent.id });
      const child3 = repo.create(projectId, 'Child 3', 'Prompt', { parentSessionId: parent.id });

      const descendants = repo.getAllDescendantIds(parent.id);

      expect(descendants).toHaveLength(3);
      expect(descendants).toContain(child1.id);
      expect(descendants).toContain(child2.id);
      expect(descendants).toContain(child3.id);
    });

    it('returns empty array for non-existent session', () => {
      const descendants = repo.getAllDescendantIds('non-existent-id');
      expect(descendants).toEqual([]);
    });

    it('handles deep hierarchy (4 levels)', () => {
      const root = repo.create(projectId, 'Root', 'Prompt');
      const levelA = repo.create(projectId, 'A', 'Prompt', { parentSessionId: root.id });
      const levelB = repo.create(projectId, 'B', 'Prompt', { parentSessionId: levelA.id });
      const levelC = repo.create(projectId, 'C', 'Prompt', { parentSessionId: levelB.id });

      const descendants = repo.getAllDescendantIds(root.id);

      expect(descendants).toHaveLength(3);
      expect(descendants).toContain(levelA.id);
      expect(descendants).toContain(levelB.id);
      expect(descendants).toContain(levelC.id);
    });
  });

  describe('autoSendPendingPrompt', () => {
    it('defaults autoSendPendingPrompt to false on creation', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      const retrieved = repo.getById(session.id);
      expect(retrieved.autoSendPendingPrompt).toBe(false);
    });

    it('can set autoSendPendingPrompt to true', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { autoSendPendingPrompt: true });
      const retrieved = repo.getById(session.id);
      expect(retrieved.autoSendPendingPrompt).toBe(true);
    });

    it('can set autoSendPendingPrompt back to false', () => {
      const session = repo.create(projectId, 'Test', 'Prompt');
      repo.update(session.id, { autoSendPendingPrompt: true });
      repo.update(session.id, { autoSendPendingPrompt: false });
      const retrieved = repo.getById(session.id);
      expect(retrieved.autoSendPendingPrompt).toBe(false);
    });
  });
});
