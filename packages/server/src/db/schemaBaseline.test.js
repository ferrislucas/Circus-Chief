import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_RESCHEDULE_DELAY_MINUTES } from '@circuschief/shared';
import { DatabaseManager } from './DatabaseManager.js';
import { allMigrations } from './migrations/index.js';
import { seedBaselineData } from './seedBaselineData.js';

function withDb(fn) {
  const manager = new DatabaseManager();
  const db = manager.init(':memory:');
  try {
    return fn(db);
  } finally {
    manager.close();
  }
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function columnNames(db, table) {
  return columns(db, table).map((col) => col.name);
}

function indexColumns(db, indexName) {
  return db.prepare(`PRAGMA index_info(${indexName})`).all().map((row) => row.name);
}

describe('schema baseline', () => {
  it('initializes a fresh in-memory database', () => {
    withDb((db) => {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'sessions'").get()).toBeTruthy();
    });
  });

  it('is idempotent against the same file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'circuschief-schema-'));
    const dbPath = join(dir, 'app.db');
    const manager = new DatabaseManager();

    try {
      manager.init(dbPath);
      manager.close();
      expect(() => manager.init(dbPath)).not.toThrow();
    } finally {
      manager.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enables foreign keys', () => {
    withDb((db) => {
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    });
  });

  it('has the expected sessions columns in order', () => {
    withDb((db) => {
      expect(columnNames(db, 'sessions')).toEqual([
        'id', 'project_id', 'name', 'status', 'mode', 'thinking_enabled',
        'archived', 'git_branch', 'git_worktree', 'pr_url', 'pr_url_auto_link_disabled',
        'error', 'effort_level', 'cost_usd', 'claude_session_id', 'model', 'provider_id',
        'next_template_id', 'parent_session_id', 'input_tokens', 'output_tokens',
        'thinking_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
        'web_search_requests', 'context_window', 'starred', 'manually_named',
        'scheduled_at', 'reschedule_delay_minutes', 'auto_reschedule_enabled',
        'reschedule_on_token_limit', 'reschedule_on_service_error',
        'max_reschedule_count', 'max_total_tokens', 'reschedule_count',
        'reschedule_at_token_count', 'pending_prompt', 'slash_commands',
        'pending_model', 'auto_send_pending_prompt', 'agent_type',
        'lane_trigger_depth', 'created_at', 'updated_at', 'pending_conversation_id',
      ]);
    });
  });

  it('has canonical sessions defaults', () => {
    withDb((db) => {
      const byName = new Map(columns(db, 'sessions').map((col) => [col.name, col]));
      expect(byName.get('mode').dflt_value).toBe("'yolo'");
      expect(byName.get('thinking_enabled').dflt_value).toBe('1');
      expect(byName.get('reschedule_delay_minutes').dflt_value).toBe(String(DEFAULT_RESCHEDULE_DELAY_MINUTES));
      expect(byName.get('agent_type').dflt_value).toBe("'claude-code'");
      expect(byName.get('pr_url_auto_link_disabled').dflt_value).toBe('0');
    });
  });

  it('enforces sessions status and foreign keys', () => {
    withDb((db) => {
      const now = Date.now();
      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('project-1', 'Project', '/tmp', now, now);

      expect(() => db.prepare(
        'INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('session-1', 'project-1', 'Session', 'scheduled', now, now)).not.toThrow();

      expect(() => db.prepare(
        'INSERT INTO sessions (id, project_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('session-2', 'project-1', 'Session', 'invalid', now, now)).toThrow();

      expect(() => db.prepare(
        'INSERT INTO sessions (id, project_id, name, provider_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('session-3', 'project-1', 'Session', 'missing-provider', now, now)).toThrow();

    });
  });

  it('creates required baseline tables and columns', () => {
    withDb((db) => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
      expect(tables).toEqual(expect.arrayContaining([
        'project_session_defaults', 'app_settings', 'providers', 'provider_models',
        'kanban_boards', 'kanban_lanes', 'kanban_cards', 'kanban_card_sessions',
      ]));

      expect(columnNames(db, 'projects')).toEqual(expect.arrayContaining(['worktree_path', 'kanban_enabled']));
      expect(columnNames(db, 'project_session_defaults')).toEqual(expect.arrayContaining(['provider_id', 'effort_level']));
      expect(columnNames(db, 'session_templates')).toEqual(expect.arrayContaining(['model', 'mode', 'effort_level']));
      expect(columnNames(db, 'conversation_messages')).toEqual(expect.arrayContaining(['conversation_id', 'model']));
      expect(columnNames(db, 'conversations')).toEqual(expect.arrayContaining(['model', 'parent_conversation_id', 'branch_from_message_id']));
      expect(columnNames(db, 'session_summaries')).toEqual(expect.arrayContaining(['last_summarized_message_id', 'workflow_fingerprint']));
      expect(columnNames(db, 'message_attachments')).toEqual(expect.arrayContaining(['file_path']));
      expect(columnNames(db, 'kanban_lanes')).toEqual(expect.arrayContaining(['on_enter_reschedule_delay_minutes', 'completion_target_lane_id']));
    });
  });

  it('has kanban lane trigger columns with expected defaults', () => {
    withDb((db) => {
      const byName = new Map(columns(db, 'kanban_lanes').map((col) => [col.name, col]));
      expect(byName.get('on_enter_mode')).toBeTruthy();
      expect(byName.get('on_enter_model')).toBeTruthy();
      expect(byName.get('on_enter_effort_level')).toBeTruthy();
      expect(byName.get('on_enter_thinking_enabled')).toBeTruthy();
      expect(byName.get('on_enter_auto_reschedule_enabled').dflt_value).toBe('0');
      expect(byName.get('on_enter_reschedule_delay_minutes').dflt_value).toBe(String(DEFAULT_RESCHEDULE_DELAY_MINUTES));
      expect(byName.get('on_enter_reschedule_on_token_limit').dflt_value).toBe('1');
      expect(byName.get('on_enter_reschedule_on_service_error').dflt_value).toBe('1');
      expect(byName.get('on_enter_max_reschedule_count')).toBeTruthy();
      expect(byName.get('on_enter_max_total_tokens')).toBeTruthy();
      expect(byName.get('on_enter_reschedule_at_token_count')).toBeTruthy();
      expect(byName.get('completion_target_lane_id')).toBeTruthy();
    });
  });

  it('enforces drift-sensitive check constraints', () => {
    withDb((db) => {
      const now = Date.now();
      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('project-1', 'Project', '/tmp', now, now);

      for (const gitMode of ['branch', 'worktree', 'current']) {
        expect(() => db.prepare(
          'INSERT INTO project_session_defaults (id, project_id, git_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        ).run(`defaults-${gitMode}`, 'project-1', gitMode, now, now)).not.toThrow();
        db.prepare('DELETE FROM project_session_defaults').run();
      }
      expect(() => db.prepare(
        'INSERT INTO project_session_defaults (id, project_id, git_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('defaults-bad', 'project-1', 'bad', now, now)).toThrow();

      expect(() => db.prepare(
        'INSERT INTO canvas_items (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run('canvas-code', 'code', now, now)).not.toThrow();
      expect(() => db.prepare(
        'INSERT INTO canvas_items (id, type, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run('canvas-bad', 'bad', now, now)).toThrow();

      expect(() => db.prepare(
        'INSERT INTO providers (id, name, kind) VALUES (?, ?, ?)'
      ).run('provider-anthropic', 'Anthropic', 'anthropic')).not.toThrow();
      expect(() => db.prepare(
        'INSERT INTO providers (id, name, kind) VALUES (?, ?, ?)'
      ).run('provider-openai', 'OpenAI', 'openai')).not.toThrow();
      expect(() => db.prepare(
        'INSERT INTO providers (id, name, kind) VALUES (?, ?, ?)'
      ).run('provider-bad', 'Bad', 'bad')).toThrow();

      db.prepare(
        'INSERT INTO sessions (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('session-agent-log', 'project-1', 'Session', now, now);
      for (const status of ['pending', 'streaming', 'completed', 'error']) {
        expect(() => db.prepare(
          'INSERT INTO agent_call_logs (id, session_id, agent_type, call_type, started_at, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(`log-${status}`, 'session-agent-log', 'claude-code', 'runSession', now, status)).not.toThrow();
      }
      expect(() => db.prepare(
        'INSERT INTO agent_call_logs (id, session_id, agent_type, call_type, started_at, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run('log-bad', 'session-agent-log', 'claude-code', 'runSession', now, 'bad')).toThrow();
    });
  });

  it('creates required indexes with expected columns and partial SQL', () => {
    withDb((db) => {
      expect(indexColumns(db, 'idx_sessions_starred')).toEqual(['archived', 'starred']);
      expect(indexColumns(db, 'idx_sessions_scheduled')).toEqual(['scheduled_at']);
      expect(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_sessions_scheduled'").get().sql)
        .toContain('WHERE scheduled_at IS NOT NULL');

      for (const indexName of [
        'idx_sessions_project', 'idx_sessions_status', 'idx_sessions_archived',
        'idx_sessions_next_template', 'idx_sessions_parent', 'idx_messages_conversation',
        'idx_canvas_deleted', 'idx_todos_conversation', 'idx_project_defaults_projectId',
        'idx_conversations_parent', 'idx_agent_call_logs_agent_type',
        'idx_agent_call_logs_call_type', 'idx_agent_call_logs_status',
        'idx_agent_call_logs_model',
      ]) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName)).toBeTruthy();
      }
    });
  });

  it('direct schema initialization plus baseline seeding plus migrations matches DatabaseManager schema metadata', () => {
    const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf-8');
    const directDb = new Database(':memory:');
    const manager = new DatabaseManager();
    const managedDb = manager.init(':memory:');

    try {
      directDb.pragma('foreign_keys = ON');
      directDb.exec(schema);
      seedBaselineData(directDb);
      for (const migration of allMigrations) {
        migration.up(directDb);
      }

      const directObjects = directDb.prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
      ).all();
      const managedObjects = managedDb.prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
      ).all();
      expect(directObjects).toEqual(managedObjects);
    } finally {
      directDb.close();
      manager.close();
    }
  });

  it('includes repair-missing-session-parents-from-worktree migration', () => {
    const names = allMigrations.map((migration) => migration.name);
    expect(names).toContain('repair-missing-session-parents-from-worktree');
  });
});
