import { describe, it, expect, beforeEach } from 'vitest';
import { SessionTemplateRepository } from './SessionTemplateRepository.js';
import { ProjectRepository } from './ProjectRepository.js';

describe('SessionTemplateRepository', () => {
  // Uses global setup from test/setup.js
  let repo;
  let projectRepo;
  let projectId;

  beforeEach(() => {
    projectRepo = new ProjectRepository();
    const project = projectRepo.create('Test Project', '/tmp/test');
    projectId = project.id;
    repo = new SessionTemplateRepository();
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(SessionTemplateRepository);
      expect(repo.tableName).toBe('session_templates');
    });
  });

  describe('create', () => {
    it('creates a global template (projectId is null)', () => {
      const template = repo.create({
        projectId: null,
        name: 'Global Template',
        prompt: 'Do something global',
      });

      expect(template.id).toBeDefined();
      expect(template.projectId).toBeNull();
      expect(template.name).toBe('Global Template');
      expect(template.prompt).toBe('Do something global');
      expect(template.nextTemplateId).toBeNull();
      expect(template.thinkingEnabled).toBeNull();
      expect(template.gitBranch).toBeNull();
      expect(template.gitMode).toBeNull();
      expect(template.model).toBeNull();
      expect(template.createdAt).toBeTypeOf('number');
      expect(template.updatedAt).toBeTypeOf('number');
    });

    it('creates a project template', () => {
      const template = repo.create({
        projectId,
        name: 'Project Template',
        prompt: 'Do something for project',
      });

      expect(template.projectId).toBe(projectId);
      expect(template.name).toBe('Project Template');
    });

    it('creates template with all optional fields', () => {
      const otherTemplate = repo.create({
        projectId: null,
        name: 'Other',
        prompt: 'Other prompt',
      });

      const template = repo.create({
        projectId,
        name: 'Full Template',
        prompt: 'Full prompt with {{parentSession.summary}}',
        nextTemplateId: otherTemplate.id,
        thinkingEnabled: true,
        gitBranch: 'feature-branch',
        gitMode: 'worktree',
        model: 'claude-sonnet-4-5',
      });

      expect(template.nextTemplateId).toBe(otherTemplate.id);
      expect(template.thinkingEnabled).toBe(true);
      expect(template.gitBranch).toBe('feature-branch');
      expect(template.gitMode).toBe('worktree');
      expect(template.model).toBe('claude-sonnet-4-5');
    });

    it('creates template with thinkingEnabled false', () => {
      const template = repo.create({
        projectId: null,
        name: 'No Thinking',
        prompt: 'Prompt',
        thinkingEnabled: false,
      });

      expect(template.thinkingEnabled).toBe(false);
    });
  });

  describe('getById', () => {
    it('retrieves template by ID', () => {
      const created = repo.create({
        projectId: null,
        name: 'Test Template',
        prompt: 'Test prompt',
      });

      const retrieved = repo.getById(created.id);

      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe('Test Template');
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('getGlobal', () => {
    it('returns empty array when no global templates exist', () => {
      const templates = repo.getGlobal();
      expect(templates).toEqual([]);
    });

    it('returns only global templates', () => {
      repo.create({ projectId: null, name: 'Global 1', prompt: 'Prompt 1' });
      repo.create({ projectId: null, name: 'Global 2', prompt: 'Prompt 2' });
      repo.create({ projectId, name: 'Project Template', prompt: 'Prompt 3' });

      const templates = repo.getGlobal();

      expect(templates).toHaveLength(2);
      expect(templates.every((t) => t.projectId === null)).toBe(true);
    });

    it('orders templates by name', () => {
      repo.create({ projectId: null, name: 'Zebra', prompt: 'Prompt' });
      repo.create({ projectId: null, name: 'Alpha', prompt: 'Prompt' });
      repo.create({ projectId: null, name: 'Beta', prompt: 'Prompt' });

      const templates = repo.getGlobal();

      expect(templates[0].name).toBe('Alpha');
      expect(templates[1].name).toBe('Beta');
      expect(templates[2].name).toBe('Zebra');
    });
  });

  describe('getByProjectId', () => {
    it('returns empty array when no project templates exist', () => {
      const templates = repo.getByProjectId(projectId);
      expect(templates).toEqual([]);
    });

    it('returns only templates for the specified project', () => {
      const otherProject = projectRepo.create('Other Project', '/tmp/other');

      repo.create({ projectId, name: 'Project 1 Template', prompt: 'Prompt 1' });
      repo.create({ projectId: otherProject.id, name: 'Project 2 Template', prompt: 'Prompt 2' });
      repo.create({ projectId: null, name: 'Global Template', prompt: 'Prompt 3' });

      const templates = repo.getByProjectId(projectId);

      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('Project 1 Template');
    });

    it('orders templates by name', () => {
      repo.create({ projectId, name: 'Zebra', prompt: 'Prompt' });
      repo.create({ projectId, name: 'Alpha', prompt: 'Prompt' });

      const templates = repo.getByProjectId(projectId);

      expect(templates[0].name).toBe('Alpha');
      expect(templates[1].name).toBe('Zebra');
    });
  });

  describe('getAvailableForProject', () => {
    it('returns both project and global templates', () => {
      repo.create({ projectId: null, name: 'Global 1', prompt: 'Prompt' });
      repo.create({ projectId: null, name: 'Global 2', prompt: 'Prompt' });
      repo.create({ projectId, name: 'Project 1', prompt: 'Prompt' });

      const available = repo.getAvailableForProject(projectId);

      expect(available.project).toHaveLength(1);
      expect(available.global).toHaveLength(2);
      expect(available.project[0].name).toBe('Project 1');
    });

    it('returns empty arrays when no templates exist', () => {
      const available = repo.getAvailableForProject(projectId);

      expect(available.project).toEqual([]);
      expect(available.global).toEqual([]);
    });
  });

  describe('getAll', () => {
    it('returns all templates', () => {
      repo.create({ projectId: null, name: 'Global', prompt: 'Prompt' });
      repo.create({ projectId, name: 'Project', prompt: 'Prompt' });

      const templates = repo.getAll();

      expect(templates).toHaveLength(2);
    });

    it('orders global templates first, then by name', () => {
      repo.create({ projectId, name: 'Project Z', prompt: 'Prompt' });
      repo.create({ projectId: null, name: 'Global B', prompt: 'Prompt' });
      repo.create({ projectId: null, name: 'Global A', prompt: 'Prompt' });

      const templates = repo.getAll();

      expect(templates[0].name).toBe('Global A');
      expect(templates[1].name).toBe('Global B');
      expect(templates[2].name).toBe('Project Z');
    });
  });

  describe('update', () => {
    it('updates template name', () => {
      const template = repo.create({ projectId: null, name: 'Original', prompt: 'Prompt' });
      const updated = repo.update(template.id, { name: 'Updated' });

      expect(updated.name).toBe('Updated');
    });

    it('updates template prompt', () => {
      const template = repo.create({ projectId: null, name: 'Test', prompt: 'Original prompt' });
      const updated = repo.update(template.id, { prompt: 'New prompt' });

      expect(updated.prompt).toBe('New prompt');
    });

    it('updates nextTemplateId', () => {
      const nextTemplate = repo.create({ projectId: null, name: 'Next', prompt: 'Prompt' });
      const template = repo.create({ projectId: null, name: 'Test', prompt: 'Prompt' });

      const updated = repo.update(template.id, { nextTemplateId: nextTemplate.id });

      expect(updated.nextTemplateId).toBe(nextTemplate.id);
    });

    it('clears nextTemplateId when set to null', () => {
      const nextTemplate = repo.create({ projectId: null, name: 'Next', prompt: 'Prompt' });
      const template = repo.create({
        projectId: null,
        name: 'Test',
        prompt: 'Prompt',
        nextTemplateId: nextTemplate.id,
      });

      const updated = repo.update(template.id, { nextTemplateId: null });

      expect(updated.nextTemplateId).toBeNull();
    });

    it('updates thinkingEnabled', () => {
      const template = repo.create({ projectId: null, name: 'Test', prompt: 'Prompt' });
      const updated = repo.update(template.id, { thinkingEnabled: true });

      expect(updated.thinkingEnabled).toBe(true);
    });

    it('updates gitBranch', () => {
      const template = repo.create({ projectId: null, name: 'Test', prompt: 'Prompt' });
      const updated = repo.update(template.id, { gitBranch: 'new-branch' });

      expect(updated.gitBranch).toBe('new-branch');
    });

    it('updates gitMode', () => {
      const template = repo.create({ projectId: null, name: 'Test', prompt: 'Prompt' });
      const updated = repo.update(template.id, { gitMode: 'worktree' });

      expect(updated.gitMode).toBe('worktree');
    });

    it('updates model', () => {
      const template = repo.create({ projectId: null, name: 'Test', prompt: 'Prompt' });
      const updated = repo.update(template.id, { model: 'claude-opus-4-5' });

      expect(updated.model).toBe('claude-opus-4-5');
    });

    it('clears model when set to null', () => {
      const template = repo.create({ projectId: null, name: 'Test', prompt: 'Prompt', model: 'claude-sonnet-4-5' });
      const updated = repo.update(template.id, { model: null });

      expect(updated.model).toBeNull();
    });

    it('updates multiple fields at once', () => {
      const template = repo.create({ projectId: null, name: 'Test', prompt: 'Prompt' });
      const updated = repo.update(template.id, {
        name: 'New Name',
        prompt: 'New Prompt',
        thinkingEnabled: true,
      });

      expect(updated.name).toBe('New Name');
      expect(updated.prompt).toBe('New Prompt');
      expect(updated.thinkingEnabled).toBe(true);
    });

    it('returns unchanged template when no updates provided', () => {
      const template = repo.create({ projectId: null, name: 'Test', prompt: 'Prompt' });
      const result = repo.update(template.id, {});

      expect(result.name).toBe('Test');
      expect(result.prompt).toBe('Prompt');
    });
  });

  describe('delete', () => {
    it('deletes a template', () => {
      const template = repo.create({ projectId: null, name: 'Test', prompt: 'Prompt' });
      repo.delete(template.id);

      expect(repo.getById(template.id)).toBeNull();
    });
  });

  describe('cascade delete', () => {
    it('deletes project templates when project is deleted', () => {
      const template = repo.create({ projectId, name: 'Test', prompt: 'Prompt' });
      projectRepo.delete(projectId);

      expect(repo.getById(template.id)).toBeNull();
    });

    it('sets nextTemplateId to null when referenced template is deleted', () => {
      const nextTemplate = repo.create({ projectId: null, name: 'Next', prompt: 'Prompt' });
      const template = repo.create({
        projectId: null,
        name: 'Test',
        prompt: 'Prompt',
        nextTemplateId: nextTemplate.id,
      });

      repo.delete(nextTemplate.id);
      const updated = repo.getById(template.id);

      expect(updated.nextTemplateId).toBeNull();
    });
  });
});
