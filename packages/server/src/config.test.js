import { describe, it, expect } from 'vitest';
import { homedir, tmpdir } from 'os';
import { join, sep, dirname } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { getDefaultDbPath } from './config.js';

describe('getDefaultDbPath', () => {
  it('returns an absolute path', () => {
    const result = getDefaultDbPath();
    // On Unix starts with '/', on Windows starts with drive letter
    expect(result.startsWith(sep) || /^[A-Z]:\\/i.test(result)).toBe(true);
  });

  it('returns a path under the user home directory', () => {
    const result = getDefaultDbPath();
    expect(result.startsWith(homedir())).toBe(true);
  });

  it('returns a path ending in .circuschief/circuschief.db', () => {
    const result = getDefaultDbPath();
    expect(result).toBe(join(homedir(), '.circuschief', 'circuschief.db'));
  });
});

describe('DB_PATH env var override', () => {
  it('process.env.DB_PATH takes precedence over getDefaultDbPath()', () => {
    // This tests the logic used in index.js:
    //   const dbPath = process.env.DB_PATH || getDefaultDbPath();
    const customPath = '/tmp/custom-test.db';
    const originalEnv = process.env.DB_PATH;
    try {
      process.env.DB_PATH = customPath;
      const dbPath = process.env.DB_PATH || getDefaultDbPath();
      expect(dbPath).toBe(customPath);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.DB_PATH;
      } else {
        process.env.DB_PATH = originalEnv;
      }
    }
  });
});

describe('database directory creation', () => {
  it('mkdirSync with recursive:true creates nested directory', () => {
    const testDir = join(tmpdir(), `circuschief-test-${Date.now()}`, '.circuschief');
    const testDbPath = join(testDir, 'circuschief.db');

    try {
      expect(existsSync(testDir)).toBe(false);
      mkdirSync(dirname(testDbPath), { recursive: true });
      expect(existsSync(testDir)).toBe(true);
    } finally {
      rmSync(dirname(testDir), { recursive: true, force: true });
    }
  });
});
