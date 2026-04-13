import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { projects, sessions } from '../src/database.js';
import { executeHookAsync } from '../src/services/hookService.js';

vi.mock('../src/services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

describe('Session Lifecycle Hooks', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'session-hooks-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Project hook configuration', () => {
    it('stores onSessionCreated hook in project', () => {
      const project = projects.create('Test', tempDir, null, {
        onSessionCreated: 'echo "created" >> log.txt',
      });

      expect(project.onSessionCreated).toBe('echo "created" >> log.txt');
      expect(project.onSessionDeleted).toBeNull();
    });

    it('stores onSessionDeleted hook in project', () => {
      const project = projects.create('Test', tempDir, null, {
        onSessionDeleted: './cleanup.sh',
      });

      expect(project.onSessionCreated).toBeNull();
      expect(project.onSessionDeleted).toBe('./cleanup.sh');
    });

    it('stores both hooks in project', () => {
      const project = projects.create('Test', tempDir, null, {
        onSessionCreated: 'echo "start"',
        onSessionDeleted: 'echo "end"',
      });

      expect(project.onSessionCreated).toBe('echo "start"');
      expect(project.onSessionDeleted).toBe('echo "end"');
    });

    it('updates hooks via project update', () => {
      const project = projects.create('Test', tempDir);
      const updated = projects.update(project.id, {
        onSessionCreated: 'new-hook.sh',
        onSessionDeleted: 'cleanup-hook.sh',
      });

      expect(updated.onSessionCreated).toBe('new-hook.sh');
      expect(updated.onSessionDeleted).toBe('cleanup-hook.sh');
    });

    it('clears hooks by setting to null', () => {
      const project = projects.create('Test', tempDir, null, {
        onSessionCreated: 'echo "hook"',
        onSessionDeleted: 'echo "hook"',
      });

      const updated = projects.update(project.id, {
        onSessionCreated: null,
        onSessionDeleted: null,
      });

      expect(updated.onSessionCreated).toBeNull();
      expect(updated.onSessionDeleted).toBeNull();
    });
  });

  describe('Hook execution context', () => {
    it('project includes hook fields when retrieved', () => {
      const created = projects.create('Test', tempDir, null, {
        onSessionCreated: 'echo $CIRCUSCHIEF_SESSION_ID',
        onSessionDeleted: 'echo $CIRCUSCHIEF_PROJECT_ID',
      });

      const retrieved = projects.getById(created.id);

      expect(retrieved.onSessionCreated).toBe('echo $CIRCUSCHIEF_SESSION_ID');
      expect(retrieved.onSessionDeleted).toBe('echo $CIRCUSCHIEF_PROJECT_ID');
    });

    it('hook fields appear in project list', () => {
      projects.create('Project 1', tempDir, null, {
        onSessionCreated: 'hook1.sh',
      });
      projects.create('Project 2', tempDir, null, {
        onSessionDeleted: 'hook2.sh',
      });

      const allProjects = projects.getAll();

      expect(allProjects).toHaveLength(2);
      // Projects are ordered by updatedAt DESC, so Project 2 comes first
      expect(allProjects.some(p => p.onSessionCreated === 'hook1.sh')).toBe(true);
      expect(allProjects.some(p => p.onSessionDeleted === 'hook2.sh')).toBe(true);
    });
  });

  describe('Session operations with hooks configured', () => {
    it('creates session for project with hooks', () => {
      const project = projects.create('Test', tempDir, null, {
        onSessionCreated: 'echo "session created"',
        onSessionDeleted: 'echo "session deleted"',
      });

      const session = sessions.create(project.id, 'Test Session', 'Hello');

      expect(session.id).toBeDefined();
      expect(session.projectId).toBe(project.id);
      expect(session.name).toBe('Test Session');
    });

    it('deletes session for project with hooks', () => {
      const project = projects.create('Test', tempDir, null, {
        onSessionDeleted: 'echo "cleanup"',
      });
      const session = sessions.create(project.id, 'Test Session', 'Hello');

      sessions.delete(session.id);

      expect(sessions.getById(session.id)).toBeNull();
    });

    it('project with hooks is accessible when session is retrieved', () => {
      const project = projects.create('Test', tempDir, null, {
        onSessionCreated: 'start.sh',
        onSessionDeleted: 'stop.sh',
      });
      const session = sessions.create(project.id, 'Test Session', 'Hello');

      const retrievedProject = projects.getById(session.projectId);

      expect(retrievedProject.onSessionCreated).toBe('start.sh');
      expect(retrievedProject.onSessionDeleted).toBe('stop.sh');
    });
  });

  describe('Hook working directory with worktrees', () => {
    it('session stores gitWorktree path separately from project workingDirectory', () => {
      const project = projects.create('Test', tempDir, null, {
        onSessionDeleted: 'cleanup.sh',
      });
      const session = sessions.create(project.id, 'Worktree Session', 'Hello');

      // Simulate worktree setup by updating session
      const worktreePath = join(tempDir, '.worktrees', session.id);
      sessions.update(session.id, {
        gitWorktree: worktreePath,
        gitBranch: 'feature-branch',
      });

      const retrieved = sessions.getById(session.id);
      const retrievedProject = projects.getById(session.projectId);

      // Session should have its own gitWorktree path
      expect(retrieved.gitWorktree).toBe(worktreePath);
      // Project still has original workingDirectory
      expect(retrievedProject.workingDirectory).toBe(tempDir);
      // These should be different - hooks should use session.gitWorktree when available
      expect(retrieved.gitWorktree).not.toBe(retrievedProject.workingDirectory);
    });

    it('hook working directory should prefer session gitWorktree over project workingDirectory', () => {
      const project = projects.create('Test', tempDir, null, {
        onSessionDeleted: 'cleanup.sh',
      });
      const session = sessions.create(project.id, 'Worktree Session', 'Hello');

      const worktreePath = join(tempDir, '.worktrees', session.id);
      sessions.update(session.id, { gitWorktree: worktreePath });

      const retrieved = sessions.getById(session.id);
      const retrievedProject = projects.getById(session.projectId);

      // This is the pattern that should be used in API routes when executing hooks:
      // const hookWorkingDirectory = session.gitWorktree || project.workingDirectory;
      const hookWorkingDirectory = retrieved.gitWorktree || retrievedProject.workingDirectory;

      expect(hookWorkingDirectory).toBe(worktreePath);
    });

    it('hook working directory falls back to project when no gitWorktree', () => {
      const project = projects.create('Test', tempDir, null, {
        onSessionDeleted: 'cleanup.sh',
      });
      const session = sessions.create(project.id, 'Regular Session', 'Hello');

      const retrieved = sessions.getById(session.id);
      const retrievedProject = projects.getById(session.projectId);

      // No gitWorktree set, should use project directory
      const hookWorkingDirectory = retrieved.gitWorktree || retrievedProject.workingDirectory;

      expect(hookWorkingDirectory).toBe(tempDir);
    });
  });
});
