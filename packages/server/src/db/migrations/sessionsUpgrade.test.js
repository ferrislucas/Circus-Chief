import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allMigrations } from './index.js';
import { SESSIONS_INDEX_DDL } from './sessionTableRecreate.js';

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

function databaseSessionIndexNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sessions' AND name LIKE 'idx_sessions_%' ORDER BY name")
    .all()
    .map(({ name }) => name);
}

describe('sessions immutable-parentage upgrade', () => {
  it('preserves every sessions index while recreating a pre-release sessions table', () => {
    const db = preReleaseDb();
    try {
      expect(db.pragma('foreign_key_list(sessions)').find((fk) => fk.from === 'parent_session_id').on_delete).toBe('SET NULL');
      expect(databaseSessionIndexNames(db)).toContain('idx_sessions_lane_run');

      runAllMigrations(db);

      expect(db.pragma('foreign_key_list(sessions)').find((fk) => fk.from === 'parent_session_id').on_delete).toBe('NO ACTION');
      expect(databaseSessionIndexNames(db)).toContain('idx_sessions_lane_run');
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
