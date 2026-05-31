import { describe, it, expect } from 'vitest';
import { OPENAI_MODELS } from '@circuschief/shared';
import { DatabaseManager } from './DatabaseManager.js';
import {
  BUILT_IN_ANTHROPIC_MODELS,
  BUILT_IN_ANTHROPIC_PROVIDER,
  BUILT_IN_OPENAI_COMMIT_ATTRIBUTION,
  BUILT_IN_OPENAI_MODELS,
  BUILT_IN_OPENAI_PROVIDER,
  BUILT_IN_GOOGLE_MODELS,
  seedBaselineData,
} from './seedBaselineData.js';
import {
  DEFAULT_SESSION_TEMPLATES,
  DEFAULT_SESSION_TEMPLATE_PROMPTS,
} from './defaultSessionTemplates.js';
import { bootstrapDefaultSessionTemplates } from './bootstrapDefaultSessionTemplates.js';

function withDb(fn) {
  const manager = new DatabaseManager();
  const db = manager.init(':memory:');
  try {
    return fn(db, manager);
  } finally {
    manager.close();
  }
}

describe('seedBaselineData', () => {
  it('creates built-in providers with expected null endpoint fields', () => {
    withDb((db) => {
      const anthropic = db.prepare('SELECT * FROM providers WHERE id = ?').get(BUILT_IN_ANTHROPIC_PROVIDER.id);
      expect(anthropic).toMatchObject({
        name: BUILT_IN_ANTHROPIC_PROVIDER.name,
        kind: BUILT_IN_ANTHROPIC_PROVIDER.kind,
        is_built_in: 1,
        base_url: null,
        auth_token: null,
        commit_attribution_override: null,
      });

      const openai = db.prepare('SELECT * FROM providers WHERE id = ?').get(BUILT_IN_OPENAI_PROVIDER.id);
      expect(openai).toMatchObject({
        name: BUILT_IN_OPENAI_PROVIDER.name,
        kind: BUILT_IN_OPENAI_PROVIDER.kind,
        is_built_in: 1,
        base_url: null,
        auth_token: null,
        commit_attribution_override: BUILT_IN_OPENAI_COMMIT_ATTRIBUTION,
      });
    });
  });

  it('creates expected built-in Anthropic provider models', () => {
    withDb((db) => {
      const rows = db.prepare(
        'SELECT id, provider_id, model_id, display_name, description, tier FROM provider_models WHERE provider_id = ? ORDER BY id'
      ).all(BUILT_IN_ANTHROPIC_PROVIDER.id);

      expect(rows).toEqual(BUILT_IN_ANTHROPIC_MODELS
        .map((model) => ({
          id: model.id,
          provider_id: model.providerId,
          model_id: model.modelId,
          display_name: model.displayName,
          description: model.description,
          tier: model.tier,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)));
    });
  });

  it('creates one OpenAI provider model per OPENAI_MODELS entry', () => {
    withDb((db) => {
      const rows = db.prepare(
        'SELECT id, provider_id, model_id, display_name, description, tier FROM provider_models WHERE provider_id = ? ORDER BY id'
      ).all(BUILT_IN_OPENAI_PROVIDER.id);

      expect(rows).toHaveLength(OPENAI_MODELS.length);
      expect(rows).toEqual(BUILT_IN_OPENAI_MODELS
        .map((model) => ({
          id: model.id,
          provider_id: model.providerId,
          model_id: model.modelId,
          display_name: model.displayName,
          description: model.description,
          tier: model.tier,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)));
    });
  });

  it('does not create default global quick_responses on startup', () => {
    withDb((db) => {
      const count = db.prepare('SELECT COUNT(*) AS cnt FROM quick_responses').get().cnt;
      expect(count).toBe(0);
    });
  });

  it('creates exactly six default global session templates on a fresh DB', () => {
    withDb((db) => {
      const rows = db.prepare(
        'SELECT * FROM session_templates WHERE project_id IS NULL ORDER BY name'
      ).all();

      expect(rows).toHaveLength(DEFAULT_SESSION_TEMPLATES.length);

      const names = rows.map((r) => r.name).sort();
      expect(names).toEqual(DEFAULT_SESSION_TEMPLATES.map((t) => t.name).sort());
    });
  });

  it('creates workflow templates with show_in_quick_responses = 0 and correct prompts', () => {
    withDb((db) => {
      const workflowTemplates = DEFAULT_SESSION_TEMPLATES.filter((t) => !t.showInQuickResponses);
      const rows = db.prepare(
        'SELECT * FROM session_templates WHERE project_id IS NULL AND show_in_quick_responses = 0 ORDER BY name'
      ).all();

      expect(rows).toHaveLength(workflowTemplates.length);
      for (const expected of workflowTemplates) {
        const actual = rows.find((r) => r.name === expected.name);
        expect(actual).toBeDefined();
        expect(actual.prompt).toBe(expected.prompt);
        expect(actual.thinking_enabled).toBe(1);
        expect(actual.mode).toBe('yolo');
        expect(actual.legacy_quick_response_id).toBeNull();
      }
    });
  });

  it('creates quick-response-backed templates with expected fields and sort order', () => {
    withDb((db) => {
      const rows = db.prepare(
        `SELECT name, prompt, show_in_quick_responses, quick_response_auto_submit,
                quick_response_sort_order, legacy_quick_response_id
         FROM session_templates
         WHERE project_id IS NULL AND show_in_quick_responses = 1
         ORDER BY quick_response_sort_order`
      ).all();

      expect(rows).toHaveLength(3);

      // Put a plan on the canvas — sort_order 0, auto_submit 0
      expect(rows[0]).toMatchObject({
        name: 'Put a plan on the canvas',
        prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.PUT_PLAN,
        show_in_quick_responses: 1,
        quick_response_auto_submit: 0,
        quick_response_sort_order: 0,
        legacy_quick_response_id: null,
      });

      // Yes — sort_order 1, auto_submit 1
      expect(rows[1]).toMatchObject({
        name: 'Yes',
        prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.YES,
        show_in_quick_responses: 1,
        quick_response_auto_submit: 1,
        quick_response_sort_order: 1,
        legacy_quick_response_id: null,
      });

      // Continue — sort_order 2, auto_submit 1
      expect(rows[2]).toMatchObject({
        name: 'Continue',
        prompt: DEFAULT_SESSION_TEMPLATE_PROMPTS.CONTINUE,
        show_in_quick_responses: 1,
        quick_response_auto_submit: 1,
        quick_response_sort_order: 2,
        legacy_quick_response_id: null,
      });
    });
  });

  it('sets the bootstrap flag so a second startup does not recreate deleted templates', () => {
    withDb((db) => {
      // Verify the bootstrap flag was set
      const setting = db.prepare(
        "SELECT value FROM app_settings WHERE key = 'default_session_templates_bootstrapped'"
      ).get();
      expect(setting?.value).toBe('true');

      // Delete all session templates (simulate a user deleting defaults)
      db.prepare('DELETE FROM session_templates').run();
      expect(db.prepare('SELECT COUNT(*) AS cnt FROM session_templates').get().cnt).toBe(0);

      // Calling bootstrapDefaultSessionTemplates again is a no-op since the flag is set.
      bootstrapDefaultSessionTemplates(db, { isFirstRun: true });

      // Templates should still be gone
      expect(db.prepare('SELECT COUNT(*) AS cnt FROM session_templates').get().cnt).toBe(0);
    });
  });

  it('does not duplicate providers or models when seedBaselineData is rerun', () => {
    withDb((db) => {
      seedBaselineData(db);
      expect(db.prepare('SELECT COUNT(*) AS cnt FROM providers').get().cnt).toBe(3);
      expect(db.prepare('SELECT COUNT(*) AS cnt FROM provider_models').get().cnt)
        .toBe(BUILT_IN_ANTHROPIC_MODELS.length + BUILT_IN_OPENAI_MODELS.length + BUILT_IN_GOOGLE_MODELS.length);
    });
  });

  it('seeds global templates when only project-scoped templates exist (bootstrap not yet set)', () => {
    // This test directly calls bootstrapDefaultSessionTemplates to verify it
    // creates defaults when the flag is not set and isFirstRun is true, even
    // when project-scoped templates already exist.
    const manager = new DatabaseManager();
    const db = manager.init(':memory:');
    try {
      // Reset bootstrap flag and remove all templates
      db.prepare("DELETE FROM app_settings WHERE key = 'default_session_templates_bootstrapped'").run();
      db.prepare('DELETE FROM session_templates').run();

      // Insert a project-scoped template
      const now = Date.now();
      db.prepare('INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run('project-template-owner', 'Project', '/tmp/project', now, now);
      db.prepare(
        `INSERT INTO session_templates (
          id, project_id, name, prompt, thinking_enabled, mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, 'yolo', ?, ?)`
      ).run('project-template', 'project-template-owner', 'Project Template', 'Project prompt', now, now);

      // Bootstrap with isFirstRun = true (flag is gone, so it should insert defaults)
      bootstrapDefaultSessionTemplates(db, { isFirstRun: true });

      expect(db.prepare('SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NULL').get().cnt)
        .toBe(DEFAULT_SESSION_TEMPLATES.length);
      expect(db.prepare('SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NOT NULL').get().cnt)
        .toBe(1);
    } finally {
      manager.close();
    }
  });
});
