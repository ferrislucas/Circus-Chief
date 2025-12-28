import { describe, it, expect, beforeEach } from 'vitest';
import { CommandButtonRepository } from './CommandButtonRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('CommandButtonRepository', () => {
  let repo;
  let projectRepo;
  let projectId;

  beforeEach(() => {
    repo = new CommandButtonRepository();
    projectRepo = new ProjectRepository();

    const project = projectRepo.create('Test Project', '/tmp/test');
    projectId = project.id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(CommandButtonRepository);
      expect(repo.tableName).toBe('command_buttons');
    });
  });

  describe('create', () => {
    it('creates a button with all fields', () => {
      const button = repo.create({
        projectId,
        label: 'Build',
        command: 'npm run build',
        sortOrder: 1,
      });

      expect(button.id).toBeDefined();
      expect(button.projectId).toBe(projectId);
      expect(button.label).toBe('Build');
      expect(button.command).toBe('npm run build');
      expect(button.sortOrder).toBe(1);
      expect(button.createdAt).toBeTypeOf('number');
      expect(button.updatedAt).toBeTypeOf('number');
    });

    it('creates a button with showOnList enabled', () => {
      const button = repo.create({
        projectId,
        label: 'Important Build',
        command: 'npm run build',
        sortOrder: 1,
        showOnList: true,
      });

      expect(button.showOnList).toBe(true);
    });

    it('creates a button with default showOnList (false)', () => {
      const button = repo.create({
        projectId,
        label: 'Hidden Button',
        command: 'npm run hidden',
      });

      expect(button.showOnList).toBe(false);
    });

    it('creates a button with explicit showOnList false', () => {
      const button = repo.create({
        projectId,
        label: 'Explicit False',
        command: 'npm run explicit',
        showOnList: false,
      });

      expect(button.showOnList).toBe(false);
    });

    it('creates a button with default sortOrder', () => {
      const button = repo.create({
        projectId,
        label: 'Test',
        command: 'npm test',
      });

      expect(button.sortOrder).toBe(0);
    });

    it('sets createdAt and updatedAt to same value on creation', () => {
      const button = repo.create({
        projectId,
        label: 'Deploy',
        command: 'npm run deploy',
      });

      expect(button.createdAt).toBe(button.updatedAt);
    });

    it('generates unique IDs', () => {
      const button1 = repo.create({
        projectId,
        label: 'Button 1',
        command: 'cmd1',
      });
      const button2 = repo.create({
        projectId,
        label: 'Button 2',
        command: 'cmd2',
      });

      expect(button1.id).not.toBe(button2.id);
    });
  });

  describe('getById', () => {
    it('retrieves button by ID', () => {
      const created = repo.create({
        projectId,
        label: 'Test Button',
        command: 'echo test',
      });
      const retrieved = repo.getById(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('getByProjectId', () => {
    it('returns empty array when no buttons exist', () => {
      const buttons = repo.getByProjectId(projectId);
      expect(buttons).toEqual([]);
    });

    it('returns all buttons for a project', () => {
      repo.create({ projectId, label: 'Button 1', command: 'cmd1' });
      repo.create({ projectId, label: 'Button 2', command: 'cmd2' });
      repo.create({ projectId, label: 'Button 3', command: 'cmd3' });

      const buttons = repo.getByProjectId(projectId);

      expect(buttons).toHaveLength(3);
    });

    it('returns buttons ordered by sort_order ascending', () => {
      const b3 = repo.create({ projectId, label: 'Last', command: 'cmd', sortOrder: 2 });
      const b1 = repo.create({ projectId, label: 'First', command: 'cmd', sortOrder: 0 });
      const b2 = repo.create({ projectId, label: 'Second', command: 'cmd', sortOrder: 1 });

      const buttons = repo.getByProjectId(projectId);

      expect(buttons).toHaveLength(3);
      expect(buttons[0].sortOrder).toBe(0);
      expect(buttons[1].sortOrder).toBe(1);
      expect(buttons[2].sortOrder).toBe(2);
    });

    it('returns buttons with same sort_order ordered by created_at', () => {
      const b1 = repo.create({ projectId, label: 'First', command: 'cmd1', sortOrder: 0 });
      const b2 = repo.create({ projectId, label: 'Second', command: 'cmd2', sortOrder: 0 });

      const buttons = repo.getByProjectId(projectId);

      expect(buttons).toHaveLength(2);
      expect(buttons[0].id).toBe(b1.id);
      expect(buttons[1].id).toBe(b2.id);
    });

    it('does not return buttons from other projects', () => {
      const project2 = projectRepo.create('Other Project', '/tmp/other');

      repo.create({ projectId, label: 'Project 1 button', command: 'cmd1' });
      repo.create({ projectId: project2.id, label: 'Project 2 button', command: 'cmd2' });

      const buttons = repo.getByProjectId(projectId);

      expect(buttons).toHaveLength(1);
      expect(buttons[0].label).toBe('Project 1 button');
    });
  });

  describe('update', () => {
    it('updates button label', () => {
      const button = repo.create({
        projectId,
        label: 'Original',
        command: 'cmd',
      });
      const updated = repo.update(button.id, { label: 'Updated' });

      expect(updated.label).toBe('Updated');
    });

    it('updates button command', () => {
      const button = repo.create({
        projectId,
        label: 'Test',
        command: 'original cmd',
      });
      const updated = repo.update(button.id, { command: 'new cmd' });

      expect(updated.command).toBe('new cmd');
    });

    it('updates button sortOrder', () => {
      const button = repo.create({
        projectId,
        label: 'Test',
        command: 'cmd',
        sortOrder: 0,
      });
      const updated = repo.update(button.id, { sortOrder: 5 });

      expect(updated.sortOrder).toBe(5);
    });

    it('updates button showOnList from false to true', () => {
      const button = repo.create({
        projectId,
        label: 'Test',
        command: 'cmd',
        showOnList: false,
      });
      const updated = repo.update(button.id, { showOnList: true });

      expect(updated.showOnList).toBe(true);
    });

    it('updates button showOnList from true to false', () => {
      const button = repo.create({
        projectId,
        label: 'Test',
        command: 'cmd',
        showOnList: true,
      });
      const updated = repo.update(button.id, { showOnList: false });

      expect(updated.showOnList).toBe(false);
    });

    it('updates multiple fields at once', () => {
      const button = repo.create({
        projectId,
        label: 'Original',
        command: 'original',
        sortOrder: 0,
      });
      const updated = repo.update(button.id, {
        label: 'New Label',
        command: 'new cmd',
        sortOrder: 10,
      });

      expect(updated.label).toBe('New Label');
      expect(updated.command).toBe('new cmd');
      expect(updated.sortOrder).toBe(10);
    });

    it('updates all fields including showOnList at once', () => {
      const button = repo.create({
        projectId,
        label: 'Original',
        command: 'original',
        sortOrder: 0,
        showOnList: false,
      });
      const updated = repo.update(button.id, {
        label: 'New Label',
        command: 'new cmd',
        sortOrder: 5,
        showOnList: true,
      });

      expect(updated.label).toBe('New Label');
      expect(updated.command).toBe('new cmd');
      expect(updated.sortOrder).toBe(5);
      expect(updated.showOnList).toBe(true);
    });

    it('updates updatedAt timestamp', () => {
      const button = repo.create({
        projectId,
        label: 'Test',
        command: 'cmd',
      });
      const originalUpdatedAt = button.updatedAt;

      const updated = repo.update(button.id, { label: 'Changed' });

      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('preserves createdAt timestamp', () => {
      const button = repo.create({
        projectId,
        label: 'Test',
        command: 'cmd',
      });
      const createdAt = button.createdAt;

      const updated = repo.update(button.id, { label: 'Changed' });

      expect(updated.createdAt).toBe(createdAt);
    });

    it('preserves projectId', () => {
      const button = repo.create({
        projectId,
        label: 'Test',
        command: 'cmd',
      });

      const updated = repo.update(button.id, { label: 'Changed' });

      expect(updated.projectId).toBe(projectId);
    });

    it('preserves showOnList when not provided in update', () => {
      const button = repo.create({
        projectId,
        label: 'Test',
        command: 'cmd',
        showOnList: true,
      });

      const updated = repo.update(button.id, { label: 'Changed' });

      expect(updated.showOnList).toBe(true);
    });

    it('returns unchanged button when no updates provided', () => {
      const button = repo.create({
        projectId,
        label: 'Test',
        command: 'cmd',
      });

      const unchanged = repo.update(button.id, {});

      expect(unchanged.id).toBe(button.id);
      expect(unchanged.label).toBe(button.label);
      expect(unchanged.updatedAt).toBe(button.updatedAt);
    });
  });

  describe('delete', () => {
    it('deletes a button', () => {
      const button = repo.create({
        projectId,
        label: 'Delete me',
        command: 'cmd',
      });

      repo.delete(button.id);

      expect(repo.getById(button.id)).toBeNull();
    });

    it('does not throw when deleting non-existent button', () => {
      expect(() => repo.delete('non-existent')).not.toThrow();
    });

    it('does not affect other buttons', () => {
      const button1 = repo.create({
        projectId,
        label: 'Button 1',
        command: 'cmd1',
      });
      const button2 = repo.create({
        projectId,
        label: 'Button 2',
        command: 'cmd2',
      });

      repo.delete(button1.id);

      expect(repo.getById(button1.id)).toBeNull();
      expect(repo.getById(button2.id)).not.toBeNull();
    });
  });

  describe('cascade delete', () => {
    it('deletes buttons when project is deleted', () => {
      const button = repo.create({
        projectId,
        label: 'Test Button',
        command: 'cmd',
      });

      projectRepo.delete(projectId);

      expect(repo.getById(button.id)).toBeNull();
    });
  });
});
