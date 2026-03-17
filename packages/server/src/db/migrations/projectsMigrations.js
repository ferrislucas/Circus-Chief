/**
 * Migrations for the projects table and project-related tables.
 * Each export is an array of { name, up(db) } migration objects.
 */
import { addColumnIfMissing, getColumns, tableExists } from './migrationUtils.js';

/**
 * Drop legacy project-level summary columns from the projects table.
 * These settings have been consolidated under global settings (SettingsRepository).
 */
function migrateProjectsDropSummaryColumns(db) {
  const columns = getColumns(db, 'projects');

  const columnsToRemove = [
    'disable_session_summaries',
    'disable_conversation_summaries',
    'summary_debounce_ms',
    'session_title_prompt',
  ];

  for (const col of columnsToRemove) {
    if (columns.includes(col)) {
      db.exec(`ALTER TABLE projects DROP COLUMN ${col}`);
    }
  }
}

/** @type {Array<{name: string, up: (db: import('better-sqlite3').Database) => void}>} */
export const projectsMigrations = [
  {
    name: 'projects-add-system_prompt',
    up(db) { addColumnIfMissing(db, 'projects', 'system_prompt', 'TEXT'); },
  },
  {
    name: 'projects-add-on_session_created',
    up(db) { addColumnIfMissing(db, 'projects', 'on_session_created', 'TEXT'); },
  },
  {
    name: 'projects-add-on_session_deleted',
    up(db) { addColumnIfMissing(db, 'projects', 'on_session_deleted', 'TEXT'); },
  },
  {
    name: 'projects-add-repo_url',
    up(db) { addColumnIfMissing(db, 'projects', 'repo_url', 'TEXT'); },
  },
  {
    name: 'projects-drop-summary-columns',
    up(db) { migrateProjectsDropSummaryColumns(db); },
  },

  // --- Project session defaults table ---
  {
    name: 'project_session_defaults-create-table',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS project_session_defaults (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL UNIQUE,
          mode TEXT CHECK(mode IN ('plan', 'standard', 'yolo')),
          thinking_enabled INTEGER,
          start_immediately INTEGER,
          git_mode TEXT CHECK(git_mode IN ('branch', 'worktree')),
          git_branch TEXT,
          model TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_project_defaults_projectId ON project_session_defaults(project_id);
      `);
    },
  },
  {
    name: 'project_session_defaults-add-provider_id',
    up(db) {
      if (tableExists(db, 'project_session_defaults')) {
        addColumnIfMissing(
          db, 'project_session_defaults', 'provider_id',
          'TEXT REFERENCES providers(id)'
        );
      }
    },
  },
  {
    name: 'project_session_defaults-add-effort_level',
    up(db) {
      if (tableExists(db, 'project_session_defaults')) {
        addColumnIfMissing(
          db, 'project_session_defaults', 'effort_level',
          "TEXT CHECK(effort_level IN ('low', 'medium', 'high', 'max', 'auto'))"
        );
      }
    },
  },
];
