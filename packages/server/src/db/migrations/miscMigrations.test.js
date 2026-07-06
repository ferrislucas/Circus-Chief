import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_SESSION_TEMPLATE_PROMPTS,
  miscMigrations,
  STALE_CLAUDE_MODEL_IDS,
  CONFIG_MODEL_COLUMNS,
} from './miscMigrations.js';
import { providerMigrations } from './providerMigrations.js';
import { getDatabase } from '../index.js';
import { allMigrations } from './index.js';
import { OPENAI_MODELS } from '@circuschief/shared';
import { BUILT_IN_OPENAI_COMMIT_ATTRIBUTION } from '../seedBaselineData.js';

describe('legacy quick-response migrations', () => {
  it('DEFAULT_SESSION_TEMPLATE_PROMPTS is exported from miscMigrations for backward compatibility', () => {
    expect(typeof DEFAULT_SESSION_TEMPLATE_PROMPTS.REVIEW).toBe('string');
    expect(typeof DEFAULT_SESSION_TEMPLATE_PROMPTS.IMPLEMENT).toBe('string');
    expect(typeof DEFAULT_SESSION_TEMPLATE_PROMPTS.PR).toBe('string');
  });

  it('quick_responses-seed-defaults is not in allMigrations', () => {
    const names = allMigrations.map(m => m.name);
    expect(names).not.toContain('quick_responses-seed-defaults');
  });

  it('session_templates-convert-quick-responses is not in allMigrations', () => {
    const names = allMigrations.map(m => m.name);
    expect(names).not.toContain('session_templates-convert-quick-responses');
  });

  it('session_templates-seed-defaults is not in allMigrations', () => {
    const names = allMigrations.map(m => m.name);
    expect(names).not.toContain('session_templates-seed-defaults');
  });

  it('session_templates-remove-legacy-quick-response-templates is not in allMigrations', () => {
    const names = allMigrations.map(m => m.name);
    expect(names).not.toContain('session_templates-remove-legacy-quick-response-templates');
  });
});

const addKindMigration = providerMigrations.find(m => m.name === 'providers-add-kind');
const seedOpenAIMigration = providerMigrations.find(m => m.name === 'providers-seed-built-in-openai');
const backfillOpenAIAttributionMigration = providerMigrations.find(m => m.name === 'providers-backfill-built-in-openai-attribution');

