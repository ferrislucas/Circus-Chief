import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { api } from '../composables/useApi.js';
import {
  useWorkspaceListStore,
  WORKSPACE_PAGE_SIZE,
} from './workspaceList.js';

vi.mock('../composables/useApi.js', () => ({ api: { getWorkspaceCards: vi.fn(), getWorkspaceCard: vi.fn() } }));

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

    expect(api.getWorkspaceCards.mock.calls[1][1].offset).toBeUndefined();
    expect(store.cards.map(card => card.id)).toEqual(['idle']);
    expect(store.nextCursor).toBeNull();
  });

  it('restores a warm query snapshot before refreshing its loaded extent', async () => {
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const secondPage = [{ id: 'card-25' }];
    const returningRefresh = deferred();
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: 26, hasMore: true }))
      .mockResolvedValueOnce(response([...firstPage, ...secondPage], { total: 26 }))
      .mockResolvedValueOnce(response([{ id: 'archived' }], { total: 1 }))
      .mockImplementationOnce(() => returningRefresh.promise);
    const store = useWorkspaceListStore();

    await store.load('project-a', { archived: false });
    await store.loadMore();
    await store.load('project-a', { archived: true });
    const returningLoad = store.load('project-a', { archived: false });

    expect(store.cards).toHaveLength(26);
    expect(store.loading).toBe(false);
    returningRefresh.resolve(response([...firstPage, ...secondPage], { total: 26 }));
    await returningLoad;
    expect(store.cards).toHaveLength(26);
  });

  it('rebuilds from the first page when loading more', async () => {
    const secondPageTotal = WORKSPACE_PAGE_SIZE + 2;
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const secondPage = Array.from({ length: 2 }, (_, index) => ({ id: `card-${index + WORKSPACE_PAGE_SIZE}` }));
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: secondPageTotal, hasMore: true, nextCursor: 'page-2' }))
      .mockResolvedValueOnce(response([...firstPage, ...secondPage], { total: secondPageTotal }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();

    expect(api.getWorkspaceCards.mock.calls[1][1]).toMatchObject({
      cursor: null,
      limit: WORKSPACE_PAGE_SIZE * 2,
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
      .mockResolvedValueOnce(response(firstPage, { total: expandedTotal, hasMore: true, nextCursor: 'page-2' }))
      .mockResolvedValueOnce(response(fullExtent, { total: expandedTotal }))
      .mockResolvedValueOnce(response(fullExtent, { total: expandedTotal }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();
    await store.refresh();

    expect(api.getWorkspaceCards.mock.calls.slice(1).map(([, options]) => ({
      limit: options.limit,
      cursor: options.cursor,
    }))).toEqual([
      { limit: WORKSPACE_PAGE_SIZE * 2, cursor: null },
      { limit: expandedTotal, cursor: null },
    ]);
    expect(store.cards).toHaveLength(expandedTotal);
  });

  it('removes a loaded card that no longer matches the query during refresh', async () => {
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const secondPage = [{ id: 'stale-running-card' }];
    const refreshed = [...firstPage, { id: 'replacement-running-card' }];
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: 26, hasMore: true, nextCursor: 'page-2' }))
      .mockResolvedValueOnce(response([...firstPage, ...secondPage], { total: 26 }))
      .mockResolvedValueOnce(response(refreshed, { total: 26 }));
    const store = useWorkspaceListStore();

    await store.load('project-a', { status: 'running' });
    await store.loadMore();
    await store.refresh();

    expect(store.orderedIds).not.toContain('stale-running-card');
    expect(store.orderedIds).toContain('replacement-running-card');
    expect(store.cardsById['stale-running-card']).toBeUndefined();
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

  it('has no duplicate or gap when a card is promoted before loading more', async () => {
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const secondPage = Array.from(
      { length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index + WORKSPACE_PAGE_SIZE}` }),
    );
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total: 50, hasMore: true, nextCursor: 'cursor-1' }))
      .mockResolvedValueOnce(response([...firstPage, ...secondPage], { total: 50 }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();

    expect(api.getWorkspaceCards).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      cursor: null, limit: WORKSPACE_PAGE_SIZE * 2,
    }));
    expect(new Set(store.orderedIds)).toEqual(new Set([...firstPage, ...secondPage].map(card => card.id)));
    expect(store.orderedIds).toHaveLength(50);
  });

  it('replaces the loaded window when ordering changes before loading more', async () => {
    const total = WORKSPACE_PAGE_SIZE + 1;
    const firstPage = Array.from({ length: WORKSPACE_PAGE_SIZE }, (_, index) => ({ id: `card-${index}` }));
    const rebuilt = [...firstPage.slice(0, -1), { id: `card-${WORKSPACE_PAGE_SIZE - 1}` }, { id: 'next-card' }];
    api.getWorkspaceCards
      .mockResolvedValueOnce(response(firstPage, { total, hasMore: true }))
      .mockResolvedValueOnce(response(rebuilt, { total }));
    const store = useWorkspaceListStore();

    await store.load('project-a');
    await store.loadMore();

    expect(store.cards).toHaveLength(total);
    expect(new Set(store.orderedIds).size).toBe(total);
    expect(store.orderedIds).toContain('next-card');
  });

  it('preserves existing counts when an appended page becomes empty', async () => {
    const store = useWorkspaceListStore();
    store._resetContext('project-a', {});
    store._replace(response([{ id: 'card' }], { total: 4, facets: { running: 1, idle: 3 }, hasMore: true }));
    store._append(response([], { total: 0, facets: { running: 0, idle: 0 } }));

    expect(store.facets).toEqual({ running: 1, idle: 3 });
    expect(store.total).toBe(4);
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

  it.skip('continues loading past 500 workspaces when more results are available', async () => {
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

describe('workspace list realtime patching', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  async function loadedStore() {
    api.getWorkspaceCards.mockResolvedValue(response([
      { id: 'root-1', memberIds: ['root-1', 'child-1'], latestCommandRuns: [] },
    ]));
    const store = useWorkspaceListStore();
    await store.load('project-a', {});
    return store;
  }

  it('resolves a member session id to its owning card', async () => {
    const store = await loadedStore();
    expect(store.cardForSession('child-1')?.id).toBe('root-1');
    expect(store.cardForSession('unknown')).toBeNull();
  });

  it('patches a command-run event into the owning card without a request', async () => {
    const store = await loadedStore();
    api.getWorkspaceCards.mockClear();
    const patched = store.applyCommandRunEvent({
      sessionId: 'child-1', buttonId: 'build', runId: 'run-1', status: 'running', startedAt: 5,
    });
    expect(patched).toBe('root-1');
    const card = store.cardsById['root-1'];
    expect(card.latestCommandRuns).toEqual([{
      buttonId: 'build', status: 'running', exitCode: null, runId: 'run-1', startedAt: 5,
    }]);
    expect(api.getWorkspaceCards).not.toHaveBeenCalled();
  });

  it('replaces the previous run for the same button with server precedence', async () => {
    const store = await loadedStore();
    // finished run displaced by a newer finished run (recency)
    store.applyCommandRunEvent({
      sessionId: 'root-1', buttonId: 'build', runId: 'run-1', status: 'completed', exitCode: 1, startedAt: 1, completedAt: 2,
    });
    store.applyCommandRunEvent({
      sessionId: 'root-1', buttonId: 'build', runId: 'run-2', status: 'completed', exitCode: 0, startedAt: 6, completedAt: 9,
    });
    let card = store.cardsById['root-1'];
    expect(card.latestCommandRuns).toHaveLength(1);
    expect(card.latestCommandRuns[0]).toMatchObject({ runId: 'run-2', status: 'completed', exitCode: 0 });

    // a running run displaces any finished one regardless of recency
    store.applyCommandRunEvent({
      sessionId: 'root-1', buttonId: 'build', runId: 'run-3', status: 'running', startedAt: 10,
    });
    card = store.cardsById['root-1'];
    expect(card.latestCommandRuns).toHaveLength(1);
    expect(card.latestCommandRuns[0]).toMatchObject({ runId: 'run-3', status: 'running' });
  });

  it('advances a run through its own lifecycle via runId replacement', async () => {
    const store = await loadedStore();
    // The real wire sequence for one run: started → complete with the same runId.
    store.applyCommandRunEvent({
      sessionId: 'root-1', buttonId: 'build', runId: 'run-9', status: 'running', startedAt: 5,
    });
    store.applyCommandRunEvent({
      sessionId: 'root-1', buttonId: 'build', runId: 'run-9', status: 'completed', exitCode: 0, startedAt: 5, completedAt: 9,
    });
    const card = store.cardsById['root-1'];
    expect(card.latestCommandRuns).toHaveLength(1);
    expect(card.latestCommandRuns[0]).toMatchObject({ runId: 'run-9', status: 'completed', exitCode: 0 });
  });

  it('keeps a running run over an unrelated finished event for the same button', async () => {
    const store = await loadedStore();
    store.applyCommandRunEvent({
      sessionId: 'root-1', buttonId: 'build', runId: 'run-1', status: 'running', startedAt: 5,
    });
    // A completed event for a different, older run must not displace the live
    // one — mirrors buildRunsBySession, where a live process beats a DB row.
    store.applyCommandRunEvent({
      sessionId: 'root-1', buttonId: 'build', runId: 'run-0', status: 'completed', exitCode: 0, startedAt: 1, completedAt: 2,
    });
    const card = store.cardsById['root-1'];
    expect(card.latestCommandRuns).toHaveLength(1);
    expect(card.latestCommandRuns[0]).toMatchObject({ runId: 'run-1', status: 'running' });
  });

  it('returns null for an unknown session so the caller can fall back to a refresh', async () => {
    const store = await loadedStore();
    expect(store.applyCommandRunEvent({ sessionId: 'unknown', buttonId: 'build', runId: 'r', status: 'running' }))
      .toBeNull();
    expect(store.applySummaryEvent('unknown', {})).toBeNull();
  });

  it('does not replace root summary fields from a child summary event', async () => {
    const store = await loadedStore();
    store.patchCard('root-1', { summaryPreview: 'Root summary', prState: 'merged' });
    const patched = store.applySummaryEvent('child-1', {
      shortSummary: 'Did things', prState: 'open', ciStatus: 'passing', hasMergeConflicts: false,
    });
    expect(patched).toBe('root-1');
    const card = store.cardsById['root-1'];
    expect(card.summaryPreview).toBe('Root summary');
    expect(card.prState).toBe('merged');
    expect(card.ciStatus).toBeUndefined();
  });

  it('patches root summary fields from a root summary event', async () => {
    const store = await loadedStore();
    store.applySummaryEvent('root-1', { shortSummary: 'Root result', prState: 'open' });
    expect(store.cardsById['root-1']).toMatchObject({ summaryPreview: 'Root result', prState: 'open' });
  });

  it('authoritatively reconciles one card without refetching the loaded window', async () => {
    const store = await loadedStore();
    api.getWorkspaceCards.mockClear();
    api.getWorkspaceCard.mockResolvedValue({
      ...store.cardsById['root-1'], runningCount: 1, lastActivityAt: 20, updatedAt: 10, createdAt: 1,
    });
    await store.refreshCard('child-1');
    expect(api.getWorkspaceCard).toHaveBeenCalledWith('root-1');
    expect(api.getWorkspaceCards).not.toHaveBeenCalled();
    expect(store.facets).toEqual({ running: 1, idle: 0 });
  });

});

describe.skip('workspace list mutation epoch', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('runs one trailing refresh when a mutation lands during an in-flight refresh', async () => {
    const pending = deferred();
    api.getWorkspaceCards
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response([{ id: 'fresh' }]));
    const store = useWorkspaceListStore();
    store._resetContext('project-a', {});

    const first = store.refresh();
    store.markMutation(); // star committed while the first request was in flight
    pending.resolve(response([{ id: 'stale' }]));
    await first;

    // The trailing read is scheduled as a microtask after the first completes.
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(api.getWorkspaceCards).toHaveBeenCalledTimes(2);
    expect(store.cards).toEqual([{ id: 'fresh' }]);
  });

  it('does not schedule a trailing refresh when no mutation raced the request', async () => {
    api.getWorkspaceCards.mockResolvedValue(response([{ id: 'card' }]));
    const store = useWorkspaceListStore();
    store._resetContext('project-a', {});

    await store.refresh();
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(api.getWorkspaceCards).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a trailing refresh after the context changed', async () => {
    const pending = deferred();
    api.getWorkspaceCards
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(response([{ id: 'next' }]));
    const store = useWorkspaceListStore();
    store._resetContext('project-a', {});

    const first = store.refresh();
    store.markMutation();
    store._resetContext('project-b', {}); // filter change supersedes the trailing read
    pending.resolve(response([{ id: 'stale' }]));
    await first;
    await new Promise(resolve => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(api.getWorkspaceCards).toHaveBeenCalledTimes(1);
  });
});
