import { describe, it, expect, beforeEach } from 'vitest';
import { SessionSummaryRepository } from './SessionSummaryRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('SessionSummaryRepository', () => {
  // Uses global setup from test/setup.js
  let repo;
  let projectRepo;
  let sessionId;
  let project;

  beforeEach(() => {
    repo = new SessionSummaryRepository();
    projectRepo = new ProjectRepository();

    // Create a project and session for testing
    project = projectRepo.create('Test Project', '/tmp/test');
    const now = Date.now();
    const id = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, project.id, 'Test Session', 'running', 'standard', now, now);
    sessionId = id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(SessionSummaryRepository);
      expect(repo.tableName).toBe('session_summaries');
    });
  });

  describe('create', () => {
    it('creates a summary with required fields', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'A short summary',
        fullSummary: 'A full summary with more details',
      });

      expect(summary.id).toBeDefined();
      expect(summary.sessionId).toBe(sessionId);
      expect(summary.shortSummary).toBe('A short summary');
      expect(summary.fullSummary).toBe('A full summary with more details');
      expect(summary.outcome).toBe('ongoing');
      expect(summary.messageCount).toBe(0);
      expect(summary.createdAt).toBeTypeOf('number');
      expect(summary.updatedAt).toBeTypeOf('number');
      expect(summary.generatedAt).toBeTypeOf('number');
    });

    it('creates a summary with all fields', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full summary',
        keyActions: ['Action 1', 'Action 2'],
        filesModified: ['file1.js', 'file2.js'],
        outcome: 'partial',
        messageCount: 10,
      });

      expect(summary.shortSummary).toBe('Short');
      expect(summary.fullSummary).toBe('Full summary');
      expect(summary.keyActions).toEqual(['Action 1', 'Action 2']);
      expect(summary.filesModified).toEqual(['file1.js', 'file2.js']);
      expect(summary.outcome).toBe('partial');
      expect(summary.messageCount).toBe(10);
    });

    it('sets createdAt and updatedAt to same value on creation', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
      });
      expect(summary.createdAt).toBe(summary.updatedAt);
    });

    it('generates unique IDs', () => {
      // Create another session for second summary
      const project = projectRepo.create('Another Project', '/tmp/another');
      const now = Date.now();
      const otherId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(otherId, project.id, 'Other Session', 'running', 'standard', now, now);

      const summary1 = repo.create(sessionId, { shortSummary: 'Summary 1', fullSummary: 'Full 1' });
      const summary2 = repo.create(otherId, { shortSummary: 'Summary 2', fullSummary: 'Full 2' });

      expect(summary1.id).not.toBe(summary2.id);
    });

    it('handles empty arrays for keyActions and filesModified', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        keyActions: [],
        filesModified: [],
      });

      expect(summary.keyActions).toEqual([]);
      expect(summary.filesModified).toEqual([]);
    });

    it('handles null keyActions and filesModified', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        keyActions: null,
        filesModified: null,
      });

      expect(summary.keyActions).toEqual([]);
      expect(summary.filesModified).toEqual([]);
    });
  });

  describe('getById', () => {
    it('retrieves summary by ID', () => {
      const created = repo.create(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test full',
      });
      const retrieved = repo.getById(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns null for non-existent ID', () => {
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('getBySessionId', () => {
    it('retrieves summary by session ID', () => {
      const created = repo.create(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test full',
      });
      const retrieved = repo.getBySessionId(sessionId);

      expect(retrieved).toEqual(created);
    });

    it('returns null when no summary exists for session', () => {
      expect(repo.getBySessionId(sessionId)).toBeNull();
    });

    it('returns null for non-existent session ID', () => {
      expect(repo.getBySessionId('non-existent')).toBeNull();
    });
  });

  describe('update', () => {
    it('updates shortSummary', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Original',
        fullSummary: 'Original full',
      });
      const updated = repo.update(summary.id, { shortSummary: 'Updated' });

      expect(updated.shortSummary).toBe('Updated');
      expect(updated.fullSummary).toBe('Original full');
    });

    it('updates fullSummary', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Original full',
      });
      const updated = repo.update(summary.id, { fullSummary: 'Updated full' });

      expect(updated.fullSummary).toBe('Updated full');
    });

    it('updates keyActions', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        keyActions: ['Action 1'],
      });
      const updated = repo.update(summary.id, { keyActions: ['Action 1', 'Action 2', 'Action 3'] });

      expect(updated.keyActions).toEqual(['Action 1', 'Action 2', 'Action 3']);
    });

    it('updates filesModified', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        filesModified: ['file1.js'],
      });
      const updated = repo.update(summary.id, { filesModified: ['file1.js', 'file2.ts'] });

      expect(updated.filesModified).toEqual(['file1.js', 'file2.ts']);
    });

    it('updates outcome', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        outcome: 'ongoing',
      });
      const updated = repo.update(summary.id, { outcome: 'partial' });

      expect(updated.outcome).toBe('partial');
    });

    it('updates messageCount', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        messageCount: 5,
      });
      const updated = repo.update(summary.id, { messageCount: 10 });

      expect(updated.messageCount).toBe(10);
    });

    it('updates multiple fields at once', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Original short',
        fullSummary: 'Original full',
        outcome: 'ongoing',
        messageCount: 1,
      });
      const updated = repo.update(summary.id, {
        shortSummary: 'Updated short',
        fullSummary: 'Updated full',
        keyActions: ['New action'],
        filesModified: ['new-file.js'],
        outcome: 'partial',
        messageCount: 5,
      });

      expect(updated.shortSummary).toBe('Updated short');
      expect(updated.fullSummary).toBe('Updated full');
      expect(updated.keyActions).toEqual(['New action']);
      expect(updated.filesModified).toEqual(['new-file.js']);
      expect(updated.outcome).toBe('partial');
      expect(updated.messageCount).toBe(5);
    });

    it('updates generatedAt and updatedAt timestamps', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
      });
      const originalGeneratedAt = summary.generatedAt;
      const originalUpdatedAt = summary.updatedAt;

      const updated = repo.update(summary.id, { shortSummary: 'Changed' });

      expect(updated.generatedAt).toBeGreaterThanOrEqual(originalGeneratedAt);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('preserves createdAt timestamp', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
      });
      const updated = repo.update(summary.id, { shortSummary: 'Changed' });

      expect(updated.createdAt).toBe(summary.createdAt);
    });

    it('preserves sessionId', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
      });
      const updated = repo.update(summary.id, { shortSummary: 'Changed' });

      expect(updated.sessionId).toBe(sessionId);
    });

    it('returns unchanged summary when no updates provided', () => {
      const summary = repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
      });
      const result = repo.update(summary.id, {});

      expect(result.shortSummary).toBe('Short');
      expect(result.fullSummary).toBe('Full');
    });
  });

  describe('upsert', () => {
    it('creates new summary when none exists', () => {
      const result = repo.upsert(sessionId, {
        shortSummary: 'New summary',
        fullSummary: 'New full summary',
      });

      expect(result.sessionId).toBe(sessionId);
      expect(result.shortSummary).toBe('New summary');
      expect(result.fullSummary).toBe('New full summary');
    });

    it('updates existing summary', () => {
      // Create initial summary
      repo.create(sessionId, {
        shortSummary: 'Original',
        fullSummary: 'Original full',
      });

      // Upsert with new data
      const result = repo.upsert(sessionId, {
        shortSummary: 'Updated',
        fullSummary: 'Updated full',
      });

      expect(result.shortSummary).toBe('Updated');
      expect(result.fullSummary).toBe('Updated full');
    });

    it('preserves summary ID on update', () => {
      const original = repo.create(sessionId, {
        shortSummary: 'Original',
        fullSummary: 'Original full',
      });

      const result = repo.upsert(sessionId, {
        shortSummary: 'Updated',
      });

      expect(result.id).toBe(original.id);
    });

    it('only one summary exists per session after multiple upserts', () => {
      repo.upsert(sessionId, { shortSummary: 'First', fullSummary: 'First full' });
      repo.upsert(sessionId, { shortSummary: 'Second', fullSummary: 'Second full' });
      repo.upsert(sessionId, { shortSummary: 'Third', fullSummary: 'Third full' });

      const summary = repo.getBySessionId(sessionId);
      expect(summary.shortSummary).toBe('Third');

      // Verify only one row exists by checking getBySessionId returns the same as what we just got
      const allRows = databaseManager.get()
        .prepare('SELECT COUNT(*) as count FROM session_summaries WHERE session_id = ?')
        .get(sessionId);
      expect(allRows.count).toBe(1);
    });
  });

  describe('deleteBySessionId', () => {
    it('deletes summary by session ID', () => {
      repo.create(sessionId, {
        shortSummary: 'To delete',
        fullSummary: 'To delete full',
      });
      repo.deleteBySessionId(sessionId);

      expect(repo.getBySessionId(sessionId)).toBeNull();
    });

    it('does not throw when deleting non-existent summary', () => {
      expect(() => repo.deleteBySessionId('non-existent')).not.toThrow();
    });

    it('does not affect other sessions summaries', () => {
      // Create another session
      const project = projectRepo.create('Another Project', '/tmp/another');
      const now = Date.now();
      const otherId = databaseManager.generateId();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(otherId, project.id, 'Other Session', 'running', 'standard', now, now);

      repo.create(sessionId, { shortSummary: 'Summary 1', fullSummary: 'Full 1' });
      repo.create(otherId, { shortSummary: 'Summary 2', fullSummary: 'Full 2' });

      repo.deleteBySessionId(sessionId);

      expect(repo.getBySessionId(sessionId)).toBeNull();
      expect(repo.getBySessionId(otherId)).not.toBeNull();
    });
  });

  describe('cascade delete', () => {
    it('deletes summary when session is deleted', () => {
      repo.create(sessionId, {
        shortSummary: 'Test',
        fullSummary: 'Test full',
      });

      // Delete the session
      databaseManager.get().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

      // Summary should be cascade deleted
      expect(repo.getBySessionId(sessionId)).toBeNull();
    });
  });

  describe('duplicateForSession', () => {
    it('should copy session summary to new session', () => {
      const targetSessionId = databaseManager.generateId();
      const now = Date.now();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target', 'waiting', 'standard', now, now);

      repo.create(sessionId, {
        shortSummary: 'This session implemented feature X',
        fullSummary: 'Full details',
      });

      repo.duplicateForSession(sessionId, targetSessionId);

      const targetSummary = repo.getBySessionId(targetSessionId);
      expect(targetSummary).not.toBeNull();
      expect(targetSummary.shortSummary).toBe('This session implemented feature X');
    });

    it('should preserve summary content exactly', () => {
      const targetSessionId = databaseManager.generateId();
      const now = Date.now();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target', 'waiting', 'standard', now, now);

      repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full summary',
        keyActions: ['Action 1', 'Action 2'],
        filesModified: ['file1.js', 'file2.js'],
        outcome: 'success',
        messageCount: 42,
      });

      repo.duplicateForSession(sessionId, targetSessionId);

      const targetSummary = repo.getBySessionId(targetSessionId);
      expect(targetSummary.shortSummary).toBe('Short');
      expect(targetSummary.fullSummary).toBe('Full summary');
      expect(targetSummary.keyActions).toEqual(['Action 1', 'Action 2']);
      expect(targetSummary.filesModified).toEqual(['file1.js', 'file2.js']);
      expect(targetSummary.outcome).toBe('success');
      expect(targetSummary.messageCount).toBe(42);
    });

    it('should generate new ID for the summary', () => {
      const targetSessionId = databaseManager.generateId();
      const now = Date.now();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target', 'waiting', 'standard', now, now);

      const original = repo.create(sessionId, {
        shortSummary: 'Summary',
        fullSummary: 'Full',
      });

      repo.duplicateForSession(sessionId, targetSessionId);

      const targetSummary = repo.getBySessionId(targetSessionId);
      expect(targetSummary.id).not.toBe(original.id);
    });

    it('should handle session with no summary', () => {
      const targetSessionId = databaseManager.generateId();
      const now = Date.now();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target', 'waiting', 'standard', now, now);

      repo.duplicateForSession(sessionId, targetSessionId);

      expect(repo.getBySessionId(targetSessionId)).toBeNull();
    });

    it('should preserve all summary fields including PR and CI data', () => {
      const targetSessionId = databaseManager.generateId();
      const now = Date.now();
      databaseManager.get().prepare(
        'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(targetSessionId, project.id, 'Target', 'waiting', 'standard', now, now);

      repo.create(sessionId, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        prMerged: true,
        prState: 'merged',
        hasMergeConflicts: false,
        ciStatus: 'passed',
        ciFailures: ['test1'],
      });

      repo.duplicateForSession(sessionId, targetSessionId);

      const targetSummary = repo.getBySessionId(targetSessionId);
      expect(targetSummary.prMerged).toBe(true);
      expect(targetSummary.prState).toBe('merged');
      expect(targetSummary.hasMergeConflicts).toBe(false);
      expect(targetSummary.ciStatus).toBe('passed');
      expect(targetSummary.ciFailures).toEqual(['test1']);
    });
  });
});
