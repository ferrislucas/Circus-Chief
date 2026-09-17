import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { allMigrations } from './index.js';
import { kanbanMigrations } from './kanbanMigrations.js';
import { projectsMigrations } from './projectsMigrations.js';

describe('migration registration', () => {
  it('registers every declared project migration for upgraded databases', () => {
    const registeredNames = new Set(allMigrations.map(({ name }) => name));

    expect(projectsMigrations.map(({ name }) => name).every((name) => registeredNames.has(name))).toBe(true);
  });

  it('adds the pinned column when upgrading a database created before project pinning', () => {
    const db = new Database(':memory:');
    try {
      db.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf-8'));
      db.exec('ALTER TABLE projects DROP COLUMN pinned');

      for (const migration of allMigrations) migration.up(db);
      for (const migration of allMigrations) migration.up(db);

      const pinned = db.prepare("PRAGMA table_info('projects')").all()
        .find((column) => column.name === 'pinned');
      expect(pinned).toMatchObject({ notnull: 1, dflt_value: '0' });
    } finally {
      db.close();
    }
  });

  it('registers the lane-run workflow before the sessions recreation that preserves it', () => {
    const names = allMigrations.map(({ name }) => name);
    const workflowIndex = names.indexOf('kanban-add-lane-run-workflow');
    const immutableParentageIndex = names.indexOf('sessions-immutable-parent_session_id');

    expect(kanbanMigrations.some(({ name }) => name === 'kanban-add-lane-run-workflow')).toBe(true);
    expect(workflowIndex).toBeGreaterThanOrEqual(0);
    expect(workflowIndex).toBeLessThan(immutableParentageIndex);
  });

  it('registers durable delivery migrations after the lane-run workflow', () => {
    const names = allMigrations.map(({ name }) => name);
    const workflowIndex = names.indexOf('kanban-add-lane-run-workflow');
    const durableDeliveryMigrations = [
      'kanban-lane-entry-retry-schedule',
      'kanban-durable-delivery-and-api-operations',
      'kanban-delivery-health-status-index',
      'kanban-api-operation-leases-and-canonical-responses',
      'kanban-lane-run-declared-exit-lane',
      'kanban-drop-exit-lane-caller-attribution',
    ];

    for (const name of durableDeliveryMigrations) {
      expect(names).toContain(name);
      expect(names.indexOf(name)).toBeGreaterThan(workflowIndex);
    }
  });

  it('registers the pending agent input migration for upgraded databases', () => {
    const names = allMigrations.map(({ name }) => name);

    expect(names).toContain('sessions-add-pending_agent_input');
  });

  it('registers the nullable pending schedule provenance migration after pending agent input', () => {
    const names = allMigrations.map(({ name }) => name);
    const pendingAgentInputIndex = names.indexOf('sessions-add-pending_agent_input');
    const pendingInteractiveIndex = names.indexOf('sessions-add-pending_interactive');

    expect(pendingInteractiveIndex).toBeGreaterThan(pendingAgentInputIndex);
  });
});
