import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { api } from '../composables/useApi.js';
import { useWorkspaceListStore, WORKSPACE_PAGE_SIZE } from './workspaceList.js';

vi.mock('../composables/useApi.js', () => ({ api: { getWorkspaceCards: vi.fn() } }));

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

function response(workspaces, options = {}) {
  const total = options.total ?? workspaces.length;
  return {
    workspaces,
    facets: options.facets || { running: 0, idle: total },
    pagination: {
      total,
      offset: options.offset || 0,
      hasMore: options.hasMore ?? false,
    },
  };
}

describe('workspace list request lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('aborts and ignores a stale response after a rapid filter change', async () => {
    const first = deferred();
    const second = deferred();
    let firstSignal;
    api.getWorkspaceCards
      .mockImplementationOnce((_projectId, options) => {
        firstSignal = options.signal;
        return first.promise;
      })
      .mockImplementationOnce(() => second.promise);
    const store = useWorkspaceListStore();

    const firstLoad = store.load('project-a', { status: 'running' });
    const secondLoad = store.load('project-a', { status: 'idle' });
    expect(firstSignal.aborted).toBe(true);

    second.resolve(response([{ id: 'new' }], { facets: { running: 2, idle: 1 } }));
    first.resolve(response([{ id: 'stale' }]));
    await Promise.all([firstLoad, secondLoad]);

    expect(store.cards).toEqual([{ id: 'new' }]);
    expect(store.query).toEqual({ status: 'idle' });
    expect(store.facets).toEqual({ running: 2, idle: 1 });
  });

  it('protects project B from a stale project A response', async () => {
    const projectA = deferred();
    api.getWorkspaceCards
      .mockImplementationOnce(() => projectA.promise)
      .mockResolvedValueOnce(response(
        [{ id: 'b-card', projectId: 'project-b' }],
        { facets: { running: 4, idle: 6 } },
      ));
    const store = useWorkspaceListStore();

    const loadA = store.load('project-a');
    await store.load('project-b');
    projectA.resolve(response([{ id: 'a-card', projectId: 'project-a' }]));
    await loadA;

    expect(store.projectId).toBe('project-b');
    expect(store.cards.map(card => card.id)).toEqual(['b-card']);
    expect(store.facets).toEqual({ running: 4, idle: 6 });
  });

  it('resets pagination when query context changes', async () => {
    const runningPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `running-${index}` }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(runningPage, { total: 80, hasMore: true }))
      .mockResolvedValueOnce(response([{ id: 'idle' }], { total: 1 }));
    const store = useWorkspaceListStore();

    await store.load('project-a', { status: 'running' });
    expect(store.hasMore).toBe(true);
    await store.load('project-a', { status: 'idle' });

    expect(api.getWorkspaceCards.mock.calls[1][1].offset).toBe(0);
    expect(store.cards.map(card => card.id)).toEqual(['idle']);
    expect(store.nextOffset).toBe(1);
  });

  it('traverses unchanged offset pages without rendering duplicate cards', async () => {
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: 52, hasMore: true }))
      .mockResolvedValueOnce(response([
        { id: 'card-49' },
        { id: 'card-50' },
        { id: 'card-51' },
      ], { total: 52 }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();

    expect(api.getWorkspaceCards.mock.calls[1][1].offset).toBe(WORKSPACE_PAGE_SIZE);
    expect(store.cards).toHaveLength(52);
    expect(new Set(store.orderedIds).size).toBe(52);
  });

  it('refreshes the currently loaded extent instead of collapsing to page one', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({ id: `card-${index}` }));
    const secondPage = Array.from({ length: 25 }, (_, index) => ({ id: `card-${index + 50}` }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: 75, hasMore: true }))
      .mockResolvedValueOnce(response(secondPage, { total: 75 }))
      .mockResolvedValueOnce(response(firstPage, { total: 75, hasMore: true }))
      .mockResolvedValueOnce(response(secondPage, { total: 75 }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();
    await store.refresh();

    expect(api.getWorkspaceCards.mock.calls.slice(2).map(([, options]) => ({
      limit: options.limit,
      offset: options.offset,
    }))).toEqual([
      { limit: 50, offset: 0 },
      { limit: 25, offset: 50 },
    ]);
    expect(store.cards).toHaveLength(75);
  });

  it('deduplicates concurrent refresh calls for the same context', async () => {
    const pending = deferred();
    api.getWorkspaceCards.mockReturnValueOnce(pending.promise);
    const store = useWorkspaceListStore();
    store._resetContext('project-a', {});

    const first = store.refresh();
    const second = store.refresh();
    pending.resolve(response([{ id: 'card' }]));
    await Promise.all([first, second]);

    expect(api.getWorkspaceCards).toHaveBeenCalledTimes(1);
  });
});
