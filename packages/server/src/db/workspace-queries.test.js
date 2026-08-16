import { describe, expect, it, vi } from 'vitest';
import { getWorkspaceCards, getWorkspaceCardPage } from './workspace-queries.js';

describe('getWorkspaceCards', () => {
  it('guards aggregate traversal against revisiting an ancestor', () => {
    const all = vi.fn().mockReturnValue([]);
    const db = { prepare: vi.fn().mockReturnValue({ all }) };

    getWorkspaceCards(db, 'project-id');

    const [sql] = db.prepare.mock.calls[0];
    expect(sql).toContain('tree(root_id, id, project_id, path)');
    expect(sql).toContain("'/' || id || '/'");
    expect(sql).toContain("instr(tree.path, '/' || s.id || '/') = 0");
  });

  it('computes the page and status facets in one recursive aggregate statement', () => {
    const all = vi.fn().mockReturnValue([]);
    const db = { prepare: vi.fn().mockReturnValue({ all }) };

    getWorkspaceCardPage(db, 'project-id', { limit: 25 });

    expect(db.prepare).toHaveBeenCalledTimes(1);
    expect(db.prepare.mock.calls[0][0]).toContain('WITH RECURSIVE tree');
    expect(db.prepare.mock.calls[0][0]).toContain('facet_counts AS');
  });
});
