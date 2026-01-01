import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { projects, sessions } from '../src/database.js';

describe('Session Models', () => {
  let project;

  beforeEach(() => {
    project = projects.create('Test Project', '/tmp/test');
  });

  afterEach(() => {
    // Clean up
    const allSessions = sessions.getByProjectId(project.id);
    allSessions.forEach((s) => sessions.delete(s.id));
    projects.delete(project.id);
  });

  describe('Session creation with model', () => {
    it('creates session with null model by default', () => {
      const session = sessions.create(project.id, 'Default Model', 'prompt');
      expect(session.model).toBeNull();
    });

    it('creates session with claude-sonnet-4-5 model', () => {
      const session = sessions.create(project.id, 'Sonnet Session', 'prompt', 'standard', false, null, 'claude-sonnet-4-5-20250929');
      expect(session.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('creates session with claude-opus-4-5 model', () => {
      const session = sessions.create(project.id, 'Opus Session', 'prompt', 'standard', false, null, 'claude-opus-4-5-20251101');
      expect(session.model).toBe('claude-opus-4-5-20251101');
    });

    it('creates session with claude-haiku-4-5 model', () => {
      const session = sessions.create(project.id, 'Haiku Session', 'prompt', 'standard', false, null, 'claude-haiku-4-5-20251001');
      expect(session.model).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('Session model updates', () => {
    it('updates model from null to sonnet', () => {
      const session = sessions.create(project.id, 'Test', 'prompt');
      expect(session.model).toBeNull();

      const updated = sessions.update(session.id, { model: 'claude-sonnet-4-5-20250929' });
      expect(updated.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('updates model from sonnet to opus', () => {
      const session = sessions.create(project.id, 'Test', 'prompt', 'standard', false, null, 'claude-sonnet-4-5-20250929');
      const updated = sessions.update(session.id, { model: 'claude-opus-4-5-20251101' });
      expect(updated.model).toBe('claude-opus-4-5-20251101');
    });

    it('updates model from opus to haiku', () => {
      const session = sessions.create(project.id, 'Test', 'prompt', 'standard', false, null, 'claude-opus-4-5-20251101');
      const updated = sessions.update(session.id, { model: 'claude-haiku-4-5-20251001' });
      expect(updated.model).toBe('claude-haiku-4-5-20251001');
    });

    it('preserves other fields when updating model', () => {
      const session = sessions.create(project.id, 'Test', 'prompt', 'yolo', true);
      const updated = sessions.update(session.id, { model: 'claude-opus-4-5-20251101' });

      expect(updated.model).toBe('claude-opus-4-5-20251101');
      expect(updated.mode).toBe('yolo');
      expect(updated.thinkingEnabled).toBe(true);
    });
  });

  describe('Session model retrieval', () => {
    it('retrieves session with correct model', () => {
      const created = sessions.create(project.id, 'Test', 'prompt', 'standard', false, null, 'claude-opus-4-5-20251101');
      const retrieved = sessions.getById(created.id);
      expect(retrieved.model).toBe('claude-opus-4-5-20251101');
    });

    it('retrieves all sessions with different models', () => {
      sessions.create(project.id, 'Sonnet Session', 'prompt', 'standard', false, null, 'claude-sonnet-4-5-20250929');
      sessions.create(project.id, 'Opus Session', 'prompt', 'standard', false, null, 'claude-opus-4-5-20251101');
      sessions.create(project.id, 'Haiku Session', 'prompt', 'standard', false, null, 'claude-haiku-4-5-20251001');

      const allSessions = sessions.getByProjectId(project.id);
      expect(allSessions).toHaveLength(3);

      const models = allSessions.map((s) => s.model).sort();
      expect(models).toEqual([
        'claude-haiku-4-5-20251001',
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-5-20250929',
      ]);
    });
  });
});
