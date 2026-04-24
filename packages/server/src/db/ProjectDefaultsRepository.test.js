import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectDefaultsRepository } from './ProjectDefaultsRepository.js';
import { ProjectRepository } from './ProjectRepository.js';

describe('ProjectDefaultsRepository', () => {
  let defaultsRepo;
  let projectRepo;
  let projectId;

  beforeEach(() => {
    defaultsRepo = new ProjectDefaultsRepository();
    projectRepo = new ProjectRepository();

    // Create a test project
    const project = projectRepo.create('Test Project', '/tmp/test');
    projectId = project.id;
  });

  describe('getByProjectId', () => {
    it('returns null for non-existent project', () => {
      const defaults = defaultsRepo.getByProjectId('nonexistent-id');
      expect(defaults).toBeNull();
    });

    it('returns defaults object with correct structure', () => {
      defaultsRepo.upsert(projectId, { mode: 'plan', thinkingEnabled: true });
      const defaults = defaultsRepo.getByProjectId(projectId);

      expect(defaults).toBeDefined();
      expect(defaults).toHaveProperty('id');
      expect(defaults).toHaveProperty('projectId');
      expect(defaults).toHaveProperty('mode');
      expect(defaults).toHaveProperty('thinkingEnabled');
      expect(defaults).toHaveProperty('startImmediately');
      expect(defaults).toHaveProperty('gitMode');
      expect(defaults).toHaveProperty('gitBranch');
      expect(defaults).toHaveProperty('model');
      expect(defaults).toHaveProperty('effortLevel');
      expect(defaults).toHaveProperty('createdAt');
      expect(defaults).toHaveProperty('updatedAt');
    });
  });

  describe('upsert', () => {
    it('creates new defaults record if not exists', () => {
      const defaults = defaultsRepo.upsert(projectId, { mode: 'plan' });

      expect(defaults).toBeDefined();
      expect(defaults.projectId).toBe(projectId);
      expect(defaults.mode).toBe('plan');
      expect(defaults.createdAt).toBeTypeOf('number');
      expect(defaults.updatedAt).toBeTypeOf('number');
    });

    it('updates existing defaults record', () => {
      defaultsRepo.upsert(projectId, { mode: 'plan' });
      const updated = defaultsRepo.upsert(projectId, { mode: 'standard' });

      expect(updated.mode).toBe('standard');
    });

    it('allows partial updates preserving existing values', () => {
      defaultsRepo.upsert(projectId, { mode: 'plan', thinkingEnabled: true });
      const updated = defaultsRepo.upsert(projectId, { model: 'claude-opus' });

      expect(updated.mode).toBe('plan');
      expect(updated.thinkingEnabled).toBe(true);
      expect(updated.model).toBe('claude-opus');
    });

    it('sets thinking_enabled to false when passed false', () => {
      const defaults = defaultsRepo.upsert(projectId, { thinkingEnabled: false });
      expect(defaults.thinkingEnabled).toBe(false);
    });

    it('sets start_immediately to false when passed false', () => {
      const defaults = defaultsRepo.upsert(projectId, { startImmediately: false });
      expect(defaults.startImmediately).toBe(false);
    });

    it('accepts all valid mode enum values', () => {
      for (const mode of ['plan', 'standard', 'yolo']) {
        const defaults = defaultsRepo.upsert(projectId, { mode });
        expect(defaults.mode).toBe(mode);
      }
    });

    it('accepts valid gitMode enum values', () => {
      for (const gitMode of ['branch', 'worktree']) {
        const defaults = defaultsRepo.upsert(projectId, { gitMode });
        expect(defaults.gitMode).toBe(gitMode);
      }
    });

    it('accepts gitMode as null (no git isolation)', () => {
      const defaults = defaultsRepo.upsert(projectId, { gitMode: null });
      expect(defaults.gitMode).toBeNull();
    });

    it('stores model string', () => {
      const defaults = defaultsRepo.upsert(projectId, { model: 'claude-opus-4' });
      expect(defaults.model).toBe('claude-opus-4');
    });

    it('stores gitBranch string', () => {
      const defaults = defaultsRepo.upsert(projectId, { gitBranch: 'feature/test' });
      expect(defaults.gitBranch).toBe('feature/test');
    });

    it('stores effortLevel string', () => {
      const defaults = defaultsRepo.upsert(projectId, { effortLevel: 'high' });
      expect(defaults.effortLevel).toBe('high');
    });

    it('accepts all valid effortLevel enum values', () => {
      for (const effortLevel of ['low', 'medium', 'high', 'max', 'auto']) {
        const defaults = defaultsRepo.upsert(projectId, { effortLevel });
        expect(defaults.effortLevel).toBe(effortLevel);
      }
    });

    it('accepts effortLevel as null', () => {
      const defaults = defaultsRepo.upsert(projectId, { effortLevel: null });
      expect(defaults.effortLevel).toBeNull();
    });

    it('updates updatedAt timestamp on update', () => {
      const first = defaultsRepo.upsert(projectId, { mode: 'plan' });

      // Small delay to ensure timestamp difference
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      const second = defaultsRepo.upsert(projectId, { thinkingEnabled: true });
      expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
    });

    it('creates defaults with all fields provided', () => {
      const defaults = defaultsRepo.upsert(projectId, {
        mode: 'plan',
        thinkingEnabled: true,
        startImmediately: false,
        gitMode: 'worktree',
        gitBranch: 'feature/test',
        model: 'claude-opus',
        effortLevel: 'max',
      });

      expect(defaults.mode).toBe('plan');
      expect(defaults.thinkingEnabled).toBe(true);
      expect(defaults.startImmediately).toBe(false);
      expect(defaults.gitMode).toBe('worktree');
      expect(defaults.gitBranch).toBe('feature/test');
      expect(defaults.model).toBe('claude-opus');
      expect(defaults.effortLevel).toBe('max');
    });

    it('creates defaults with empty object (all fields null)', () => {
      const defaults = defaultsRepo.upsert(projectId, {});

      expect(defaults.mode).toBeNull();
      expect(defaults.thinkingEnabled).toBeNull();
      expect(defaults.startImmediately).toBeNull();
      expect(defaults.gitMode).toBeNull();
      expect(defaults.gitBranch).toBeNull();
      expect(defaults.model).toBeNull();
      expect(defaults.effortLevel).toBeNull();
    });
  });

  describe('resetToDefaults', () => {
    it('sets all fields to null', () => {
      defaultsRepo.upsert(projectId, {
        mode: 'plan',
        thinkingEnabled: true,
        gitMode: 'worktree',
        model: 'claude-opus',
        effortLevel: 'high',
      });

      const reset = defaultsRepo.resetToDefaults(projectId);

      expect(reset.mode).toBeNull();
      expect(reset.thinkingEnabled).toBeNull();
      expect(reset.startImmediately).toBeNull();
      expect(reset.gitMode).toBeNull();
      expect(reset.gitBranch).toBeNull();
      expect(reset.model).toBeNull();
      expect(reset.effortLevel).toBeNull();
    });

    it('updates updatedAt timestamp', () => {
      const first = defaultsRepo.upsert(projectId, { mode: 'plan' });

      // Small delay
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }

      const reset = defaultsRepo.resetToDefaults(projectId);
      expect(reset.updatedAt).toBeGreaterThan(first.updatedAt);
    });

    it('returns null for non-existent project', () => {
      const result = defaultsRepo.resetToDefaults('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('deleteByProjectId', () => {
    it('deletes defaults record for project', () => {
      defaultsRepo.upsert(projectId, { mode: 'plan' });
      defaultsRepo.deleteByProjectId(projectId);

      const result = defaultsRepo.getByProjectId(projectId);
      expect(result).toBeNull();
    });

    it('handles deleting non-existent record gracefully', () => {
      expect(() => {
        defaultsRepo.deleteByProjectId('nonexistent-id');
      }).not.toThrow();
    });
  });

  describe('getSystemDefaults', () => {
    it('returns system default values', () => {
      const defaults = ProjectDefaultsRepository.getSystemDefaults();

      expect(defaults.mode).toBe('yolo');
      expect(defaults.thinkingEnabled).toBe(true);
      expect(defaults.startImmediately).toBe(true);
      expect(defaults.gitMode).toBe('worktree');
      expect(defaults.gitBranch).toBeNull();
      expect(defaults.model).toBeNull();
      expect(defaults.effortLevel).toBeNull();
    });

    it('returns consistent system defaults', () => {
      const defaults1 = ProjectDefaultsRepository.getSystemDefaults();
      const defaults2 = ProjectDefaultsRepository.getSystemDefaults();

      expect(defaults1).toEqual(defaults2);
    });
  });
});
