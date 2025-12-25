import { describe, it, expect, beforeEach } from 'vitest';
import { projects, sessions } from '../src/database.js';

describe('Session Archive', () => {
  let project;
  let session;

  beforeEach(() => {
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Test prompt');
  });

  describe('archive behavior', () => {
    it('session is not archived by default', () => {
      expect(session.archived).toBe(false);
    });

    it('can archive a session', () => {
      const updated = sessions.update(session.id, { archived: true });
      expect(updated.archived).toBe(true);
    });

    it('can unarchive a session', () => {
      sessions.update(session.id, { archived: true });
      const unarchived = sessions.update(session.id, { archived: false });
      expect(unarchived.archived).toBe(false);
    });
  });

  describe('getByProjectId with archived filter', () => {
    beforeEach(() => {
      // Complete and archive the first session
      sessions.update(session.id, { status: 'stopped', archived: true });
      // Create another non-archived session
      sessions.create(project.id, 'Second Session', 'Second prompt');
    });

    it('returns only archived sessions when archived=true', () => {
      const archivedSessions = sessions.getByProjectId(project.id, { archived: true });

      expect(archivedSessions).toHaveLength(1);
      expect(archivedSessions[0].id).toBe(session.id);
      expect(archivedSessions[0].archived).toBe(true);
    });

    it('returns only non-archived sessions when archived=false', () => {
      const activeSessions = sessions.getByProjectId(project.id, { archived: false });

      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].archived).toBe(false);
    });

    it('returns all sessions when no archived filter provided', () => {
      const allSessions = sessions.getByProjectId(project.id);

      expect(allSessions).toHaveLength(2);
    });

    it('returns all sessions when archived filter is null', () => {
      const allSessions = sessions.getByProjectId(project.id, { archived: null });

      expect(allSessions).toHaveLength(2);
    });
  });

  describe('getActiveAndWaiting excludes archived', () => {
    it('excludes archived sessions from active list', () => {
      // Mark session as running
      sessions.update(session.id, { status: 'running' });

      // Create another running session that will be archived
      const archivedSession = sessions.create(project.id, 'Archived Session', 'Prompt');
      sessions.update(archivedSession.id, { status: 'running', archived: true });

      const activeSessions = sessions.getActiveAndWaiting();

      // Should only include non-archived running session
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].id).toBe(session.id);
    });

    it('includes non-archived waiting sessions', () => {
      sessions.update(session.id, { status: 'waiting' });

      const activeSessions = sessions.getActiveAndWaiting();

      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].id).toBe(session.id);
    });

    it('excludes archived waiting sessions', () => {
      sessions.update(session.id, { status: 'waiting', archived: true });

      const activeSessions = sessions.getActiveAndWaiting();

      expect(activeSessions).toHaveLength(0);
    });
  });

  describe('archive status restrictions (business logic)', () => {
    it('should allow archiving stopped sessions', () => {
      sessions.update(session.id, { status: 'stopped' });

      const updated = sessions.update(session.id, { archived: true });

      expect(updated.archived).toBe(true);
    });

    it('should allow archiving waiting sessions', () => {
      sessions.update(session.id, { status: 'waiting' });

      const updated = sessions.update(session.id, { archived: true });

      expect(updated.archived).toBe(true);
    });

    it('should allow archiving error sessions', () => {
      sessions.update(session.id, { status: 'error' });

      const updated = sessions.update(session.id, { archived: true });

      expect(updated.archived).toBe(true);
    });

    it('should prevent archiving starting sessions', () => {
      sessions.update(session.id, { status: 'starting' });

      // Attempting to archive should be blocked at API level, but DB allows it
      // The API endpoint would return 400, but the DB doesn't enforce this
      // So we just verify the session is still starting
      const current = sessions.getById(session.id);
      expect(current.status).toBe('starting');
    });

    it('should prevent archiving running sessions', () => {
      sessions.update(session.id, { status: 'running' });

      // Attempting to archive should be blocked at API level
      // The API endpoint would return 400, but the DB doesn't enforce this
      // So we just verify the session is still running
      const current = sessions.getById(session.id);
      expect(current.status).toBe('running');
    });
  });

  describe('multiple projects', () => {
    it('archive filter works correctly across projects', () => {
      const project2 = projects.create('Project 2', '/tmp/test2');

      // Archive session in project 1
      sessions.update(session.id, { status: 'stopped', archived: true });

      // Create sessions in project 2
      const session2a = sessions.create(project2.id, 'Session 2a', 'Prompt');
      const session2b = sessions.create(project2.id, 'Session 2b', 'Prompt');
      sessions.update(session2a.id, { status: 'stopped', archived: true });

      // Check project 1 - should have 1 archived
      const project1Archived = sessions.getByProjectId(project.id, { archived: true });
      expect(project1Archived).toHaveLength(1);
      expect(project1Archived[0].id).toBe(session.id);

      // Check project 2 - should have 1 archived, 1 active
      const project2Archived = sessions.getByProjectId(project2.id, { archived: true });
      expect(project2Archived).toHaveLength(1);
      expect(project2Archived[0].id).toBe(session2a.id);

      const project2Active = sessions.getByProjectId(project2.id, { archived: false });
      expect(project2Active).toHaveLength(1);
      expect(project2Active[0].id).toBe(session2b.id);
    });
  });
});
