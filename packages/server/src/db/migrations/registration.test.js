import { describe, expect, it } from 'vitest';
import { allMigrations } from './index.js';
import { kanbanMigrations } from './kanbanMigrations.js';

describe('migration registration', () => {
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
    ];

    for (const name of durableDeliveryMigrations) {
      expect(names).toContain(name);
      expect(names.indexOf(name)).toBeGreaterThan(workflowIndex);
    }
  });
});
