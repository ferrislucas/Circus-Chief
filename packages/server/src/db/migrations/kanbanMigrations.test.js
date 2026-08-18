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
  it('leaves declared-exit columns to the trailing dedicated migration', () => {
    const db = freshDb();
    try {
      // Model the historical lane-runs table that pre-dates declared exits.
      // The workflow migration is already established, so this later concern
      // must remain owned by its dedicated trailing migration.
      db.exec(`
        DROP TABLE kanban_lane_runs;
        CREATE TABLE kanban_lane_runs (
          id TEXT PRIMARY KEY, lane_entry_event_id TEXT NOT NULL UNIQUE, prior_lane_run_id TEXT,
          project_id TEXT NOT NULL, workspace_id TEXT NOT NULL, card_id TEXT NOT NULL, source_lane_id TEXT NOT NULL,
          completion_target_lane_id TEXT, root_session_id TEXT UNIQUE,
          status TEXT NOT NULL DEFAULT 'open', failure_reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          succeeded_at INTEGER, failed_at INTEGER, cancelled_at INTEGER, superseded_at INTEGER, transition_applied_at INTEGER
        );
      `);

      const workflowMigration = allMigrations.find((item) => item.name === 'kanban-add-lane-run-workflow');
      const declaredExitMigration = allMigrations.find((item) => item.name === 'kanban-lane-run-declared-exit-lane');
      expect(workflowMigration).toBeDefined();
      expect(declaredExitMigration).toBeDefined();

      workflowMigration.up(db);
      expect(getColumns(db, 'kanban_lane_runs')).not.toEqual(expect.arrayContaining([
        'chosen_exit_lane_id', 'chosen_exit_declared_at',
      ]));

      declaredExitMigration.up(db);
      expect(getColumns(db, 'kanban_lane_runs')).toEqual(expect.arrayContaining([
        'chosen_exit_lane_id', 'chosen_exit_declared_at',
      ]));
      expect(getColumns(db, 'kanban_lane_runs')).not.toContain('chosen_exit_declared_by');
    } finally {
      db.close();
    }
  });

  it('removes caller attribution from databases that ran the earlier branch migration', () => {
    const db = freshDb();
    try {
      db.exec('ALTER TABLE kanban_lane_runs ADD COLUMN chosen_exit_declared_by TEXT');
      const cleanup = allMigrations.find((item) => item.name === 'kanban-drop-exit-lane-caller-attribution');

      expect(cleanup).toBeDefined();
      cleanup.up(db);

      expect(getColumns(db, 'kanban_lane_runs')).not.toContain('chosen_exit_declared_by');
    } finally {
      db.close();
    }
  });

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

  it('preserves target-only completion targets and records them for operator remediation', () => {
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

      expect(db.prepare('SELECT completion_target_lane_id AS target FROM kanban_lanes WHERE id=?').get('plain').target).toBe('target');
      expect(db.prepare('SELECT completion_target_lane_id AS target FROM kanban_lanes WHERE id=?').get('automated').target).toBe('target');
      expect(db.prepare('SELECT lane_id AS laneId, note FROM kanban_migration_notes WHERE lane_id=?').get('plain')).toEqual({
        laneId: 'plain',
        note: 'Legacy completion target requires on-entry automation before lane runs can be enabled',
      });
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