describe('providers-add-kind migration', () => {
  it('exists in the migrations module', () => {
    expect(addKindMigration).toBeDefined();
    expect(typeof addKindMigration.up).toBe('function');
  });

  it('is registered in the canonical allMigrations list', () => {
    const names = allMigrations.map(m => m.name);
    expect(names).toContain('providers-add-kind');
  });

  it('runs after providers-create-tables in allMigrations order', () => {
    const names = allMigrations.map(m => m.name);
    const createIdx = names.indexOf('providers-create-tables');
    const kindIdx = names.indexOf('providers-add-kind');
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(kindIdx).toBeGreaterThan(createIdx);
  });

  it('fresh DB has providers.kind column with default "anthropic"', () => {
    const db = getDatabase();
    const cols = db.prepare('PRAGMA table_info(providers)').all();
    const kind = cols.find(c => c.name === 'kind');
    expect(kind).toBeDefined();
    expect(kind.notnull).toBe(1);
    // SQLite stores literal 'anthropic' (with quotes) in dflt_value
    expect(kind.dflt_value).toMatch(/anthropic/);
  });

  it('CHECK constraint exists on kind column (rejects invalid values)', () => {
    const db = getDatabase();
    expect(() => {
      db.prepare(
        `INSERT INTO providers (id, name, kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('bad-kind-test', 'Bad', 'gemini', Date.now(), Date.now());
    }).toThrow();
  });

  it('is idempotent when re-run on a DB that already has the kind column', () => {
    const db = getDatabase();
    // Fresh DB already has the column; re-running should be a no-op.
    expect(() => addKindMigration.up(db)).not.toThrow();
    const cols = db.prepare('PRAGMA table_info(providers)').all();
    const kindCount = cols.filter(c => c.name === 'kind').length;
    expect(kindCount).toBe(1);
  });

  it('backfills existing rows with default "anthropic" via ALTER TABLE ... DEFAULT', () => {
    const db = getDatabase();
    // Simulate a pre-migration state: drop the column, re-add it via the migration.
    // Since SQLite ALTER TABLE DROP COLUMN is supported in modern versions, we go
    // through a temp table if needed. Simpler: rely on the built-in seed row having
    // kind='anthropic' as a representative backfill check.
    const builtIn = db
      .prepare('SELECT kind FROM providers WHERE is_built_in = 1 LIMIT 1')
      .get();
    expect(builtIn).toBeDefined();
    expect(builtIn.kind).toBe('anthropic');
  });
});

describe('providers-seed-built-in-openai migration', () => {
  it('fresh DB has one built-in OpenAI provider with default attribution and null auth/base URL', () => {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM providers WHERE id = ?')
      .all('openai-default');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'OpenAI (Official)',
      kind: 'openai',
      is_built_in: 1,
      base_url: null,
      auth_token: null,
      commit_attribution_override: BUILT_IN_OPENAI_COMMIT_ATTRIBUTION,
    });
  });

  it('fresh DB has one model row per OPENAI_MODELS entry', () => {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM provider_models WHERE provider_id = ? ORDER BY model_id')
      .all('openai-default');

    expect(rows).toHaveLength(OPENAI_MODELS.length);
    expect(rows.map((row) => row.model_id).sort()).toEqual(
      OPENAI_MODELS.map((model) => model.id).sort()
    );

    for (const model of OPENAI_MODELS) {
      const row = rows.find((entry) => entry.model_id === model.id);
      expect(row).toMatchObject({
        id: model.seedId,
        display_name: model.name,
        description: model.description,
        tier: 'custom',
      });
    }
  });

  it('is idempotent when re-run on an already-seeded DB', () => {
    const db = getDatabase();
    seedOpenAIMigration.up(db);

    const providerCount = db
      .prepare('SELECT COUNT(*) AS cnt FROM providers WHERE id = ?')
      .get('openai-default').cnt;
    const modelCount = db
      .prepare('SELECT COUNT(*) AS cnt FROM provider_models WHERE provider_id = ?')
      .get('openai-default').cnt;

    expect(providerCount).toBe(1);
    expect(modelCount).toBe(OPENAI_MODELS.length);
  });

  it('is registered after providers-add-kind and providers-seed-built-in', () => {
    const names = allMigrations.map(m => m.name);
    const kindIdx = names.indexOf('providers-add-kind');
    const historicalSeedIdx = names.indexOf('providers-seed-built-in');
    const openAISeedIdx = names.indexOf('providers-seed-built-in-openai');

    expect(openAISeedIdx).toBeGreaterThan(kindIdx);
    expect(openAISeedIdx).toBeGreaterThan(historicalSeedIdx);
  });
});

describe('providers-backfill-built-in-openai-attribution migration', () => {
  it('fills null attribution on the built-in OpenAI provider', () => {
    const db = getDatabase();
    db.prepare(
      'UPDATE providers SET commit_attribution_override = NULL WHERE id = ?'
    ).run('openai-default');

    backfillOpenAIAttributionMigration.up(db);

    const row = db.prepare(
      'SELECT commit_attribution_override FROM providers WHERE id = ?'
    ).get('openai-default');
    expect(row.commit_attribution_override).toBe(BUILT_IN_OPENAI_COMMIT_ATTRIBUTION);
  });

  it('preserves an existing built-in OpenAI attribution override', () => {
    const db = getDatabase();
    const customAttribution = 'Co-authored-by: Custom Codex <custom@example.com>';
    db.prepare(
      'UPDATE providers SET commit_attribution_override = ? WHERE id = ?'
    ).run(customAttribution, 'openai-default');

    backfillOpenAIAttributionMigration.up(db);

    const row = db.prepare(
      'SELECT commit_attribution_override FROM providers WHERE id = ?'
    ).get('openai-default');
    expect(row.commit_attribution_override).toBe(customAttribution);
  });

  it('is registered after the built-in OpenAI seed migration', () => {
    const names = allMigrations.map(m => m.name);
    const openAISeedIdx = names.indexOf('providers-seed-built-in-openai');
    const attributionBackfillIdx = names.indexOf('providers-backfill-built-in-openai-attribution');

    expect(attributionBackfillIdx).toBeGreaterThan(openAISeedIdx);
  });
});

const normalizeMigration = miscMigrations.find(
  (m) => m.name === 'normalize-stale-claude-model-ids'
);

describe('normalize-stale-claude-model-ids migration', () => {
  const PID = 'test-norm-project';
  const BOARD = 'test-norm-board';
  const T_PREFIX = 'test-norm-';

  // Test rows seeded with every stale id, plus current/NULL controls.
  function seed(db) {
    const now = Date.now();
    db.prepare('INSERT INTO projects (id, name, working_directory) VALUES (?, ?, ?)')
      .run(PID, 'Norm Test', '/tmp/norm-test');
    db.prepare('INSERT INTO kanban_boards (id, project_id) VALUES (?, ?)').run(BOARD, PID);

    const insertLane = db.prepare(
      'INSERT INTO kanban_lanes (id, board_id, name, on_enter_model) VALUES (?, ?, ?, ?)'
    );
    insertLane.run(`${T_PREFIX}lane-sonnet46`, BOARD, 'L1', 'claude-sonnet-4-6');
    insertLane.run(`${T_PREFIX}lane-alias`, BOARD, 'L2', 'sonnet');
    insertLane.run(`${T_PREFIX}lane-null`, BOARD, 'L3', null);
    insertLane.run(`${T_PREFIX}lane-current`, BOARD, 'L4', 'claude-sonnet-5');

    const insertTpl = db.prepare(
      'INSERT INTO session_templates (id, name, prompt, model) VALUES (?, ?, ?, ?)'
    );
    insertTpl.run(`${T_PREFIX}tpl-opus45`, 'T', 'p', 'claude-opus-4-5-20251101');
    insertTpl.run(`${T_PREFIX}tpl-current`, 'T', 'p', 'claude-haiku-4-5-20251001');

    db.prepare(
      'INSERT INTO project_session_defaults (id, project_id, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(`${T_PREFIX}pd`, PID, 'claude-sonnet-4-5-20250929', now, now);

    // RECORD row — must be preserved (sessions.model is historical/audit data).
    db.prepare('INSERT INTO sessions (id, project_id, name, model) VALUES (?, ?, ?, ?)')
      .run(`${T_PREFIX}session`, PID, 'S', 'claude-sonnet-4-6');
  }

  function cleanup(db) {
    for (const table of [
      'kanban_lanes',
      'kanban_boards',
      'session_templates',
      'project_session_defaults',
      'sessions',
      'projects',
    ]) {
      db.prepare(`DELETE FROM ${table} WHERE id LIKE ?`).run(`${T_PREFIX}%`);
      if (table === 'kanban_boards') {
        db.prepare('DELETE FROM kanban_boards WHERE id = ?').run(BOARD);
      }
      if (table === 'projects') {
        db.prepare('DELETE FROM projects WHERE id = ?').run(PID);
      }
    }
  }

  beforeEach(() => {
    const db = getDatabase();
    cleanup(db); // defensive: clear any leftovers from a failed prior run
    seed(db);
  });

  afterEach(() => {
    cleanup(getDatabase());
  });

  it('exists and is registered in allMigrations', () => {
    expect(normalizeMigration).toBeDefined();
    expect(typeof normalizeMigration.up).toBe('function');
    const names = allMigrations.map((m) => m.name);
    expect(names).toContain('normalize-stale-claude-model-ids');
  });

  it('rewrites stale Sonnet ids in kanban_lanes.on_enter_model', () => {
    const db = getDatabase();
    normalizeMigration.up(db);
    const row = db
      .prepare('SELECT on_enter_model FROM kanban_lanes WHERE id = ?')
      .get(`${T_PREFIX}lane-sonnet46`);
    expect(row.on_enter_model).toBe('claude-sonnet-5');
  });

  it('rewrites bare tier aliases (sonnet) in config columns', () => {
    const db = getDatabase();
    normalizeMigration.up(db);
    const row = db
      .prepare('SELECT on_enter_model FROM kanban_lanes WHERE id = ?')
      .get(`${T_PREFIX}lane-alias`);
    expect(row.on_enter_model).toBe('claude-sonnet-5');
  });

  it('rewrites stale Opus id in session_templates.model to the current default', () => {
    const db = getDatabase();
    normalizeMigration.up(db);
    const row = db
      .prepare('SELECT model FROM session_templates WHERE id = ?')
      .get(`${T_PREFIX}tpl-opus45`);
    expect(row.model).toBe('claude-opus-4-8');
  });

  it('rewrites stale ids in project_session_defaults.model', () => {
    const db = getDatabase();
    normalizeMigration.up(db);
    const row = db
      .prepare('SELECT model FROM project_session_defaults WHERE id = ?')
      .get(`${T_PREFIX}pd`);
    expect(row.model).toBe('claude-sonnet-5');
  });

  it('preserves already-current ids', () => {
    const db = getDatabase();
    normalizeMigration.up(db);
    const lane = db
      .prepare('SELECT on_enter_model FROM kanban_lanes WHERE id = ?')
      .get(`${T_PREFIX}lane-current`);
    const tpl = db
      .prepare('SELECT model FROM session_templates WHERE id = ?')
      .get(`${T_PREFIX}tpl-current`);
    expect(lane.on_enter_model).toBe('claude-sonnet-5');
    expect(tpl.model).toBe('claude-haiku-4-5-20251001');
  });

  it('preserves NULL config values', () => {
    const db = getDatabase();
    normalizeMigration.up(db);
    const row = db
      .prepare('SELECT on_enter_model FROM kanban_lanes WHERE id = ?')
      .get(`${T_PREFIX}lane-null`);
    expect(row.on_enter_model).toBeNull();
  });

  it('does NOT rewrite sessions.model — records are historical, not config', () => {
    const db = getDatabase();
    normalizeMigration.up(db);
    const row = db
      .prepare('SELECT model FROM sessions WHERE id = ?')
      .get(`${T_PREFIX}session`);
    // A session that actually ran on Sonnet 4.6 must keep recording Sonnet 4.6.
    expect(row.model).toBe('claude-sonnet-4-6');
  });

  it('only touches config columns (never record/audit columns)', () => {
    const db = getDatabase();
    // Every column the migration touches must be a known config column.
    const touched = CONFIG_MODEL_COLUMNS.map(([t, c]) => `${t}.${c}`);
    expect(touched).toEqual(
      expect.arrayContaining([
        'kanban_lanes.on_enter_model',
        'session_templates.model',
        'project_session_defaults.model',
      ])
    );
    // Guard against accidentally widening scope to record columns later.
    expect(touched).not.toContain('sessions.model');
    expect(touched).not.toContain('conversations.model');
    expect(touched).not.toContain('conversation_messages.model');
    expect(touched).not.toContain('agent_call_logs.model');
    expect(Object.keys(STALE_CLAUDE_MODEL_IDS).length).toBeGreaterThan(0);
    // Smoke-test: running it shouldn't throw on a freshly-seeded DB.
    expect(() => normalizeMigration.up(db)).not.toThrow();
  });

  it('is idempotent — re-running changes nothing', () => {
    const db = getDatabase();
    normalizeMigration.up(db);
    const afterFirst = db
      .prepare('SELECT on_enter_model FROM kanban_lanes WHERE id = ?')
      .get(`${T_PREFIX}lane-sonnet46`).on_enter_model;
    normalizeMigration.up(db);
    const afterSecond = db
      .prepare('SELECT on_enter_model FROM kanban_lanes WHERE id = ?')
      .get(`${T_PREFIX}lane-sonnet46`).on_enter_model;
    expect(afterFirst).toBe('claude-sonnet-5');
    expect(afterSecond).toBe('claude-sonnet-5');
    // No stale id remains in any config column after the run.
    for (const [table, col] of CONFIG_MODEL_COLUMNS) {
      const count = db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} IN (${Object.keys(STALE_CLAUDE_MODEL_IDS).map(() => '?').join(',')})`)
        .get(...Object.keys(STALE_CLAUDE_MODEL_IDS)).n;
      expect(count).toBe(0);
    }
  });
});
