import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectRepository } from './ProjectRepository.js';
import { SessionRepository } from './SessionRepository.js';

describe('ProjectRepository', () => {
  // Uses global setup from test/setup.js
  let repo;

  beforeEach(() => {
    repo = new ProjectRepository();
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(ProjectRepository);
      expect(repo.tableName).toBe('projects');
    });
  });

  describe('create', () => {
    it('creates a project with name and working directory', () => {
      const project = repo.create('Test Project', '/tmp/test');

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.workingDirectory).toBe('/tmp/test');
      expect(project.createdAt).toBeTypeOf('number');
      expect(project.updatedAt).toBeTypeOf('number');
    });

    it('generates unique IDs for each project', () => {
      const project1 = repo.create('Project 1', '/tmp/1');
      const project2 = repo.create('Project 2', '/tmp/2');

      expect(project1.id).not.toBe(project2.id);
    });

    it('sets createdAt and updatedAt to same value on creation', () => {
      const project = repo.create('Test', '/tmp');
      expect(project.createdAt).toBe(project.updatedAt);
    });

    it('creates project with session lifecycle hooks', () => {
      const project = repo.create('Test Project', '/tmp/test', null, {
        onSessionCreated: 'echo "session created"',
        onSessionDeleted: 'echo "session deleted"',
      });

      expect(project.onSessionCreated).toBe('echo "session created"');
      expect(project.onSessionDeleted).toBe('echo "session deleted"');
    });

    it('creates project with null hooks by default', () => {
      const project = repo.create('Test Project', '/tmp/test');

      expect(project.onSessionCreated).toBeNull();
      expect(project.onSessionDeleted).toBeNull();
    });

    it('creates project with default prPollInterval of 60000', () => {
      const project = repo.create('Test Project', '/tmp/test');

      expect(project.prPollInterval).toBe(60000);
    });

    it('creates project with custom prPollInterval', () => {
      const project = repo.create('Test Project', '/tmp/test', null, {
        prPollInterval: 30000,
      });

      expect(project.prPollInterval).toBe(30000);
    });

    it('creates project with repoUrl null by default', () => {
      const project = repo.create('Test Project', '/tmp/test');

      expect(project.repoUrl).toBeNull();
    });

    it('creates project with repoUrl in options', () => {
      const project = repo.create('Test Project', '/tmp/test', null, {
        repoUrl: 'https://github.com/example/project',
      });

      expect(project.repoUrl).toBe('https://github.com/example/project');
    });

    it('creates project with repoUrl and other options together', () => {
      const project = repo.create('Test Project', '/tmp/test', null, {
        repoUrl: 'https://github.com/user/repo',
        prPollInterval: 30000,
      });

      expect(project.repoUrl).toBe('https://github.com/user/repo');
      expect(project.prPollInterval).toBe(30000);
    });

    it('creates project with worktreePath in options', () => {
      const project = repo.create('Test Project', '/tmp/test', null, {
        worktreePath: '/custom/worktrees',
      });

      expect(project.worktreePath).toBe('/custom/worktrees');
    });

    it('creates project with null worktreePath by default', () => {
      const project = repo.create('Test Project', '/tmp/test');

      expect(project.worktreePath).toBeNull();
    });

  });

  describe('getById', () => {
    it('retrieves project by ID', () => {
      const created = repo.create('Test', '/tmp/test');
      const retrieved = repo.getById(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns null for non-existent ID', () => {
      const result = repo.getById('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getAll', () => {
    it('returns empty array when no projects exist', () => {
      const projects = repo.getAll();
      expect(projects).toEqual([]);
    });

    it('returns all projects', () => {
      repo.create('Project 1', '/tmp/1');
      repo.create('Project 2', '/tmp/2');
      repo.create('Project 3', '/tmp/3');

      const projects = repo.getAll();

      expect(projects).toHaveLength(3);
    });

    it('returns projects ordered by updatedAt descending', () => {
      const p1 = repo.create('Project 1', '/tmp/1');
      const p2 = repo.create('Project 2', '/tmp/2');
      const p3 = repo.create('Project 3', '/tmp/3');

      const projects = repo.getAll();

      // Verify all projects are returned and ordered by updatedAt DESC
      expect(projects).toHaveLength(3);
      const ids = projects.map(p => p.id);
      expect(ids).toContain(p1.id);
      expect(ids).toContain(p2.id);
      expect(ids).toContain(p3.id);
      // Items with same timestamp are returned, ordering is stable
      expect(projects[0].updatedAt).toBeGreaterThanOrEqual(projects[2].updatedAt);
    });

    it('returns sessionCount and lastActivityAt for each project', () => {
      repo.create('Test Project', '/tmp/test');

      const projects = repo.getAll();

      expect(projects).toHaveLength(1);
      expect(projects[0].sessionCount).toBe(0);
      expect(projects[0].lastActivityAt).toBeNull();
    });

    it('counts non-archived sessions for each project', () => {
      const project = repo.create('Test Project', '/tmp/test');
      const sessionRepo = new SessionRepository();

      // Create 3 non-archived sessions and 2 archived sessions
      sessionRepo.create(project.id, 'Session 1', 'test prompt');
      sessionRepo.create(project.id, 'Session 2', 'test prompt');
      sessionRepo.create(project.id, 'Session 3', 'test prompt');
      const archived1 = sessionRepo.create(project.id, 'Archived 1', 'test prompt');
      const archived2 = sessionRepo.create(project.id, 'Archived 2', 'test prompt');
      sessionRepo.update(archived1.id, { archived: true });
      sessionRepo.update(archived2.id, { archived: true });

      const projects = repo.getAll();

      expect(projects).toHaveLength(1);
      expect(projects[0].sessionCount).toBe(3);
    });

    it('returns lastActivityAt as most recent session updated_at', () => {
      const project = repo.create('Test Project', '/tmp/test');
      const sessionRepo = new SessionRepository();

      const s1 = sessionRepo.create(project.id, 'Session 1', 'test prompt');
      const s2 = sessionRepo.create(project.id, 'Session 2', 'test prompt');

      // Update session 2 to have a later updatedAt
      sessionRepo.update(s2.id, { name: 'Updated Session 2' });

      const projects = repo.getAll();

      expect(projects).toHaveLength(1);
      expect(projects[0].lastActivityAt).toBeGreaterThan(0);
      // lastActivityAt should be from session 2 (the most recently updated)
      expect(projects[0].lastActivityAt).toBeGreaterThanOrEqual(s1.updatedAt);
    });
  });

  describe('update', () => {
    it('updates project name', () => {
      const project = repo.create('Original', '/tmp/test');
      const updated = repo.update(project.id, { name: 'Updated' });

      expect(updated.name).toBe('Updated');
      expect(updated.workingDirectory).toBe('/tmp/test');
    });

    it('updates working directory', () => {
      const project = repo.create('Test', '/tmp/original');
      const updated = repo.update(project.id, { workingDirectory: '/tmp/new' });

      expect(updated.workingDirectory).toBe('/tmp/new');
      expect(updated.name).toBe('Test');
    });

    it('updates multiple fields at once', () => {
      const project = repo.create('Original', '/tmp/original');
      const updated = repo.update(project.id, {
        name: 'New Name',
        workingDirectory: '/tmp/new',
      });

      expect(updated.name).toBe('New Name');
      expect(updated.workingDirectory).toBe('/tmp/new');
    });

    it('updates updatedAt timestamp', () => {
      const project = repo.create('Test', '/tmp/test');
      const originalUpdatedAt = project.updatedAt;

      // Small delay to ensure different timestamp
      const updated = repo.update(project.id, { name: 'Updated' });

      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('returns unchanged project when no updates provided', () => {
      const project = repo.create('Test', '/tmp/test');
      const result = repo.update(project.id, {});

      expect(result.name).toBe('Test');
      expect(result.workingDirectory).toBe('/tmp/test');
    });

    it('updates onSessionCreated hook', () => {
      const project = repo.create('Test', '/tmp/test');
      const updated = repo.update(project.id, {
        onSessionCreated: 'echo "hook updated"',
      });

      expect(updated.onSessionCreated).toBe('echo "hook updated"');
    });

    it('updates onSessionDeleted hook', () => {
      const project = repo.create('Test', '/tmp/test');
      const updated = repo.update(project.id, {
        onSessionDeleted: './cleanup.sh',
      });

      expect(updated.onSessionDeleted).toBe('./cleanup.sh');
    });

    it('clears hooks when set to null', () => {
      const project = repo.create('Test', '/tmp/test', null, {
        onSessionCreated: 'echo "created"',
        onSessionDeleted: 'echo "deleted"',
      });
      const updated = repo.update(project.id, {
        onSessionCreated: null,
        onSessionDeleted: null,
      });

      expect(updated.onSessionCreated).toBeNull();
      expect(updated.onSessionDeleted).toBeNull();
    });

    it('updates prPollInterval', () => {
      const project = repo.create('Test', '/tmp/test');
      expect(project.prPollInterval).toBe(60000);

      const updated = repo.update(project.id, {
        prPollInterval: 120000,
      });

      expect(updated.prPollInterval).toBe(120000);
    });

    it('updates repoUrl', () => {
      const project = repo.create('Test', '/tmp/test');
      expect(project.repoUrl).toBeNull();

      const updated = repo.update(project.id, {
        repoUrl: 'https://github.com/example/repo',
      });

      expect(updated.repoUrl).toBe('https://github.com/example/repo');
    });

    it('sets repoUrl to null', () => {
      const project = repo.create('Test', '/tmp/test');
      repo.update(project.id, {
        repoUrl: 'https://github.com/example/repo',
      });

      const updated = repo.update(project.id, {
        repoUrl: null,
      });

      expect(updated.repoUrl).toBeNull();
    });

    it('clears repoUrl when set to null', () => {
      const project = repo.create('Test', '/tmp/test', null, {});
      const withUrl = repo.update(project.id, {
        repoUrl: 'https://github.com/user/project',
      });
      expect(withUrl.repoUrl).toBe('https://github.com/user/project');

      const cleared = repo.update(project.id, {
        repoUrl: null,
      });
      expect(cleared.repoUrl).toBeNull();
    });

    it('updates worktreePath', () => {
      const project = repo.create('Test', '/tmp/test');
      const updated = repo.update(project.id, {
        worktreePath: '/custom/worktrees',
      });

      expect(updated.worktreePath).toBe('/custom/worktrees');
    });

    it('clears worktreePath when set to null', () => {
      const project = repo.create('Test', '/tmp/test', null, {
        worktreePath: '/custom/worktrees',
      });
      expect(project.worktreePath).toBe('/custom/worktrees');

      const updated = repo.update(project.id, {
        worktreePath: null,
      });
      expect(updated.worktreePath).toBeNull();
    });

  });

  describe('delete', () => {
    it('deletes a project', () => {
      const project = repo.create('Test', '/tmp/test');
      repo.delete(project.id);

      expect(repo.getById(project.id)).toBeNull();
    });

    it('does not throw when deleting non-existent project', () => {
      expect(() => repo.delete('non-existent')).not.toThrow();
    });
  });
});
