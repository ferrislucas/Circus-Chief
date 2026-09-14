import { describe, expect, it } from 'vitest';
import { adjustWorkspaceFacets } from './workspaceListReconcile.js';

const query = {};
const overlap = { archived: false, runningCount: 1, waitingCount: 1 };

describe('adjustWorkspaceFacets', () => {
  it('removes a simultaneously running and waiting workspace from both facets', () => {
    const next = adjustWorkspaceFacets(
      { running: 1, waiting: 1, idle: 0 },
      overlap,
      { ...overlap, runningCount: 0, waitingCount: 0 },
      query,
    );

    expect(next).toEqual({ running: 0, waiting: 0, idle: 1 });
  });

  it('adds a workspace to both running and waiting facets when both counts are positive', () => {
    const next = adjustWorkspaceFacets(
      { running: 0, waiting: 0, idle: 1 },
      { archived: false, runningCount: 0, waitingCount: 0 },
      overlap,
      query,
    );

    expect(next).toEqual({ running: 1, waiting: 1, idle: 0 });
  });
});
