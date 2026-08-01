import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allMigrations } from './index.js';
import { getColumns } from './migrationUtils.js';

const schemaUrl = new URL('../../schema.sql', import.meta.url);

const DEAD_TOKEN_COLUMNS = [
  'workflow_turn_token',
  'completion_requested_turn_token',
  'completion_request_key',
  'completion_requested_at',
];

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(schemaUrl, 'utf8'));
  return db;
}

describe('kanban-add-lane-run-workflow (F2: dead token-column churn)', () => {
  it('never creates the retired workflow-completion-token columns on a fresh database', () => {
    // Run only up through kanban-add-lane-run-workflow itself -- i.e. before
    // kanban-drop-agent-workflow-completion-tokens has a chance to clean up
    // after it. This pins the *creation* step, not just the end state, so a
    // regression that reintroduces the columns here is caught even though a
    // later migration would otherwise silently mask it.
    const db = freshDb();
    try {
      const workflowIndex = allMigrations.findIndex((m) => m.name === 'kanban-add-lane-run-workflow');
      expect(workflowIndex).toBeGreaterThanOrEqual(0);

      for (const migration of allMigrations.slice(0, workflowIndex + 1)) {
        migration.up(db);
      }

      const columns = getColumns(db, 'sessions');
      for (const column of DEAD_TOKEN_COLUMNS) {
        expect(columns).not.toContain(column);
      }
    } finally {
      db.close();
    }
  });

  it('drops the retired workflow-completion-token columns from a pre-existing database that still has them', () => {
    // Simulates an existing installation created before this cleanup, where
    // the columns were already persisted to disk. The drop migration must
    // remain and must still be an effective, guarded cleanup for those DBs.
    const db = freshDb();
    try {
      for (const column of DEAD_TOKEN_COLUMNS) {
        db.exec(`ALTER TABLE sessions ADD COLUMN ${column} TEXT`);
      }
      expect(getColumns(db, 'sessions')).toEqual(expect.arrayContaining(DEAD_TOKEN_COLUMNS));

      for (const migration of allMigrations) migration.up(db);

      const columns = getColumns(db, 'sessions');
      for (const column of DEAD_TOKEN_COLUMNS) {
        expect(columns).not.toContain(column);
      }
    } finally {
      db.close();
    }
  });

  it('is a no-op on a fresh database that never had the columns (idempotent guard)', () => {
    const db = freshDb();
    try {
      expect(() => {
        for (const migration of allMigrations) migration.up(db);
      }).not.toThrow();

      const columns = getColumns(db, 'sessions');
      for (const column of DEAD_TOKEN_COLUMNS) {
        expect(columns).not.toContain(column);
      }
    } finally {
      db.close();
    }
  });
});
