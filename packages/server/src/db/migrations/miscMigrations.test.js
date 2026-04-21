import { describe, it, expect } from 'vitest';
import { miscMigrations, DEFAULT_SESSION_TEMPLATE_PROMPTS } from './miscMigrations.js';
import { getDatabase, ProjectRepository } from '../index.js';

const seedMigration = miscMigrations.find(m => m.name === 'quick_responses-seed-defaults');
const seedTemplatesMigration = miscMigrations.find(m => m.name === 'session_templates-seed-defaults');

const expectedDefaults = [
  { label: 'Put a plan on the canvas', content: 'Put a plan on the canvas to get this done', autoSubmit: false, sortOrder: 0 },
  { label: 'Yes', content: 'Yes', autoSubmit: true, sortOrder: 1 },
  { label: 'Review the plan', content: `Review the plan on the canvas. Are there any issues that you can find? Is test coverage specified explicitly enough? Does the current code match the assumptions in the plan?\n\nList the issues that you find and then update the plan on the canvas to address any issues that you find. Don't talk about issues with the original plan in the plan itself. Just tell me what the issues are, and update the plan so that the plan doesn't have the issues.`, autoSubmit: true, sortOrder: 2 },
  { label: 'Implement the plan on the canvas', content: 'Implement the plan on the canvas', autoSubmit: true, sortOrder: 3 },
  { label: 'Create / Update PR', content: `Ensure all relevant changes are committed and pushed. Then look at the session's summary and create a draft PR if no PR already exists.`, autoSubmit: true, sortOrder: 4 },
  { label: 'Review PR', content: 'Look at the PR related to the root session. Review the PR. Are there any issues? Are best practices adhered to? Does the PR accomplish the goal? Are all changes covered by tests?', autoSubmit: true, sortOrder: 5 },
  { label: 'Add tests', content: 'Inspect the changes on our branch. For each change, ensure we have tests that assert the change is working in the expected way. Implement the tests.', autoSubmit: true, sortOrder: 6 },
  { label: 'Merge in main', content: 'Merge in the latest main branch', autoSubmit: true, sortOrder: 7 },
  { label: 'Add tests to the plan', content: 'Call out specific test cases in the plan, we should have an assertion for each change called for in the plan', autoSubmit: true, sortOrder: 8 },
  { label: 'Tests are failing', content: 'Tests are failing. Look at the canvas for details', autoSubmit: true, sortOrder: 9 },
  { label: 'Continue', content: 'Continue', autoSubmit: true, sortOrder: 10 },
];

