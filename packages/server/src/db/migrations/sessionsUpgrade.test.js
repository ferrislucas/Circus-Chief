import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allMigrations } from './index.js';
import {
  SESSIONS_ALL_CURRENT_COLUMNS,
  SESSIONS_ALL_CURRENT_COLUMN_NAMES,
  SESSIONS_INDEX_DDL,
  SESSIONS_TIER_RESOLUTION_COLUMNS,
} from './sessionTableRecreate.js';

const schemaUrl = new URL('../../schema.sql', import.meta.url);

function sessionIndexNamesFromSql(sql) {
  return [...sql.matchAll(/CREATE INDEX IF NOT EXISTS (idx_sessions_[A-Za-z0-9_]+) ON sessions/g)]
    .map(([, name]) => name)
    .sort();
}

function preReleaseDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // This snapshot intentionally predates immutable parentage. It is not a
  // fresh current-schema database: the old SET NULL FK forces the migration's
  // table-recreation path, which is where SQLite drops sessions indexes.
  const oldSchema = readFileSync(schemaUrl, 'utf8').replace(
    'parent_session_id TEXT REFERENCES sessions(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED',
    'parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL'
  );
  db.exec(oldSchema);
  return db;
}

function runAllMigrations(db) {
  for (const migration of allMigrations) migration.up(db);
}

function runMigrationsThrough(db, name) {
  for (const migration of allMigrations) {
    migration.up(db);
    if (migration.name === name) return;
  }
  throw new Error(`Migration not found: ${name}`);
}

function runMigrationsAfter(db, name) {
  const migrationIndex = allMigrations.findIndex((migration) => migration.name === name);
  if (migrationIndex === -1) throw new Error(`Migration not found: ${name}`);
  for (const migration of allMigrations.slice(migrationIndex + 1)) migration.up(db);
}

function databaseSessionIndexNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sessions' AND name LIKE 'idx_sessions_%' ORDER BY name")
    .all()
    .map(({ name }) => name);
}

function recreationSessionColumnNames() {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE recreation_sessions (${SESSIONS_ALL_CURRENT_COLUMNS})`);
    return db.pragma('table_info(recreation_sessions)').map((column) => column.name);
  } finally {
    db.close();
  }
}

function triggerExists(db, name) {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name) !== undefined;
}

describe('sessions immutable-parentage upgrade', () => {
  it('keeps tier-resolution columns in schema, recreation DDL, and the row-copy list', () => {
    const schemaDb = new Database(':memory:');
    try {
      schemaDb.exec(readFileSync(schemaUrl, 'utf8'));
      const schemaColumnNames = schemaDb.pragma('table_info(sessions)').map((column) => column.name);
      const recreationColumnNames = recreationSessionColumnNames();

      for (const column of SESSIONS_TIER_RESOLUTION_COLUMNS) {
        expect(schemaColumnNames).toContain(column);
        expect(recreationColumnNames).toContain(column);
        expect(SESSIONS_ALL_CURRENT_COLUMN_NAMES).toContain(column);
      }
    } finally {
      schemaDb.close();
    }
  });

  it('preserves tier-resolution snapshots through later sessions-table recreation', () => {
    const db = preReleaseDb();
    try {
      const now = Date.now();
      db.prepare(`INSERT INTO projects (id, name, working_directory, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)`)
        .run('project-1', 'Project', '/tmp/project', now, now);
      db.prepare(`INSERT INTO sessions (id, project_id, name, status, model, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run('session-1', 'project-1', 'Tier-bound session', 'starting', 'tier::high', now, now);

      runMigrationsThrough(db, 'model-tiers-provider-pair-columns');
      db.prepare(`UPDATE sessions SET resolved_model = ?, resolved_provider_id = ? WHERE id = ?`)
        .run('gpt-5.5', 'openai', 'session-1');

      runMigrationsAfter(db, 'model-tiers-provider-pair-columns');

      expect(db.pragma('table_info(sessions)').map((column) => column.name))
        .toEqual(expect.arrayContaining(['resolved_model', 'resolved_provider_id']));
      expect(db.prepare(`SELECT name, model, resolved_model, resolved_provider_id
        FROM sessions WHERE id = ?`).get('session-1')).toEqual({
        name: 'Tier-bound session',
        model: 'tier::high',
        resolved_model: 'gpt-5.5',
        resolved_provider_id: 'openai',
      });

      db.prepare(`UPDATE sessions SET resolved_model = ?, resolved_provider_id = ? WHERE id = ?`)
        .run('gpt-5.6', 'openai', 'session-1');
      expect(db.prepare(`SELECT resolved_model, resolved_provider_id FROM sessions WHERE id = ?`).get('session-1'))
        .toEqual({ resolved_model: 'gpt-5.6', resolved_provider_id: 'openai' });
    } finally {
      db.close();
    }
  });

  it('preserves every sessions index while recreating a pre-release sessions table', () => {
    const db = preReleaseDb();
    try {
      expect(db.pragma('foreign_key_list(sessions)').find((fk) => fk.from === 'parent_session_id').on_delete).toBe('SET NULL');
      expect(databaseSessionIndexNames(db)).toContain('idx_sessions_lane_run');

      runAllMigrations(db);

      expect(db.pragma('foreign_key_list(sessions)').find((fk) => fk.from === 'parent_session_id').on_delete).toBe('NO ACTION');
      expect(databaseSessionIndexNames(db)).toContain('idx_sessions_lane_run');
      expect(triggerExists(db, 'trg_command_run_output_cleanup')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('keeps schema.sql, the recreation list, and an upgraded database in index parity', () => {
    const db = preReleaseDb();
    try {
      runAllMigrations(db);
      const schemaIndexes = sessionIndexNamesFromSql(readFileSync(schemaUrl, 'utf8'));
      const recreationIndexes = sessionIndexNamesFromSql(SESSIONS_INDEX_DDL.join(';\n'));
      expect(databaseSessionIndexNames(db)).toEqual(schemaIndexes);
      expect(recreationIndexes).toEqual(schemaIndexes);
    } finally {
      db.close();
    }
  });
});
