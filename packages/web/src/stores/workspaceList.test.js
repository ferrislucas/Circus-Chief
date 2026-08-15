import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { api } from '../composables/useApi.js';
import {
  useWorkspaceListStore,
  WORKSPACE_PAGE_SIZE,
} from './workspaceList.js';

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

  it('reloads an atomic prefix when loading more', async () => {
    const secondPageTotal = WORKSPACE_PAGE_SIZE + 2;
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const expandedPrefix = Array.from({ length: secondPageTotal }, (_, index) => ({ id: `card-${index}` }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: secondPageTotal, hasMore: true }))
      .mockResolvedValueOnce(response(expandedPrefix, { total: secondPageTotal }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();

    expect(api.getWorkspaceCards.mock.calls[1][1]).toMatchObject({
      offset: 0,
      limit: WORKSPACE_PAGE_SIZE * 2,
    });
    expect(store.cards).toHaveLength(secondPageTotal);
    expect(new Set(store.orderedIds).size).toBe(secondPageTotal);
  });

  it('refreshes the currently loaded extent instead of collapsing to page one', async () => {
    const expandedTotal = WORKSPACE_PAGE_SIZE * 2 - 5;
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const expandedPrefix = Array.from({ length: expandedTotal }, (_, index) => ({ id: `card-${index}` }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: expandedTotal, hasMore: true }))
      .mockResolvedValueOnce(response(expandedPrefix, { total: expandedTotal }))
      .mockResolvedValueOnce(response(expandedPrefix, { total: expandedTotal }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();
    await store.refresh();

    expect(api.getWorkspaceCards.mock.calls.slice(1).map(([, options]) => ({
      limit: options.limit,
      offset: options.offset,
    }))).toEqual([
      { limit: WORKSPACE_PAGE_SIZE * 2, offset: 0 },
      { limit: expandedTotal, offset: 0 },
    ]);
    expect(store.cards).toHaveLength(expandedTotal);
  });

  it('cannot omit a card when the ordering changes before loading more', async () => {
    const prefixLength = WORKSPACE_PAGE_SIZE * 2 - 5;
    const total = prefixLength + 1;
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const reorderedPrefix = [
      { id: 'moved-card' },
      ...Array.from({ length: prefixLength }, (_, index) => ({ id: `card-${index}` })),
    ];
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total, hasMore: true }))
      .mockResolvedValueOnce(response(reorderedPrefix, { total }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();

    expect(store.cards).toHaveLength(total);
    expect(new Set(store.orderedIds).size).toBe(total);
    expect(store.orderedIds).toContain(`card-${WORKSPACE_PAGE_SIZE - 1}`);
  });

  it('optimistically reorders stars and removes cards that no longer match a filter', async () => {
    const store = useWorkspaceListStore();
    store._resetContext('project-a', {});
    store._replace(response([
      { id: 'unstarred', starred: false },
      { id: 'starred', starred: true },
    ], { total: 2 }));

    const snapshot = store.applyOptimisticStar('unstarred', true);
    expect(store.orderedIds).toEqual(['unstarred', 'starred']);
    store.restoreOptimisticStar(snapshot);
    expect(store.orderedIds).toEqual(['unstarred', 'starred']);
    expect(store.cardsById.unstarred.starred).toBe(false);

    store._resetContext('project-a', { starred: true });
    store._replace(response([{ id: 'starred', starred: true }], { total: 1 }));
    const filteredSnapshot = store.applyOptimisticStar('starred', false);
    expect(store.cards).toEqual([]);
    store.restoreOptimisticStar(filteredSnapshot);
    expect(store.cards).toEqual([{ id: 'starred', starred: true }]);
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

  it('continues loading past 500 workspaces when more results are available', async () => {
    const initialPrefix = Array.from({ length: 500 }, (_, index) => ({ id: `card-${index}` }));
    const expandedPrefix = Array.from({ length: 525 }, (_, index) => ({ id: `card-${index}` }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(initialPrefix, { total: 600, hasMore: true }))
      .mockResolvedValueOnce(response(expandedPrefix, { total: 600, hasMore: true }));
    const store = useWorkspaceListStore();
    store._resetContext('project-a', {});
    store.requestedExtent = 500;

    await store.refresh();

    expect(store.hasMore).toBe(true);
    await store.loadMore();
    expect(api.getWorkspaceCards).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      limit: 525,
      offset: 0,
    }));
    expect(store.cards).toHaveLength(525);
    expect(store.hasMore).toBe(true);
  });
});
