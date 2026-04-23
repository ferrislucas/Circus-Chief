import { describe, it, expect } from 'vitest';
import { getDbPath, databaseManager } from './index.js';

// Note: packages/server/test/setup.js calls initDatabase(':memory:')
// in beforeEach, so by the time these tests run a DB is already open.

describe('db/index.js getDbPath', () => {
  it('matches databaseManager.getPath()', () => {
    expect(getDbPath()).toBe(databaseManager.getPath());
  });

  it('returns the path used to init (":memory:" in tests)', () => {
    expect(getDbPath()).toBe(':memory:');
  });
});
