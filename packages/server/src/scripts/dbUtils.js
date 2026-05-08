import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { getDefaultDbPath } from '../config.js';
import { DatabaseManager } from '../db/DatabaseManager.js';

export function getActiveDbPath() {
  return process.env.DB_PATH || getDefaultDbPath();
}

export function getSqliteSidecarPaths(dbPath) {
  return [`${dbPath}-wal`, `${dbPath}-shm`];
}

export function getBackupDir() {
  return join(homedir(), '.circuschief', 'backups');
}

export function copyDatabaseBackups(dbPath = getActiveDbPath(), timestamp = new Date()) {
  if (!existsSync(dbPath)) {
    return { dbPath, backupDir: getBackupDir(), copied: [], missing: [dbPath] };
  }

  const backupDir = getBackupDir();
  mkdirSync(backupDir, { recursive: true });

  const stamp = timestamp.toISOString().replace(/[:.]/g, '-');
  const candidates = [dbPath, ...getSqliteSidecarPaths(dbPath)];
  const copied = [];
  const missing = [];

  for (const source of candidates) {
    if (!existsSync(source)) {
      missing.push(source);
      continue;
    }
    const target = join(backupDir, `${basename(source)}.${stamp}.bak`);
    copyFileSync(source, target);
    copied.push({ source, target });
  }

  return { dbPath, backupDir, copied, missing };
}

export function createFreshBaselineDb() {
  const tempDir = mkdtempSync(join(tmpdir(), 'circuschief-baseline-'));
  const dbPath = join(tempDir, 'baseline.db');
  const manager = new DatabaseManager();
  const db = manager.init(dbPath);

  return {
    db,
    dbPath,
    close() {
      manager.close();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

export function getSchemaObjects(db) {
  return db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE type IN ('table', 'index', 'trigger', 'view')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
}

export function getTableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all();
}

export function getIndexColumns(db, indexName) {
  return db.prepare(`PRAGMA index_info(${indexName})`).all().map((row) => row.name);
}

export function normalizeSql(sql) {
  return (sql || '').replace(/\s+/g, ' ').trim();
}
