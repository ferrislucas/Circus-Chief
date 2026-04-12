import { describe, it, expect } from 'vitest';
import { miscMigrations } from './miscMigrations.js';
import { getDatabase, ProjectRepository } from '../index.js';

const seedMigration = miscMigrations.find(m => m.name === 'quick_responses-seed-defaults');

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
