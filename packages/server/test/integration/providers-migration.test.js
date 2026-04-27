import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../../src/db/DatabaseManager.js';
import { ProjectRepository } from '../../src/db/ProjectRepository.js';
import { OPENAI_MODELS } from '@circuschief/shared';
import fs from 'fs';
import os from 'os';

describe('Providers Migration Integration', () => {
  let dbPath;
  let manager;

  beforeEach(() => {
    dbPath = `${os.tmpdir()}/test-migration-${Date.now()}.db`;
  });

  afterEach(() => {
    if (manager) {
      manager.close();
    }
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it('migrates old database and allows project deletion', () => {
    // Create old-style database with model_providers
    const Database = require('better-sqlite3');
    const oldDb = new Database(dbPath);
    oldDb.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        system_prompt TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE model_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT,
        auth_token TEXT,
        api_timeout_ms INTEGER,
        additional_env_vars TEXT,
        is_built_in INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE provider_models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        tier TEXT CHECK(tier IN ('opus', 'sonnet', 'haiku', 'custom')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );

      INSERT INTO projects (id, name, working_directory, created_at, updated_at)
      VALUES ('proj-1', 'Test Project', '/tmp/test', ${Date.now()}, ${Date.now()});
    `);
    oldDb.close();

    // Init with new DatabaseManager (triggers migration)
    manager = new DatabaseManager();
    manager.init(dbPath);

    // Verify model_providers was dropped and providers exists
    const db = manager.get();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    expect(tables).toContain('providers');
    expect(tables).toContain('provider_models');
    expect(tables).not.toContain('model_providers');

    // Verify project can be deleted without error
    const projects = new ProjectRepository();
    expect(() => {
      projects.delete('proj-1');
    }).not.toThrow();

    // Verify project was deleted
    const deletedProject = projects.getById('proj-1');
    expect(deletedProject).toBeNull();
  });

  it('handles database with only projects table (minimal schema)', () => {
    // Create a minimal database with only the projects table
    // This simulates a very old version or corrupted state
    const Database = require('better-sqlite3');
    const oldDb = new Database(dbPath);
    oldDb.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO projects (id, name, working_directory, created_at, updated_at)
      VALUES ('proj-2', 'Test', '/tmp', ${Date.now()}, ${Date.now()});
    `);
    oldDb.close();

    // Should not throw during init
    expect(() => {
      manager = new DatabaseManager();
      manager.init(dbPath);
    }).not.toThrow();

    // Verify all tables were created correctly
    const db = manager.get();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);

    expect(tables).toContain('providers');
    expect(tables).toContain('provider_models');
    expect(tables).not.toContain('model_providers');

    const openai = db.prepare('SELECT * FROM providers WHERE id = ?').get('openai-default');
    expect(openai).toMatchObject({
      name: 'OpenAI (Official)',
      kind: 'openai',
      is_built_in: 1,
      base_url: null,
      auth_token: null,
    });
    expect(db
      .prepare('SELECT COUNT(*) AS cnt FROM provider_models WHERE provider_id = ?')
      .get('openai-default').cnt).toBe(OPENAI_MODELS.length);

    // Project deletion should work
    const projects = new ProjectRepository();
    expect(() => {
      projects.delete('proj-2');
    }).not.toThrow();

    // Verify project was deleted
    const deletedProject = projects.getById('proj-2');
    expect(deletedProject).toBeNull();
  });

  it('handles new installation with only providers table', () => {
    // This simulates a fresh install where model_providers never existed
    manager = new DatabaseManager();
    manager.init(dbPath);

    // Verify providers table exists and model_providers doesn't
    const db = manager.get();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
    expect(tables).toContain('providers');
    expect(tables).not.toContain('model_providers');
  });

  it('migrates providers tables that already have Anthropic but no OpenAI built-in', () => {
    const Database = require('better-sqlite3');
    const oldDb = new Database(dbPath);
    const now = Date.now();
    oldDb.exec(`
      CREATE TABLE providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT,
        auth_token TEXT,
        api_timeout_ms INTEGER,
        additional_env_vars TEXT,
        is_built_in INTEGER NOT NULL DEFAULT 0,
        kind TEXT NOT NULL DEFAULT 'anthropic' CHECK(kind IN ('anthropic','openai')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE provider_models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        tier TEXT CHECK(tier IN ('opus', 'sonnet', 'haiku', 'custom')),
        created_at INTEGER NOT NULL
      );

      INSERT INTO providers (id, name, is_built_in, kind, created_at, updated_at)
      VALUES ('anthropic-default', 'Anthropic (Official)', 1, 'anthropic', ${now}, ${now});
    `);
    oldDb.close();

    manager = new DatabaseManager();
    manager.init(dbPath);

    const db = manager.get();
    const openai = db.prepare('SELECT * FROM providers WHERE id = ?').get('openai-default');
    expect(openai).toMatchObject({
      name: 'OpenAI (Official)',
      kind: 'openai',
      is_built_in: 1,
    });
    expect(db
      .prepare('SELECT COUNT(*) AS cnt FROM provider_models WHERE provider_id = ?')
      .get('openai-default').cnt).toBe(OPENAI_MODELS.length);
  });
});
