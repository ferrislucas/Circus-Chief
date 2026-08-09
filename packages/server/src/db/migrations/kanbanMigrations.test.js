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

describe('kanban-drop-completion-mode-hard-cutover', () => {
  it('recreates legacy lane tables without completion_mode and preserves lane rows', () => {
    const db = freshDb();
    try {
      db.exec('ALTER TABLE kanban_lanes ADD COLUMN completion_mode TEXT');
      db.prepare("INSERT INTO projects (id,name,working_directory,created_at,updated_at) VALUES ('p','P','/tmp',1,1)").run();
      db.prepare("INSERT INTO kanban_boards (id,project_id,created_at,updated_at) VALUES ('b','p',1,1)").run();
      db.prepare("INSERT INTO kanban_lanes (id,board_id,name,sort_order,created_at,updated_at,completion_mode) VALUES ('l','b','Lane',0,1,1,'legacy')").run();
      const migration = allMigrations.find((item) => item.name === 'kanban-drop-completion-mode-hard-cutover');
      migration.up(db);
      expect(getColumns(db, 'kanban_lanes')).not.toContain('completion_mode');
      expect(db.prepare('SELECT id, name FROM kanban_lanes WHERE id=?').get('l')).toEqual({ id: 'l', name: 'Lane' });
      expect(() => migration.up(db)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('clears target-only completion targets and records them for operator review', () => {
    const db = freshDb();
    try {
      db.exec('ALTER TABLE kanban_lanes ADD COLUMN completion_mode TEXT');
      db.prepare("INSERT INTO projects (id,name,working_directory,created_at,updated_at) VALUES ('p','P','/tmp',1,1)").run();
      db.prepare("INSERT INTO kanban_boards (id,project_id,created_at,updated_at) VALUES ('b','p',1,1)").run();
      db.prepare("INSERT INTO kanban_lanes (id,board_id,name,sort_order,created_at,updated_at,completion_mode) VALUES ('target','b','Target',0,1,1,'legacy')").run();
      db.prepare("INSERT INTO kanban_lanes (id,board_id,name,sort_order,completion_target_lane_id,created_at,updated_at,completion_mode) VALUES ('plain','b','Plain',1,'target',1,1,'legacy')").run();
      db.prepare("INSERT INTO kanban_lanes (id,board_id,name,sort_order,on_enter_prompt,completion_target_lane_id,created_at,updated_at,completion_mode) VALUES ('automated','b','Automated',2,'work','target',1,1,'legacy')").run();
      const migration = allMigrations.find((item) => item.name === 'kanban-drop-completion-mode-hard-cutover');

      migration.up(db);

      expect(db.prepare('SELECT completion_target_lane_id AS target FROM kanban_lanes WHERE id=?').get('plain').target).toBeNull();
      expect(db.prepare('SELECT completion_target_lane_id AS target FROM kanban_lanes WHERE id=?').get('automated').target).toBe('target');
      expect(db.prepare('SELECT lane_id AS laneId FROM kanban_migration_notes WHERE lane_id=?').get('plain')).toEqual({ laneId: 'plain' });
      expect(() => migration.up(db)).not.toThrow();
    } finally {
      db.close();
    }
  });
});

// Note: there is no 'kanban-backfill-structured-completion-mode' migration in
// the current chain (hard-cutover removed the completion_mode concept
// entirely — see 'kanban-drop-completion-mode-hard-cutover' below). This
// suite used to test that now-removed migration and has been deleted rather
// than reinvented, per the hard-cutover contract.
