import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { cleanupKanbanApiOperations } from './kanbanOperationRetention.js';

describe('cleanupKanbanApiOperations', () => {
  it('deletes only a bounded batch of expired completed operations', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE kanban_api_operations (id TEXT PRIMARY KEY, status TEXT, owner_token TEXT,
      lease_expires_at INTEGER, terminal_error TEXT, updated_at INTEGER);
      INSERT INTO kanban_api_operations VALUES
        ('old-1','completed',NULL,NULL,NULL,1), ('old-2','completed',NULL,NULL,NULL,2),
        ('live','processing','owner',9999,NULL,1), ('recent','completed',NULL,NULL,NULL,900);`);

    const result = cleanupKanbanApiOperations({ db, now: 1000, retentionMs: 100, batchSize: 1 });

    expect(result).toMatchObject({ deleted: 1, remainingEligible: 1, cutoff: 900, batchSize: 1 });
    expect(db.prepare('SELECT id FROM kanban_api_operations ORDER BY id').all().map((row) => row.id))
      .toEqual(['live', 'old-2', 'recent']);
  });

  it('quarantines only processing operations whose lease and grace period expired', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE kanban_api_operations (id TEXT PRIMARY KEY, status TEXT, owner_token TEXT,
      lease_expires_at INTEGER, terminal_error TEXT, updated_at INTEGER);
      INSERT INTO kanban_api_operations VALUES
        ('abandoned','processing','old-owner',100,NULL,100),
        ('retryable','processing','owner',100,NULL,850),
        ('active','processing','owner',1100,NULL,100);`);

    const result = cleanupKanbanApiOperations({
      db, now: 1000, retentionMs: 500, abandonedMs: 200,
    });

    expect(result.terminalized).toBe(1);
    expect(db.prepare('SELECT status, owner_token, terminal_error FROM kanban_api_operations WHERE id=?')
      .get('abandoned')).toEqual({
      status: 'abandoned', owner_token: null,
      terminal_error: 'operation lease expired without a persisted response',
    });
    expect(db.prepare("SELECT status FROM kanban_api_operations WHERE id='retryable'").get().status)
      .toBe('processing');
    expect(db.prepare("SELECT status FROM kanban_api_operations WHERE id='active'").get().status)
      .toBe('processing');
  });

  it('retains retryable operations only for the normal retention period', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE kanban_api_operations (id TEXT PRIMARY KEY, status TEXT, owner_token TEXT,
      lease_expires_at INTEGER, terminal_error TEXT, updated_at INTEGER);
      INSERT INTO kanban_api_operations VALUES ('retryable','retryable',NULL,NULL,'service failure',1);`);

    const result = cleanupKanbanApiOperations({ db, now: 1000, retentionMs: 100 });

    expect(result.deleted).toBe(1);
    expect(db.prepare("SELECT id FROM kanban_api_operations WHERE id='retryable'").get()).toBeUndefined();
  });
});
