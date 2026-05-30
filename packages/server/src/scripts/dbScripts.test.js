import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { copyDatabaseBackups } from './dbUtils.js';
import { validateDatabaseBaseline } from './validateDatabaseBaseline.js';
import { DatabaseManager } from '../db/DatabaseManager.js';

describe('database utility scripts', () => {
  it('backup succeeds when no DB exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuschief-backup-'));
    try {
      const result = copyDatabaseBackups(join(dir, 'missing.db'));
      expect(result.copied).toEqual([]);
      expect(result.missing).toContain(join(dir, 'missing.db'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backup copies DB and SQLite sidecars when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuschief-backup-'));
    const dbPath = join(dir, 'app.db');
    try {
      writeFileSync(dbPath, 'db');
      writeFileSync(`${dbPath}-wal`, 'wal');
      writeFileSync(`${dbPath}-shm`, 'shm');

      const result = copyDatabaseBackups(dbPath, new Date('2026-01-02T03:04:05.000Z'));
      expect(result.copied.map((file) => file.source).sort()).toEqual([
        dbPath,
        `${dbPath}-shm`,
        `${dbPath}-wal`,
      ].sort());
      for (const file of result.copied) {
        expect(existsSync(file.target)).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('baseline validation passes against a fresh initialized DB', () => {
    const manager = new DatabaseManager();
    const db = manager.init(':memory:');
    try {
      expect(validateDatabaseBaseline(db)).toEqual([]);
    } finally {
      manager.close();
    }
  });

  it('baseline validation reports a missing required column', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL
        );
      `);
      expect(validateDatabaseBaseline(db)).toContain('Missing column: sessions.name');
    } finally {
      db.close();
    }
  });

  it('baseline validation reports a wrong default value', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          working_directory TEXT NOT NULL,
          system_prompt TEXT,
          on_session_created TEXT,
          on_session_deleted TEXT,
          pr_poll_interval INTEGER NOT NULL DEFAULT 1,
          repo_url TEXT,
          worktree_path TEXT,
          kanban_enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );
      `);
      expect(validateDatabaseBaseline(db)).toContain('Column mismatch for projects.pr_poll_interval');
    } finally {
      db.close();
    }
  });

  it('baseline validation reports a missing index', () => {
    const manager = new DatabaseManager();
    const db = manager.init(':memory:');
    try {
      db.exec('DROP INDEX idx_sessions_starred');
      expect(validateDatabaseBaseline(db)).toContain('Missing index: idx_sessions_starred');
    } finally {
      manager.close();
    }
  });

  it('baseline validation reports missing required seed rows', () => {
    const manager = new DatabaseManager();
    const db = manager.init(':memory:');
    try {
      db.prepare('DELETE FROM provider_models WHERE id = ?').run('anthropic-opus-4-7');
      expect(validateDatabaseBaseline(db)).toContain('Missing provider model seed row: anthropic-opus-4-7');
    } finally {
      manager.close();
    }
  });

  it('baseline validation reports missing Opus 4.8 seed row', () => {
    const manager = new DatabaseManager();
    const db = manager.init(':memory:');
    try {
      db.prepare('DELETE FROM provider_models WHERE id = ?').run('anthropic-opus-4-8');
      expect(validateDatabaseBaseline(db)).toContain('Missing provider model seed row: anthropic-opus-4-8');
    } finally {
      manager.close();
    }
  });
});
