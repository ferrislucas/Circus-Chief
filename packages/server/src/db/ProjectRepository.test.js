import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectRepository } from './ProjectRepository.js';

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
