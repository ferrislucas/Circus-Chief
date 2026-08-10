import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { cleanupKanbanApiOperations } from './kanbanOperationRetention.js';

describe('cleanupKanbanApiOperations', () => {
  it('deletes only a bounded batch of expired completed operations', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE kanban_api_operations (id TEXT PRIMARY KEY, status TEXT, updated_at INTEGER);
      INSERT INTO kanban_api_operations VALUES ('old-1','completed',1), ('old-2','completed',2),
        ('live','processing',1), ('recent','completed',900);`);

    const result = cleanupKanbanApiOperations({ db, now: 1000, retentionMs: 100, batchSize: 1 });

    expect(result).toMatchObject({ deleted: 1, remainingEligible: 1, cutoff: 900, batchSize: 1 });
    expect(db.prepare('SELECT id FROM kanban_api_operations ORDER BY id').all().map((row) => row.id))
      .toEqual(['live', 'old-2', 'recent']);
  });
});
