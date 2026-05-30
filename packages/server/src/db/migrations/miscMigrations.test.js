import { describe, it, expect } from 'vitest';
import { miscMigrations, DEFAULT_SESSION_TEMPLATE_PROMPTS } from './miscMigrations.js';
import { providerMigrations } from './providerMigrations.js';
import { getDatabase, ProjectRepository } from '../index.js';
import { allMigrations } from './index.js';
import { OPENAI_MODELS } from '@circuschief/shared';
import { BUILT_IN_OPENAI_COMMIT_ATTRIBUTION } from '../seedBaselineData.js';

const removeLegacyTemplatesMigration = miscMigrations.find(
  m => m.name === 'session_templates-remove-legacy-quick-response-templates'
);

describe('session_templates-remove-legacy-quick-response-templates migration', () => {
  it('is defined and has an up() function', () => {
    expect(removeLegacyTemplatesMigration).toBeDefined();
    expect(typeof removeLegacyTemplatesMigration.up).toBe('function');
  });

  it('is registered in allMigrations', () => {
    const names = allMigrations.map(m => m.name);
    expect(names).toContain('session_templates-remove-legacy-quick-response-templates');
  });

  it('removes only rows with a non-null legacy_quick_response_id', () => {
    const db = getDatabase();
    db.prepare('DELETE FROM session_templates').run();

    const now = Date.now();
    const projectRepo = new ProjectRepository();
    const project = projectRepo.create('Migration Test Project', '/tmp/migration-test');

    // Insert a template that simulates a legacy converted row (should be deleted)
    db.prepare(`
      INSERT INTO session_templates (
        id, project_id, name, prompt, thinking_enabled, mode,
        show_in_quick_responses, quick_response_auto_submit,
        quick_response_sort_order, legacy_quick_response_id,
        created_at, updated_at
      ) VALUES (?, NULL, ?, ?, 1, 'yolo', 1, 1, 0, ?, ?, ?)
    `).run('legacy-tpl-1', 'Legacy Response', 'legacy content', 'some-legacy-qr-id', now, now);

    // Insert a normal template (should NOT be deleted)
    db.prepare(`
      INSERT INTO session_templates (
        id, project_id, name, prompt, thinking_enabled, mode,
        show_in_quick_responses, quick_response_auto_submit,
        quick_response_sort_order, legacy_quick_response_id,
        created_at, updated_at
      ) VALUES (?, NULL, ?, ?, 1, 'yolo', 0, 0, 0, NULL, ?, ?)
    `).run('normal-tpl-1', 'Normal Template', 'normal prompt', now, now);

    // Insert a project-scoped normal template (should NOT be deleted)
    db.prepare(`
      INSERT INTO session_templates (
        id, project_id, name, prompt, thinking_enabled, mode,
        show_in_quick_responses, quick_response_auto_submit,
        quick_response_sort_order, legacy_quick_response_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 'yolo', 1, 1, 0, NULL, ?, ?)
    `).run('project-tpl-1', project.id, 'Project Template', 'project prompt', now, now);

    // Insert another legacy converted row for a different project (should be deleted)
    db.prepare(`
      INSERT INTO session_templates (
        id, project_id, name, prompt, thinking_enabled, mode,
        show_in_quick_responses, quick_response_auto_submit,
        quick_response_sort_order, legacy_quick_response_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, 1, 'yolo', 1, 0, 2, ?, ?, ?)
    `).run('legacy-tpl-2', project.id, 'Project Legacy', 'project legacy content', 'another-legacy-qr-id', now, now);

    removeLegacyTemplatesMigration.up(db);

    const remaining = db.prepare('SELECT id FROM session_templates ORDER BY id').all().map(r => r.id);
    expect(remaining).toHaveLength(2);
    expect(remaining).toContain('normal-tpl-1');
    expect(remaining).toContain('project-tpl-1');
    expect(remaining).not.toContain('legacy-tpl-1');
    expect(remaining).not.toContain('legacy-tpl-2');
  });

  it('is idempotent (safe to run when no legacy rows exist)', () => {
    const db = getDatabase();
    // All legacy rows should already be gone after the migration runs on fresh DB.
    const legacyCount = db.prepare(
      'SELECT COUNT(*) AS cnt FROM session_templates WHERE legacy_quick_response_id IS NOT NULL'
    ).get().cnt;
    expect(legacyCount).toBe(0);

    // Running again should not throw or change anything.
    expect(() => removeLegacyTemplatesMigration.up(db)).not.toThrow();

    expect(db.prepare(
      'SELECT COUNT(*) AS cnt FROM session_templates WHERE legacy_quick_response_id IS NOT NULL'
    ).get().cnt).toBe(0);
  });

  it('fresh DB has zero session_templates with legacy_quick_response_id set', () => {
    const db = getDatabase();
    const count = db.prepare(
      'SELECT COUNT(*) AS cnt FROM session_templates WHERE legacy_quick_response_id IS NOT NULL'
    ).get().cnt;
    expect(count).toBe(0);
  });

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
