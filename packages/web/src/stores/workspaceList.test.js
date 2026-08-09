import { describe, expect, it, vi } from 'vitest';
import { api } from '../composables/useApi.js';
import { useWorkspaceListStore } from './workspaceList.js';

vi.mock('../composables/useApi.js', () => ({ api: { getWorkspaceCards: vi.fn() } }));

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

describe('workspace list request lifecycle', () => {
  it('aborts and ignores a superseded request', async () => {
    const first = deferred();
    const second = deferred();
    api.getWorkspaceCards.mockImplementationOnce((_projectId, options) => {
      expect(options.signal).toBeInstanceOf(AbortSignal);
      return first.promise;
    }).mockImplementationOnce(() => second.promise);
    const store = useWorkspaceListStore();

    const firstLoad = store.load('project-a', { status: 'running' });
    const secondLoad = store.load('project-a', { status: 'idle' });
    first.resolve({ workspaces: [{ id: 'old' }], pagination: { hasMore: false, nextCursor: null } });
    second.resolve({ workspaces: [{ id: 'new' }], pagination: { hasMore: false, nextCursor: null } });
    await Promise.all([firstLoad, secondLoad]);

    expect(store.cards).toEqual([{ id: 'new' }]);
    expect(store.query).toEqual({ status: 'idle' });
  });

  it('keeps the cached page extent while revalidating', async () => {
    const store = useWorkspaceListStore();
    store._install('project-a', {}, {
      workspaces: [{ id: 'one' }, { id: 'two' }, { id: 'three' }, { id: 'four' }],
      pagination: { hasMore: true, nextCursor: 'old-next' },
    });
    api.getWorkspaceCards.mockResolvedValueOnce({
      workspaces: [{ id: 'one' }, { id: 'two' }],
      pagination: { hasMore: true, nextCursor: 'next' },
    }).mockResolvedValueOnce({
      workspaces: [{ id: 'three' }, { id: 'four' }],
      pagination: { hasMore: false, nextCursor: null },
    });

    await store.load('project-a');
    expect(store.cards).toHaveLength(4);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.cards).toHaveLength(4);
  });
});
