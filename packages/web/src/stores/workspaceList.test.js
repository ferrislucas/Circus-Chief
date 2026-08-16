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
  let reject;
  const promise = new Promise((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function response(workspaces, options = {}) {
  const total = options.total ?? workspaces.length;
  return {
    workspaces,
    facets: options.facets || { running: 0, idle: total },
    pagination: {
      total,
      offset: options.offset || 0,
      nextCursor: options.nextCursor || null,
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

  it('fetches only the next offset page when loading more', async () => {
    const secondPageTotal = WORKSPACE_PAGE_SIZE + 2;
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const secondPage = Array.from({ length: 2 }, (_, index) => ({ id: `card-${index + WORKSPACE_PAGE_SIZE}` }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: secondPageTotal, hasMore: true }))
      .mockResolvedValueOnce(response(secondPage, { total: secondPageTotal, offset: WORKSPACE_PAGE_SIZE }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();

    expect(api.getWorkspaceCards.mock.calls[1][1]).toMatchObject({
      offset: WORKSPACE_PAGE_SIZE,
      limit: WORKSPACE_PAGE_SIZE,
    });
    expect(store.cards).toHaveLength(secondPageTotal);
    expect(new Set(store.orderedIds).size).toBe(secondPageTotal);
  });

  it('ignores a stale load-more failure after a context change', async () => {
    const nextPage = deferred();
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: WORKSPACE_PAGE_SIZE + 1, hasMore: true }))
      .mockImplementationOnce(() => nextPage.promise)
      .mockResolvedValueOnce(response([{ id: 'idle-card' }]));
    const store = useWorkspaceListStore();

    await store.load('project-a', { status: 'running' });
    const loadMore = store.loadMore();
    await store.load('project-a', { status: 'idle' });
    nextPage.reject(new Error('Stale pagination failure'));
    await expect(loadMore).resolves.toBeUndefined();

    expect(store.query).toEqual({ status: 'idle' });
    expect(store.cards).toEqual([{ id: 'idle-card' }]);
    expect(store.error).toBeNull();
  });

  it('refreshes the entire loaded extent after loading more, not just the first page', async () => {
    // Regression test for a bug where refresh() (called by realtime
    // invalidation on every relevant WebSocket event) always re-fetched only
    // WORKSPACE_PAGE_SIZE rows at offset 0, silently truncating a list the
    // user had scrolled past page 1 back down to page 1 on every event.
    const expandedTotal = WORKSPACE_PAGE_SIZE * 2 - 5;
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const secondPage = Array.from({ length: expandedTotal - WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index + WORKSPACE_PAGE_SIZE}` }));
    const fullExtent = [...firstPage, ...secondPage];
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: expandedTotal, hasMore: true }))
      .mockResolvedValueOnce(response(secondPage, { total: expandedTotal, offset: WORKSPACE_PAGE_SIZE }))
      .mockResolvedValueOnce(response(fullExtent, { total: expandedTotal }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();
    await store.refresh();

    expect(api.getWorkspaceCards.mock.calls.slice(1).map(([, options]) => ({
      limit: options.limit,
      offset: options.offset,
    }))).toEqual([
      { limit: WORKSPACE_PAGE_SIZE, offset: WORKSPACE_PAGE_SIZE },
      { limit: expandedTotal, offset: 0 },
    ]);
    expect(store.cards).toHaveLength(expandedTotal);
  });

  it('refreshes every loaded card past the server cap without truncating the list', async () => {
    const store = useWorkspaceListStore();
    store._resetContext('project-a', {});
    store.orderedIds = Array.from({ length: 600 }, (_, index) => `card-${index}`);
    store.cardsById = Object.fromEntries(store.orderedIds.map(id => [id, { id }]));

    const cards = store.orderedIds.map(id => ({ id }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(cards.slice(0, 500), {
        total: 600, hasMore: true, nextCursor: 'cursor-500',
      }))
      .mockResolvedValueOnce(response(cards.slice(500), { total: 600 }));

    await store.refresh();

    expect(api.getWorkspaceCards).toHaveBeenNthCalledWith(1, 'project-a', expect.objectContaining({
      limit: 500,
      cursor: null,
    }));
    expect(api.getWorkspaceCards).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      limit: 100, cursor: 'cursor-500',
    }));
    expect(store.orderedIds).toEqual(cards.map(card => card.id));
    expect(store.hasMore).toBe(false);
  });

  it('has no duplicate or gap when a card is promoted between cursor pages', async () => {
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const secondPage = Array.from(
      { length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index + WORKSPACE_PAGE_SIZE}` }),
    );
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: 50, hasMore: true, nextCursor: 'cursor-1' }))
      .mockResolvedValueOnce(response(secondPage, { total: 50, nextCursor: 'cursor-2' }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();

    expect(api.getWorkspaceCards).toHaveBeenLastCalledWith('project-a', expect.objectContaining({ cursor: 'cursor-1' }));
    expect(new Set(store.orderedIds)).toEqual(new Set([...firstPage, ...secondPage].map(card => card.id)));
    expect(store.orderedIds).toHaveLength(50);
  });

  it('deduplicates a card that moves into the next offset page', async () => {
    const total = WORKSPACE_PAGE_SIZE + 1;
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const secondPage = [{ id: `card-${WORKSPACE_PAGE_SIZE - 1}` }, { id: 'next-card' }];
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total, hasMore: true }))
      .mockResolvedValueOnce(response(secondPage, { total, offset: WORKSPACE_PAGE_SIZE }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();

    expect(store.cards).toHaveLength(total);
    expect(new Set(store.orderedIds).size).toBe(total);
    expect(store.orderedIds).toContain('next-card');
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
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const nextPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index + 500}` }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: 600, hasMore: true }))
      .mockResolvedValueOnce(response(nextPage, { total: 600, offset: 500, hasMore: true }));
    const store = useWorkspaceListStore();
    store._resetContext('project-a', {});
    store.nextOffset = 0;

    await store.refresh();

    expect(store.hasMore).toBe(true);
    store.nextOffset = 500;
    await store.loadMore();
    expect(api.getWorkspaceCards).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      limit: WORKSPACE_PAGE_SIZE,
      offset: 500,
    }));
    expect(store.cards).toHaveLength(WORKSPACE_PAGE_SIZE * 2);
    expect(store.hasMore).toBe(true);
  });
});
