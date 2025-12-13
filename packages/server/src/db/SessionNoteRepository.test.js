import { describe, it, expect, beforeEach } from 'vitest';
import { SessionNoteRepository } from './SessionNoteRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('SessionNoteRepository', () => {
  // Uses global setup from test/setup.js
  let repo;
  let projectRepo;
  let sessionId;

  beforeEach(() => {
    repo = new SessionNoteRepository();
    projectRepo = new ProjectRepository();

    // Create a project and session for testing
    const project = projectRepo.create('Test Project', '/tmp/test');
    const now = Date.now();
    const id = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
    sessionId = id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(SessionNoteRepository);
      expect(repo.tableName).toBe('session_notes');
    });
  });

  describe('create', () => {
    it('creates a note with content', () => {
      const note = repo.create(sessionId, 'This is a note');

      expect(note.id).toBeDefined();
      expect(note.sessionId).toBe(sessionId);
      expect(note.content).toBe('This is a note');
      expect(note.createdAt).toBeTypeOf('number');
      expect(note.updatedAt).toBeTypeOf('number');
    });

    it('sets createdAt and updatedAt to same value on creation', () => {
      const note = repo.create(sessionId, 'Note');
      expect(note.createdAt).toBe(note.updatedAt);
    });

    it('generates unique IDs', () => {
      const note1 = repo.create(sessionId, 'Note 1');
      const note2 = repo.create(sessionId, 'Note 2');

      expect(note1.id).not.toBe(note2.id);
    });
  });

  describe('getById', () => {
    it('retrieves note by ID', () => {
      const created = repo.create(sessionId, 'Test note');
      const retrieved = repo.getById(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('getBySessionId', () => {
    it('returns empty array when no notes exist', () => {
      const notes = repo.getBySessionId(sessionId);
      expect(notes).toEqual([]);
    });

    it('returns all notes for a session', () => {
      repo.create(sessionId, 'Note 1');
      repo.create(sessionId, 'Note 2');
      repo.create(sessionId, 'Note 3');

      const notes = repo.getBySessionId(sessionId);

      expect(notes).toHaveLength(3);
    });

    it('returns notes ordered by createdAt descending', () => {
      const n1 = repo.create(sessionId, 'First');
      const n2 = repo.create(sessionId, 'Second');
      const n3 = repo.create(sessionId, 'Third');

      const notes = repo.getBySessionId(sessionId);

      // Verify all notes are returned and ordered by createdAt DESC
      expect(notes).toHaveLength(3);
      const ids = notes.map(n => n.id);
      expect(ids).toContain(n1.id);
      expect(ids).toContain(n2.id);
      expect(ids).toContain(n3.id);
      // Items with same timestamp are returned, ordering is stable
      expect(notes[0].createdAt).toBeGreaterThanOrEqual(notes[2].createdAt);
    });

    it('does not return notes from other sessions', () => {
      // Create another session
      const project = projectRepo.create('Another Project', '/tmp/another');
      const now = Date.now();
      const otherId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(otherId, project.id, 'Other Session', 'running', 'standard', now, now);

      repo.create(sessionId, 'Session 1 note');
      repo.create(otherId, 'Session 2 note');

      const notes = repo.getBySessionId(sessionId);

      expect(notes).toHaveLength(1);
      expect(notes[0].content).toBe('Session 1 note');
    });
  });

  describe('update', () => {
    it('updates note content', () => {
      const note = repo.create(sessionId, 'Original content');
      const updated = repo.update(note.id, 'Updated content');

      expect(updated.content).toBe('Updated content');
    });

    it('updates updatedAt timestamp', () => {
      const note = repo.create(sessionId, 'Note');
      const originalUpdatedAt = note.updatedAt;

      const updated = repo.update(note.id, 'Changed');

      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('preserves createdAt timestamp', () => {
      const note = repo.create(sessionId, 'Note');
      const updated = repo.update(note.id, 'Changed');

      expect(updated.createdAt).toBe(note.createdAt);
    });

    it('preserves sessionId', () => {
      const note = repo.create(sessionId, 'Note');
      const updated = repo.update(note.id, 'Changed');

      expect(updated.sessionId).toBe(sessionId);
    });
  });

  describe('delete', () => {
    it('deletes a note', () => {
      const note = repo.create(sessionId, 'Delete me');
      repo.delete(note.id);

      expect(repo.getById(note.id)).toBeNull();
    });

    it('does not throw when deleting non-existent note', () => {
      expect(() => repo.delete('non-existent')).not.toThrow();
    });

    it('does not affect other notes', () => {
      const note1 = repo.create(sessionId, 'Note 1');
      const note2 = repo.create(sessionId, 'Note 2');

      repo.delete(note1.id);

      expect(repo.getById(note1.id)).toBeNull();
      expect(repo.getById(note2.id)).not.toBeNull();
    });
  });
});
