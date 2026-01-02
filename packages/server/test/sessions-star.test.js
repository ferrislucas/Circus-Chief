import { describe, it, expect, beforeEach } from 'vitest';
import { projects, sessions } from '../src/database.js';

describe('Session Star', () => {
  let project;
  let session;

  beforeEach(() => {
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Test prompt');
  });

  describe('star behavior', () => {
    it('session is not starred by default', () => {
      expect(session.starred).toBe(false);
    });

    it('can star a session', () => {
      const updated = sessions.update(session.id, { starred: true });
      expect(updated.starred).toBe(true);
    });

    it('can unstar a session', () => {
      sessions.update(session.id, { starred: true });
      const unstarred = sessions.update(session.id, { starred: false });
      expect(unstarred.starred).toBe(false);
    });

    it('toggle star status', () => {
      expect(session.starred).toBe(false);

      const starred = sessions.update(session.id, { starred: true });
      expect(starred.starred).toBe(true);

      const unstarred = sessions.update(session.id, { starred: !starred.starred });
      expect(unstarred.starred).toBe(false);
    });
  });

  describe('getByProjectId with starred filter', () => {
    beforeEach(() => {
      // Star the first session
      sessions.update(session.id, { starred: true });
      // Create another non-starred session
      sessions.create(project.id, 'Second Session', 'Second prompt');
    });

    it('returns only starred sessions when starred=true', () => {
      const starredSessions = sessions.getByProjectId(project.id, { starred: true });

      expect(starredSessions).toHaveLength(1);
      expect(starredSessions[0].id).toBe(session.id);
      expect(starredSessions[0].starred).toBe(true);
    });

    it('returns only non-starred sessions when starred=false', () => {
      const nonStarredSessions = sessions.getByProjectId(project.id, { starred: false });

      expect(nonStarredSessions).toHaveLength(1);
      expect(nonStarredSessions[0].starred).toBe(false);
    });

    it('returns all sessions when no starred filter provided', () => {
      const allSessions = sessions.getByProjectId(project.id);

      expect(allSessions).toHaveLength(2);
    });

    it('returns all sessions when starred filter is null', () => {
      const allSessions = sessions.getByProjectId(project.id, { starred: null });

      expect(allSessions).toHaveLength(2);
    });

    it('sorts starred sessions first regardless of timestamp', () => {
      // Create a newer non-starred session
      const newerNonStarred = sessions.create(project.id, 'Newer Session', 'Prompt');

      const allSessions = sessions.getByProjectId(project.id);

      // Starred session should come first even if it's older
      expect(allSessions[0].id).toBe(session.id);
      expect(allSessions[0].starred).toBe(true);
      expect(allSessions[1].id).toBe(newerNonStarred.id);
      expect(allSessions[1].starred).toBe(false);
    });
  });

  describe('starred filter with archived sessions', () => {
    it('can star archived sessions', () => {
      const updated = sessions.update(session.id, { archived: true, starred: true });

      expect(updated.archived).toBe(true);
      expect(updated.starred).toBe(true);
    });

    it('starred and archived filters work together', () => {
      const active = sessions.create(project.id, 'Active', 'Prompt');
      const archivedStarred = sessions.create(project.id, 'Archived Starred', 'Prompt');

      sessions.update(session.id, { starred: true });
      sessions.update(active.id, { starred: true });
      sessions.update(archivedStarred.id, { archived: true, starred: true });

      // Get all active starred sessions
      const activeStarred = sessions.getByProjectId(project.id, { archived: false, starred: true });

      expect(activeStarred).toHaveLength(2);
      const ids = activeStarred.map((s) => s.id);
      expect(ids).toContain(session.id);
      expect(ids).toContain(active.id);
      expect(ids).not.toContain(archivedStarred.id);
    });
  });

  describe('multiple projects', () => {
    it('starred filter works correctly across projects', () => {
      const project2 = projects.create('Project 2', '/tmp/test2');

      // Star session in project 1
      sessions.update(session.id, { starred: true });

      // Create sessions in project 2
      const session2a = sessions.create(project2.id, 'Session 2a', 'Prompt');
      const session2b = sessions.create(project2.id, 'Session 2b', 'Prompt');
      sessions.update(session2a.id, { starred: true });

      // Check project 1 - should have 1 starred
      const project1Starred = sessions.getByProjectId(project.id, { starred: true });
      expect(project1Starred).toHaveLength(1);
      expect(project1Starred[0].id).toBe(session.id);

      // Check project 2 - should have 1 starred, 1 not starred
      const project2Starred = sessions.getByProjectId(project2.id, { starred: true });
      expect(project2Starred).toHaveLength(1);
      expect(project2Starred[0].id).toBe(session2a.id);

      const project2NonStarred = sessions.getByProjectId(project2.id, { starred: false });
      expect(project2NonStarred).toHaveLength(1);
      expect(project2NonStarred[0].id).toBe(session2b.id);
    });
  });
});
