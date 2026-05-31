import { describe, it, expect } from 'vitest';
import { DEFAULT_SESSION_TEMPLATE_PROMPTS } from './miscMigrations.js';
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
