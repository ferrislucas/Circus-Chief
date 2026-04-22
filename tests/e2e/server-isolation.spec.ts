import { test, expect } from '@playwright/test';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, basename } from 'node:path';
import Database from 'better-sqlite3';
import { API_URL, cleanupAll, seedProject } from './helpers';

/**
 * These tests lock in the DB-isolation contract between pw.sh and the test
 * server. They are the last line of defense against the regression the
 * "isolate pw.sh server DB per worktree" plan was written to fix: an E2E
 * test server accidentally writing into the user's real ~/.circuschief DB
 * and eating scheduled sessions.
 */
test.describe('Server DB / scheduler isolation', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  const getServerInfo = async () => {
    const res = await fetch(`${API_URL}/api/server-info`);
    expect(res.ok).toBeTruthy();
    return res.json();
  };

  test('dbPath ends with .circuschief-test.db and is not the home DB', async () => {
    const info = await getServerInfo();
    expect(typeof info.dbPath).toBe('string');
    expect(isAbsolute(info.dbPath)).toBe(true);
    expect(basename(info.dbPath)).toBe('.circuschief-test.db');

    const homeDb = join(homedir(), '.circuschief', 'circuschief.db');
    expect(info.dbPath).not.toBe(homeDb);
  });

  test('vcrMode is "replay" and schedulerRunning is false under pw.sh', async () => {
    const info = await getServerInfo();
    expect(info.vcrMode).toBe('replay');
    expect(info.schedulerRunning).toBe(false);
  });

  test('creating a session writes to the worktree DB, not the home DB', async () => {
    const homeDb = join(homedir(), '.circuschief', 'circuschief.db');
    // Snapshot the home DB sessions count (or null if the file doesn't exist
    // on this machine — then the invariant is trivially satisfied).
    let beforeHomeCount: number | null = null;
    if (existsSync(homeDb)) {
      const db = new Database(homeDb, { readonly: true, fileMustExist: true });
      try {
        beforeHomeCount = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as any).c as number;
      } finally {
        db.close();
      }
    }

    // Create a project + session via the API
    const project = await seedProject('Server Isolation', '/tmp/server-isolation');
    expect(project).toBeTruthy();
    expect(project.id).toBeTruthy();

    // The worktree DB should now contain the new project.
    const info = await getServerInfo();
    expect(existsSync(info.dbPath)).toBe(true);
    const testDb = new Database(info.dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = testDb.prepare('SELECT id FROM projects WHERE id = ?').get(project.id) as any;
      expect(row).toBeTruthy();
      expect(row.id).toBe(project.id);
    } finally {
      testDb.close();
    }

    // And the home DB (if it exists) must NOT have the new project.
    if (existsSync(homeDb)) {
      const db = new Database(homeDb, { readonly: true, fileMustExist: true });
      try {
        const row = db.prepare('SELECT id FROM projects WHERE id = ?').get(project.id);
        expect(row).toBeFalsy();

        const afterHomeCount = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as any).c as number;
        if (beforeHomeCount !== null) {
          expect(afterHomeCount).toBe(beforeHomeCount);
        }
      } finally {
        db.close();
      }
    }
  });

  test('dbPath file exists and is a real file (not ":memory:" in E2E mode)', async () => {
    const info = await getServerInfo();
    expect(info.dbPath).not.toBe(':memory:');
    expect(existsSync(info.dbPath)).toBe(true);
    expect(statSync(info.dbPath).isFile()).toBe(true);
  });
});
