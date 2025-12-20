import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { projects, sessions } from '../src/database.js';

describe('Session Modes', () => {
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

  describe('Session creation with mode', () => {
    it('creates session with default mode (standard)', () => {
      const session = sessions.create(project.id, 'Default Mode', 'prompt');
      expect(session.mode).toBe('standard');
    });

    it('creates session with plan mode', () => {
      const session = sessions.create(project.id, 'Plan Mode', 'prompt', 'plan');
      expect(session.mode).toBe('plan');
    });

    it('creates session with standard mode', () => {
      const session = sessions.create(project.id, 'Standard Mode', 'prompt', 'standard');
      expect(session.mode).toBe('standard');
    });

    it('creates session with yolo mode', () => {
      const session = sessions.create(project.id, 'Yolo Mode', 'prompt', 'yolo');
      expect(session.mode).toBe('yolo');
    });
  });

  describe('Session mode updates', () => {
    it('updates mode from standard to plan', () => {
      const session = sessions.create(project.id, 'Test', 'prompt', 'standard');
      const updated = sessions.update(session.id, { mode: 'plan' });
      expect(updated.mode).toBe('plan');
    });

    it('updates mode from standard to yolo', () => {
      const session = sessions.create(project.id, 'Test', 'prompt', 'standard');
      const updated = sessions.update(session.id, { mode: 'yolo' });
      expect(updated.mode).toBe('yolo');
    });

    it('updates mode from yolo to plan', () => {
      const session = sessions.create(project.id, 'Test', 'prompt', 'yolo');
      const updated = sessions.update(session.id, { mode: 'plan' });
      expect(updated.mode).toBe('plan');
    });

    it('preserves other fields when updating mode', () => {
      const session = sessions.create(project.id, 'Test', 'prompt', 'standard');
      sessions.update(session.id, { thinkingEnabled: true });
      const updated = sessions.update(session.id, { mode: 'yolo' });
      expect(updated.mode).toBe('yolo');
      expect(updated.thinkingEnabled).toBe(true);
    });

    it('returns null when updating non-existent session', () => {
      const result = sessions.update('non-existent-id', { mode: 'plan' });
      expect(result).toBeNull();
    });
  });

  describe('Session mode retrieval', () => {
    it('retrieves session with correct mode', () => {
      const created = sessions.create(project.id, 'Test', 'prompt', 'plan');
      const retrieved = sessions.getById(created.id);
      expect(retrieved.mode).toBe('plan');
    });

    it('retrieves all sessions with different modes', () => {
      sessions.create(project.id, 'Plan Session', 'prompt', 'plan');
      sessions.create(project.id, 'Standard Session', 'prompt', 'standard');
      sessions.create(project.id, 'Yolo Session', 'prompt', 'yolo');

      const allSessions = sessions.getByProjectId(project.id);
      expect(allSessions).toHaveLength(3);

      const modes = allSessions.map((s) => s.mode).sort();
      expect(modes).toEqual(['plan', 'standard', 'yolo']);
    });
  });
});