describe('quick_responses-seed-defaults migration', () => {
  it('seeds 11 default global quick responses on fresh database', () => {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM quick_responses ORDER BY sort_order').all();

    expect(rows).toHaveLength(11);

    // All should be global (project_id IS NULL) with no category
    for (const row of rows) {
      expect(row.project_id).toBeNull();
      expect(row.category).toBeNull();
    }

    // Verify each record matches expected data
    for (let i = 0; i < expectedDefaults.length; i++) {
      const row = rows[i];
      const expected = expectedDefaults[i];
      expect(row.label).toBe(expected.label);
      expect(row.content).toBe(expected.content);
      expect(row.auto_submit).toBe(expected.autoSubmit ? 1 : 0);
      expect(row.sort_order).toBe(expected.sortOrder);
    }
  });

  it('does not insert when table already has records', () => {
    const db = getDatabase();
    // The seed migration already ran during initDatabase, so 11 records exist
    const countBefore = db.prepare('SELECT COUNT(*) AS cnt FROM quick_responses').get().cnt;
    expect(countBefore).toBe(11);

    // Call the migration again
    seedMigration.up(db);

    const countAfter = db.prepare('SELECT COUNT(*) AS cnt FROM quick_responses').get().cnt;
    expect(countAfter).toBe(11);
  });

  it('does not insert when only project-specific responses exist', () => {
    const db = getDatabase();
    // Clear all seeded global responses
    db.prepare('DELETE FROM quick_responses').run();

    // Create a real project (needed for FK constraint on project_id)
    const projectRepo = new ProjectRepository();
    const project = projectRepo.create('Test Project', '/tmp/test');

    // Insert a project-specific quick response
    db.prepare(
      `INSERT INTO quick_responses (id, project_id, label, content, auto_submit, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('test-id', project.id, 'Project Response', 'content', 0, 0, Date.now(), Date.now());

    // Call the migration
    seedMigration.up(db);

    // Should still only have 1 record (the project-specific one)
    const count = db.prepare('SELECT COUNT(*) AS cnt FROM quick_responses').get().cnt;
    expect(count).toBe(1);
  });

  it('seeds correctly after all records are deleted', () => {
    const db = getDatabase();
    // Clear everything
    db.prepare('DELETE FROM quick_responses').run();

    // Call the migration
    seedMigration.up(db);

    // Should now have 11 records
    const rows = db.prepare('SELECT * FROM quick_responses ORDER BY sort_order').all();
    expect(rows).toHaveLength(11);

    // Spot-check a few records
    expect(rows[0].label).toBe('Put a plan on the canvas');
    expect(rows[0].auto_submit).toBe(0);
    expect(rows[1].label).toBe('Yes');
    expect(rows[1].auto_submit).toBe(1);
    expect(rows[10].label).toBe('Continue');
  });
});

const expectedSessionTemplateNames = [
  'Review the plan',
  'Implement the plan on the canvas',
  'Create/update PR',
];

const expectedSessionTemplatePrompts = {
  'Review the plan': DEFAULT_SESSION_TEMPLATE_PROMPTS.REVIEW,
  'Implement the plan on the canvas': DEFAULT_SESSION_TEMPLATE_PROMPTS.IMPLEMENT,
  'Create/update PR': DEFAULT_SESSION_TEMPLATE_PROMPTS.PR,
};

describe('session_templates-seed-defaults migration', () => {
  it('seeds exactly 3 global session templates on a fresh DB', () => {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM session_templates WHERE project_id IS NULL')
      .all();

    expect(rows).toHaveLength(3);

    const names = rows.map(r => r.name).sort();
    expect(names).toEqual([...expectedSessionTemplateNames].sort());
  });

  it('stores each prompt verbatim (golden strings)', () => {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT name, prompt FROM session_templates WHERE project_id IS NULL')
      .all();

    for (const row of rows) {
      expect(row.prompt).toBe(expectedSessionTemplatePrompts[row.name]);
    }
  });

  it('uses the expected default column values on every seeded row', () => {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT * FROM session_templates WHERE project_id IS NULL')
      .all();

    for (const row of rows) {
      expect(row.project_id).toBeNull();
      expect(row.mode).toBe('yolo');
      expect(row.thinking_enabled).toBe(1);
      expect(row.next_template_id).toBeNull();
      expect(row.git_branch).toBeNull();
      expect(row.git_mode).toBeNull();
      expect(row.model).toBeNull();
      expect(row.effort_level).toBeNull();
      expect(row.target_lane_id).toBeNull();
    }
  });

  it('populates created_at and updated_at as numeric timestamps near now', () => {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT created_at, updated_at FROM session_templates WHERE project_id IS NULL')
      .all();
    const now = Date.now();

    for (const row of rows) {
      expect(typeof row.created_at).toBe('number');
      expect(typeof row.updated_at).toBe('number');
      expect(Math.abs(now - row.created_at)).toBeLessThan(10_000);
      expect(Math.abs(now - row.updated_at)).toBeLessThan(10_000);
    }
  });

  it('assigns non-null, distinct string IDs to each seeded row', () => {
    const db = getDatabase();
    const rows = db
      .prepare('SELECT id FROM session_templates WHERE project_id IS NULL')
      .all();

    expect(rows).toHaveLength(3);
    const ids = rows.map(r => r.id);
    for (const id of ids) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(3);
  });

  it('is idempotent when re-run on an already-seeded DB', () => {
    const db = getDatabase();
    const countBefore = db
      .prepare('SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NULL')
      .get().cnt;
    expect(countBefore).toBe(3);

    seedTemplatesMigration.up(db);

    const countAfter = db
      .prepare('SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NULL')
      .get().cnt;
    expect(countAfter).toBe(3);
  });

  it('does not seed when any global template already exists', () => {
    const db = getDatabase();
    db.prepare('DELETE FROM session_templates').run();

    // Insert a single hand-crafted global template
    const now = Date.now();
    db.prepare(
      `INSERT INTO session_templates (
         id, project_id, name, prompt,
         next_template_id, thinking_enabled,
         git_branch, git_mode, model, mode, effort_level, target_lane_id,
         created_at, updated_at
       ) VALUES (?, NULL, ?, ?, NULL, 1, NULL, NULL, NULL, 'yolo', NULL, NULL, ?, ?)`
    ).run('existing-global-id', 'Existing Global', 'existing prompt', now, now);

    seedTemplatesMigration.up(db);

    const count = db
      .prepare('SELECT COUNT(*) AS cnt FROM session_templates')
      .get().cnt;
    expect(count).toBe(1);
  });

  it('does seed when only project-scoped templates exist', () => {
    const db = getDatabase();
    db.prepare('DELETE FROM session_templates').run();

    // Create a real project (needed for FK on project_id)
    const projectRepo = new ProjectRepository();
    const project = projectRepo.create('Template Project', '/tmp/template-project');

    const now = Date.now();
    db.prepare(
      `INSERT INTO session_templates (
         id, project_id, name, prompt,
         next_template_id, thinking_enabled,
         git_branch, git_mode, model, mode, effort_level, target_lane_id,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, 1, NULL, NULL, NULL, 'yolo', NULL, NULL, ?, ?)`
    ).run('project-scoped-id', project.id, 'Project Scoped', 'project prompt', now, now);

    seedTemplatesMigration.up(db);

    const total = db.prepare('SELECT COUNT(*) AS cnt FROM session_templates').get().cnt;
    const globals = db
      .prepare('SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NULL')
      .get().cnt;
    const scoped = db
      .prepare('SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NOT NULL')
      .get().cnt;

    expect(total).toBe(4);
    expect(globals).toBe(3);
    expect(scoped).toBe(1);
  });

  it('is wired into allMigrations (fresh DB already contains the 3 defaults)', () => {
    // getDatabase() runs the full allMigrations list via initDatabase, so
    // fetching a fresh handle should yield exactly 3 global templates without
    // having to invoke seedTemplatesMigration manually.
    const db = getDatabase();
    const count = db
      .prepare('SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NULL')
      .get().cnt;
    expect(count).toBe(3);
  });

  it('writes (or provides a DB default for) every column in session_templates', () => {
    const db = getDatabase();
    // Columns explicitly written by the seed INSERT
    const explicit = new Set([
      'id', 'project_id', 'name', 'prompt',
      'next_template_id', 'thinking_enabled',
      'git_branch', 'git_mode', 'model', 'mode', 'effort_level', 'target_lane_id',
      'created_at', 'updated_at',
    ]);

    const columns = db.prepare('PRAGMA table_info(session_templates)').all();
    for (const col of columns) {
      const isExplicit = explicit.has(col.name);
      // SQLite exposes the declared DEFAULT in `dflt_value`; any non-null value
      // here means the column has a DB-level default the INSERT can rely on.
      const hasDefault = col.dflt_value !== null;
      expect(
        isExplicit || hasDefault,
        `Column "${col.name}" is not written by the seed INSERT and has no DB default; ` +
        `either update seedDefaultSessionTemplates to write it, or give it a DB default.`,
      ).toBe(true);
    }
  });
});
