import { describe, it, expect, beforeEach } from 'vitest';
import { QuickResponseRepository } from './QuickResponseRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { getDatabase } from './index.js';

describe('QuickResponseRepository', () => {
  let repo;
  let projectRepo;
  let projectId;
  let projectId2;

  beforeEach(() => {
    // Clear seeded default quick responses so tests start with a clean slate
    getDatabase().prepare('DELETE FROM quick_responses').run();

    repo = new QuickResponseRepository();
    projectRepo = new ProjectRepository();

    // Create test projects
    const project = projectRepo.create('Test Project', '/tmp/test');
    projectId = project.id;

    const project2 = projectRepo.create('Test Project 2', '/tmp/test2');
    projectId2 = project2.id;
  });

  describe('create()', () => {
    it('should create a project-specific quick response with all fields', () => {
      const response = repo.create({
        projectId,
        label: 'Yes',
        content: 'yes',
        autoSubmit: true,
        category: 'feedback',
        sortOrder: 1,
      });

      expect(response).toBeDefined();
      expect(response.id).toBeDefined();
      expect(response.projectId).toBe(projectId);
      expect(response.label).toBe('Yes');
      expect(response.content).toBe('yes');
      expect(response.autoSubmit).toBe(true);
      expect(response.category).toBe('feedback');
      expect(response.sortOrder).toBe(1);
      expect(response.createdAt).toBeTypeOf('number');
      expect(response.updatedAt).toBeTypeOf('number');
    });

    it('should create a global quick response when projectId is null', () => {
      const response = repo.create({
        projectId: null,
        label: 'LGTM',
        content: 'Looks good to me!',
      });

      expect(response.projectId).toBeNull();
      expect(response.label).toBe('LGTM');
    });

    it('should default autoSubmit to false if not specified', () => {
      const response = repo.create({
        projectId,
        label: 'Test',
        content: 'Test content',
      });

      expect(response.autoSubmit).toBe(false);
    });

    it('should default sortOrder to 0 if not specified', () => {
      const response = repo.create({
        projectId,
        label: 'Test',
        content: 'Test content',
      });

      expect(response.sortOrder).toBe(0);
    });

    it('should generate unique UUID for id', () => {
      const response1 = repo.create({
        projectId,
        label: 'Test',
        content: 'Test content',
      });
      const response2 = repo.create({
        projectId,
        label: 'Test',
        content: 'Test content',
      });

      expect(response1.id).not.toBe(response2.id);
    });

    it('should set created_at and updated_at timestamps', () => {
      const before = Date.now();
      const response = repo.create({
        projectId,
        label: 'Test',
        content: 'Test content',
      });
      const after = Date.now();

      expect(response.createdAt).toBeGreaterThanOrEqual(before);
      expect(response.createdAt).toBeLessThanOrEqual(after);
      expect(response.updatedAt).toBeGreaterThanOrEqual(before);
      expect(response.updatedAt).toBeLessThanOrEqual(after);
    });

    it('should handle null category', () => {
      const response = repo.create({
        projectId,
        label: 'Test',
        content: 'Test content',
        category: null,
      });

      expect(response.category).toBeNull();
    });
  });

  describe('getByProjectId()', () => {
    it('should return all responses for a specific project', () => {
      repo.create({ projectId, label: 'Test1', content: 'content1' });
      repo.create({ projectId, label: 'Test2', content: 'content2' });
      repo.create({ projectId, label: 'Test3', content: 'content3' });
      repo.create({ projectId: projectId2, label: 'Other', content: 'other' });

      const responses = repo.getByProjectId(projectId);

      expect(responses).toHaveLength(3);
      expect(responses.every((r) => r.projectId === projectId)).toBe(true);
    });

    it('should return empty array if project has no responses', () => {
      const responses = repo.getByProjectId(projectId);
      expect(responses).toEqual([]);
    });

    it('should order results by sort_order ascending', () => {
      repo.create({ projectId, label: 'Third', content: 'c', sortOrder: 2 });
      repo.create({ projectId, label: 'First', content: 'a', sortOrder: 0 });
      repo.create({ projectId, label: 'Second', content: 'b', sortOrder: 1 });

      const responses = repo.getByProjectId(projectId);

      expect(responses[0].label).toBe('First');
      expect(responses[1].label).toBe('Second');
      expect(responses[2].label).toBe('Third');
    });

    it('should order by created_at when sort_order is equal', () => {
      // Create with small delays to ensure timestamp differences
      repo.create({ projectId, label: 'First', content: 'a', sortOrder: 0 });
      repo.create({ projectId, label: 'Second', content: 'b', sortOrder: 0 });
      repo.create({ projectId, label: 'Third', content: 'c', sortOrder: 0 });

      const responses = repo.getByProjectId(projectId);

      expect(responses[0].label).toBe('First');
      expect(responses[1].label).toBe('Second');
      expect(responses[2].label).toBe('Third');
    });

    it('should not include global responses', () => {
      repo.create({ projectId, label: 'Project', content: 'project' });
      repo.create({ projectId: null, label: 'Global', content: 'global' });

      const responses = repo.getByProjectId(projectId);

      expect(responses).toHaveLength(1);
      expect(responses[0].label).toBe('Project');
    });
  });

  describe('getGlobal()', () => {
    it('should return only responses with project_id = NULL', () => {
      repo.create({ projectId, label: 'Project', content: 'project' });
      repo.create({ projectId: null, label: 'Global1', content: 'global1' });
      repo.create({ projectId: null, label: 'Global2', content: 'global2' });

      const responses = repo.getGlobal();

      expect(responses).toHaveLength(2);
      expect(responses.every((r) => r.projectId === null)).toBe(true);
    });

    it('should return empty array if no global responses exist', () => {
      repo.create({ projectId, label: 'Project', content: 'project' });

      const responses = repo.getGlobal();
      expect(responses).toEqual([]);
    });

    it('should order results by sort_order ascending', () => {
      repo.create({ projectId: null, label: 'Third', content: 'c', sortOrder: 2 });
      repo.create({ projectId: null, label: 'First', content: 'a', sortOrder: 0 });
      repo.create({ projectId: null, label: 'Second', content: 'b', sortOrder: 1 });

      const responses = repo.getGlobal();

      expect(responses[0].label).toBe('First');
      expect(responses[1].label).toBe('Second');
      expect(responses[2].label).toBe('Third');
    });
  });

  describe('getAvailableForProject()', () => {
    it('should return both project and global responses', () => {
      repo.create({ projectId, label: 'Project1', content: 'p1' });
      repo.create({ projectId, label: 'Project2', content: 'p2' });
      repo.create({ projectId: null, label: 'Global1', content: 'g1' });
      repo.create({ projectId: null, label: 'Global2', content: 'g2' });
      repo.create({ projectId: null, label: 'Global3', content: 'g3' });

      const result = repo.getAvailableForProject(projectId);

      expect(result.project).toHaveLength(2);
      expect(result.global).toHaveLength(3);
    });

    it('should return empty arrays if neither exist', () => {
      const result = repo.getAvailableForProject(projectId);

      expect(result.project).toEqual([]);
      expect(result.global).toEqual([]);
    });
  });

  describe('update()', () => {
    it('should update label only', () => {
      const original = repo.create({ projectId, label: 'Old', content: 'content' });
      const updated = repo.update(original.id, { label: 'New' });

      expect(updated.label).toBe('New');
      expect(updated.content).toBe('content');
    });

    it('should update content only', () => {
      const original = repo.create({ projectId, label: 'Label', content: 'Old content' });
      const updated = repo.update(original.id, { content: 'New content' });

      expect(updated.label).toBe('Label');
      expect(updated.content).toBe('New content');
    });

    it('should update autoSubmit flag', () => {
      const original = repo.create({ projectId, label: 'Test', content: 'c', autoSubmit: false });
      const updated = repo.update(original.id, { autoSubmit: true });

      expect(updated.autoSubmit).toBe(true);
    });

    it('should update sortOrder', () => {
      const original = repo.create({ projectId, label: 'Test', content: 'c', sortOrder: 0 });
      const updated = repo.update(original.id, { sortOrder: 5 });

      expect(updated.sortOrder).toBe(5);
    });

    it('should update updated_at timestamp on any change', () => {
      const original = repo.create({ projectId, label: 'Test', content: 'c' });

      // Small delay to ensure timestamp difference
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      const updated = repo.update(original.id, { label: 'New' });
      expect(updated.updatedAt).toBeGreaterThan(original.updatedAt);
    });

    it('should return null for non-existent id', () => {
      const result = repo.update('nonexistent-id', { label: 'New' });
      expect(result).toBeNull();
    });

    it('should handle updating multiple fields at once', () => {
      const original = repo.create({
        projectId,
        label: 'Old',
        content: 'Old content',
        autoSubmit: false,
      });

      const updated = repo.update(original.id, {
        label: 'New',
        content: 'New content',
        autoSubmit: true,
      });

      expect(updated.label).toBe('New');
      expect(updated.content).toBe('New content');
      expect(updated.autoSubmit).toBe(true);
    });

    it('should update category', () => {
      const original = repo.create({
        projectId,
        label: 'Test',
        content: 'c',
        category: 'old',
      });

      const updated = repo.update(original.id, { category: 'new' });
      expect(updated.category).toBe('new');
    });
  });

  describe('updateSortOrder()', () => {
    it('should update sort order for multiple responses', () => {
      const r1 = repo.create({ projectId, label: 'A', content: 'a', sortOrder: 0 });
      const r2 = repo.create({ projectId, label: 'B', content: 'b', sortOrder: 1 });
      const r3 = repo.create({ projectId, label: 'C', content: 'c', sortOrder: 2 });

      repo.updateSortOrder([
        { id: r3.id, sortOrder: 0 },
        { id: r1.id, sortOrder: 1 },
        { id: r2.id, sortOrder: 2 },
      ]);

      const responses = repo.getByProjectId(projectId);
      expect(responses[0].label).toBe('C');
      expect(responses[1].label).toBe('A');
      expect(responses[2].label).toBe('B');
    });
  });

  describe('deleteById()', () => {
    it('should delete response by id', () => {
      const response = repo.create({ projectId, label: 'Test', content: 'c' });
      const deleted = repo.deleteById(response.id);

      expect(deleted).toBe(true);
      expect(repo.getById(response.id)).toBeNull();
    });

    it('should return false for non-existent id', () => {
      const result = repo.deleteById('nonexistent-id');
      expect(result).toBe(false);
    });

    it('should not affect other responses', () => {
      const r1 = repo.create({ projectId, label: 'Test1', content: 'c1' });
      const r2 = repo.create({ projectId, label: 'Test2', content: 'c2' });

      repo.deleteById(r1.id);

      expect(repo.getById(r1.id)).toBeNull();
      expect(repo.getById(r2.id)).toBeDefined();
    });
  });

  describe('deleteByProjectId()', () => {
    it('should delete all responses for a project', () => {
      repo.create({ projectId, label: 'Test1', content: 'c1' });
      repo.create({ projectId, label: 'Test2', content: 'c2' });
      repo.create({ projectId: projectId2, label: 'Other', content: 'other' });

      repo.deleteByProjectId(projectId);

      expect(repo.getByProjectId(projectId)).toEqual([]);
      expect(repo.getByProjectId(projectId2)).toHaveLength(1);
    });
  });

  describe('cascade delete', () => {
    it('should delete all responses when project is deleted', () => {
      repo.create({ projectId, label: 'Test1', content: 'c1' });
      repo.create({ projectId, label: 'Test2', content: 'c2' });
      repo.create({ projectId, label: 'Test3', content: 'c3' });

      projectRepo.delete(projectId);

      const responses = repo.getByProjectId(projectId);
      expect(responses).toEqual([]);
    });

    it('should not delete global responses when a project is deleted', () => {
      repo.create({ projectId: null, label: 'Global', content: 'global' });
      repo.create({ projectId, label: 'Project', content: 'project' });

      projectRepo.delete(projectId);

      const globalResponses = repo.getGlobal();
      expect(globalResponses).toHaveLength(1);
      expect(globalResponses[0].label).toBe('Global');
    });
  });

  describe('getById()', () => {
    it('should return response by id', () => {
      const created = repo.create({ projectId, label: 'Test', content: 'c' });
      const found = repo.getById(created.id);

      expect(found).toBeDefined();
      expect(found.id).toBe(created.id);
      expect(found.label).toBe('Test');
    });

    it('should return null for non-existent id', () => {
      const result = repo.getById('nonexistent-id');
      expect(result).toBeNull();
    });
  });
});
