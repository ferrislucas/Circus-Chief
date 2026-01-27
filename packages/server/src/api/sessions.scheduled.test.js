import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions } from '../database.js';

// Mock websocket
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

describe('Sessions API - Scheduled Endpoints', () => {
  let project1;
  let project2;

  beforeEach(() => {
    vi.clearAllMocks();
    project1 = projects.create('Project 1', '/tmp/project1');
    project2 = projects.create('Project 2', '/tmp/project2');
  });

  describe('GET /sessions/scheduled', () => {
    it('returns all scheduled sessions across all projects', () => {
      // Create scheduled sessions for both projects
      const session1 = sessions.create(project1.id, 'Session 1', 'Prompt 1', 'standard', false, null, null, 'scheduled');
      sessions.update(session1.id, { scheduledAt: Date.now() + 1000 }); // 1 second from now

      const session2 = sessions.create(project2.id, 'Session 2', 'Prompt 2', 'standard', false, null, null, 'scheduled');
      sessions.update(session2.id, { scheduledAt: Date.now() + 2000 }); // 2 seconds from now

      const session3 = sessions.create(project1.id, 'Session 3', 'Prompt 3', 'standard', false, null, null, 'scheduled');
      sessions.update(session3.id, { scheduledAt: Date.now() + 500 }); // 0.5 seconds from now

      // Get all scheduled sessions without filter
      const result = sessions.getScheduledSessions();

      expect(result).toHaveLength(3);
      expect(result.map(s => s.id)).toContain(session1.id);
      expect(result.map(s => s.id)).toContain(session2.id);
      expect(result.map(s => s.id)).toContain(session3.id);
    });

    it('returns scheduled sessions sorted by scheduledAt (earliest first)', () => {
      const now = Date.now();

      const session1 = sessions.create(project1.id, 'Session 1', 'Prompt 1', 'standard', false, null, null, 'scheduled');
      sessions.update(session1.id, { scheduledAt: now + 3000 }); // Latest

      const session2 = sessions.create(project1.id, 'Session 2', 'Prompt 2', 'standard', false, null, null, 'scheduled');
      sessions.update(session2.id, { scheduledAt: now + 1000 }); // Earliest

      const session3 = sessions.create(project1.id, 'Session 3', 'Prompt 3', 'standard', false, null, null, 'scheduled');
      sessions.update(session3.id, { scheduledAt: now + 2000 }); // Middle

      const result = sessions.getScheduledSessions();

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(session2.id); // Earliest first
      expect(result[1].id).toBe(session3.id); // Middle
      expect(result[2].id).toBe(session1.id); // Latest last
    });

    it('filters scheduled sessions by project ID', () => {
      const session1 = sessions.create(project1.id, 'Session 1', 'Prompt 1', 'standard', false, null, null, 'scheduled');
      sessions.update(session1.id, { scheduledAt: Date.now() + 1000 });

      const session2 = sessions.create(project2.id, 'Session 2', 'Prompt 2', 'standard', false, null, null, 'scheduled');
      sessions.update(session2.id, { scheduledAt: Date.now() + 2000 });

      // Get scheduled sessions filtered by project1
      const result = sessions.getScheduledSessions(project1.id);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(session1.id);
      expect(result[0].projectId).toBe(project1.id);
    });

    it('excludes non-scheduled sessions', () => {
      sessions.create(project1.id, 'Running', 'Prompt', 'standard', false, null, null, 'running');
      sessions.create(project1.id, 'Completed', 'Prompt', 'standard', false, null, null, 'completed');
      sessions.create(project1.id, 'Waiting', 'Prompt', 'standard', false, null, null, 'waiting');

      const scheduledSession = sessions.create(project1.id, 'Scheduled', 'Prompt', 'standard', false, null, null, 'scheduled');
      sessions.update(scheduledSession.id, { scheduledAt: Date.now() + 1000 });

      const result = sessions.getScheduledSessions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(scheduledSession.id);
    });

    it('excludes archived scheduled sessions', () => {
      const session1 = sessions.create(project1.id, 'Session 1', 'Prompt 1', 'standard', false, null, null, 'scheduled');
      sessions.update(session1.id, { scheduledAt: Date.now() + 1000 });

      const session2 = sessions.create(project1.id, 'Session 2', 'Prompt 2', 'standard', false, null, null, 'scheduled');
      sessions.update(session2.id, { scheduledAt: Date.now() + 2000, archived: true });

      const result = sessions.getScheduledSessions();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(session1.id);
    });

    it('includes project name in results', () => {
      const session = sessions.create(project1.id, 'Session', 'Prompt', 'standard', false, null, null, 'scheduled');
      sessions.update(session.id, { scheduledAt: Date.now() + 1000 });

      const result = sessions.getScheduledSessions();

      expect(result).toHaveLength(1);
      expect(result[0].projectName).toBe('Project 1');
    });

    it('returns empty array when no scheduled sessions exist', () => {
      sessions.create(project1.id, 'Running', 'Prompt', 'standard', false, null, null, 'running');

      const result = sessions.getScheduledSessions();

      expect(result).toHaveLength(0);
    });

    it('returns empty array when filtering by project with no scheduled sessions', () => {
      const session = sessions.create(project1.id, 'Session', 'Prompt', 'standard', false, null, null, 'scheduled');
      sessions.update(session.id, { scheduledAt: Date.now() + 1000 });

      const result = sessions.getScheduledSessions(project2.id);

      expect(result).toHaveLength(0);
    });
  });
});
