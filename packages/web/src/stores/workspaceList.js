import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { commandRunPatch, summaryPatch } from './workspaceListEvents.js';
import { queryKey, isAbort } from './workspaceListQuery.js';
import { refreshWorkspaceCard } from './workspaceListCardRefresh.js';

export const WORKSPACE_PAGE_SIZE = 25;
export const WORKSPACE_PICKER_MAX_RESULTS = 1_000;
const WORKSPACE_API_MAX_PAGE_SIZE = 500;
const requestLifecycles = new WeakMap();
function lifecycleFor(store) {
  if (!requestLifecycles.has(store)) {
    requestLifecycles.set(store, {
      version: 0,
      contextKey: null,
      refreshController: null,
      refreshPromise: null,
      loadMoreController: null,
      snapshots: new Map(),
    });
  }
  return requestLifecycles.get(store);
}
const fetchPage = (projectId, query, { cursor = null, limit, signal }) => api.getWorkspaceCards(projectId, {
  ...query,
  limit,
  cursor,
  signal,
});
async function fetchExtent(projectId, query, extent, signal) {
  const workspaces = [];
  let cursor = null;
  let latest;
  do {
    const limit = Math.min(WORKSPACE_API_MAX_PAGE_SIZE, extent - workspaces.length);
    latest = await fetchPage(projectId, query, { cursor, limit, signal });
    workspaces.push(...(latest.workspaces || []));
    cursor = latest.pagination?.nextCursor || null;
  } while (workspaces.length < extent && latest.pagination?.hasMore && cursor);
  return {
    ...latest,
    workspaces,
    pagination: {
      ...latest.pagination,
      hasMore: Boolean(latest.pagination?.hasMore),
      nextCursor: latest.pagination?.nextCursor || null,
    },
  };
}
function canCommitRequest(lifecycle, request) {
  return !request.controller.signal.aborted
    && lifecycle.version === request.version
    && lifecycle.contextKey === request.contextKey;
}

export const useWorkspaceListStore = defineStore('workspaceList', {
  state: () => ({
    projectId: null,
    query: {},
    cardsById: {},
    orderedIds: [],
    facets: { running: 0, idle: 0 },
    total: 0,
    nextCursor: null,
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
  }),
  getters: {
    cards: state => state.orderedIds.map(id => state.cardsById[id]).filter(Boolean),
    hasActiveFilters: state => state.query.archived === true
      || ['starred', 'status', 'scheduled']
        .some(key => state.query[key] !== undefined
          && state.query[key] !== null
          && state.query[key] !== ''),
  },

  actions: {
    _replace(result) {
      const cards = result.workspaces || [];
      this.cardsById = Object.fromEntries(cards.map(card => [card.id, card]));
      this.orderedIds = cards.map(card => card.id);
      this.facets = result.facets || { running: 0, idle: 0 };
      this.total = result.pagination?.total || 0;
      this.nextCursor = result.pagination?.nextCursor || null;
      this.hasMore = Boolean(result.pagination?.hasMore);
    },

    _append(result) {
      const cards = result.workspaces || [];
      const existingIds = new Set(this.orderedIds);
      this.cardsById = {
        ...this.cardsById,
        ...Object.fromEntries(cards.map(card => [card.id, card])),
      };
      this.orderedIds = [
        ...this.orderedIds,
        ...cards.filter(card => !existingIds.has(card.id)).map(card => card.id),
      ];
      if (result.workspaces?.length > 0) {
        this.facets = result.facets || { running: 0, idle: 0 };
        this.total = result.pagination?.total || 0;
      }
      this.nextCursor = result.pagination?.nextCursor || null;
      this.hasMore = Boolean(result.pagination?.hasMore);
    },

    _resetContext(projectId, query) {
      const lifecycle = lifecycleFor(this);
      if (lifecycle.contextKey) {
        lifecycle.snapshots.set(lifecycle.contextKey, {
          cardsById: this.cardsById, orderedIds: this.orderedIds, facets: this.facets,
          total: this.total, nextCursor: this.nextCursor, hasMore: this.hasMore,
        });
      }
      lifecycle.refreshController?.abort();
      lifecycle.loadMoreController?.abort();
      lifecycle.version += 1;
      lifecycle.contextKey = queryKey(projectId, query);
      lifecycle.refreshController = null;
      lifecycle.refreshPromise = null;
      lifecycle.loadMoreController = null;

      const snapshot = lifecycle.snapshots.get(lifecycle.contextKey);
      this.projectId = projectId;
      this.query = { ...query };
      Object.assign(this, snapshot || {
        cardsById: {}, orderedIds: [], facets: { running: 0, idle: 0 }, total: 0,
        nextCursor: null, hasMore: false,
      });
      this.loadingMore = false;
      this.error = null;
    },

    async load(projectId, query = {}) {
      const nextKey = queryKey(projectId, query);
      const lifecycle = lifecycleFor(this);
      if (lifecycle.contextKey !== nextKey) this._resetContext(projectId, query);
      return this.refresh();
    },

    async refresh() {
      if (!this.projectId) return;
      const lifecycle = lifecycleFor(this);
      if (lifecycle.refreshPromise) return lifecycle.refreshPromise;

      lifecycle.loadMoreController?.abort();
      lifecycle.loadMoreController = null;
      this.loadingMore = false;
      const controller = new AbortController();
      lifecycle.refreshController = controller;
      const version = lifecycle.version;
      const contextKey = lifecycle.contextKey;
      const projectId = this.projectId;
      const query = { ...this.query };
      this.loading = this.orderedIds.length === 0;
      this.error = null;

      // Restart pagination from the top and rebuild the loaded window. Sort keys
      // and filter membership are mutable, so preserving old cards or continuing
      // from an old cursor can leave duplicates, gaps, and stale filtered cards.
      const loadedExtent = Math.max(WORKSPACE_PAGE_SIZE, this.orderedIds.length);
      const promise = fetchExtent(projectId, query, loadedExtent, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted
            && lifecycle.version === version
            && lifecycle.contextKey === contextKey) {
            this._replace(result);
          }
        })
        .catch((error) => {
          if (!isAbort(error)
            && lifecycle.version === version
            && lifecycle.contextKey === contextKey) {
            this.error = error.message || 'Failed to load workspaces';
            throw error;
          }
        })
        .finally(() => {
          if (lifecycle.refreshPromise === promise) lifecycle.refreshPromise = null;
          if (lifecycle.refreshController === controller) lifecycle.refreshController = null;
          if (lifecycle.version === version) this.loading = false;
        });
      lifecycle.refreshPromise = promise;
      return promise;
    },

    isRefreshInFlight() {
      return Boolean(lifecycleFor(this).refreshPromise);
    },

    async loadMore() {
      const lifecycle = lifecycleFor(this);
      if (!this.projectId || !this.hasMore || this.loadingMore || lifecycle.refreshPromise) return;

      const projectId = this.projectId;
      const query = { ...this.query };
      const contextKey = lifecycle.contextKey;
      const version = lifecycle.version;
      const controller = new AbortController();
      const request = { controller, version, contextKey };
      lifecycle.loadMoreController = controller;
      this.loadingMore = true;
      try {
        // Rebuild from the head through one additional page. The previous
        // nextCursor may describe an ordering that changed since it was issued.
        const extent = this.orderedIds.length + WORKSPACE_PAGE_SIZE;
        const result = await fetchExtent(projectId, query, extent, controller.signal);
        if (canCommitRequest(lifecycle, request)) this._replace(result);
      } catch (error) {
        if (!isAbort(error) && canCommitRequest(lifecycle, request)) {
          this.error = error.message || 'Failed to load more workspaces';
          throw error;
        }
      } finally {
        if (lifecycle.loadMoreController === controller) {
          lifecycle.loadMoreController = null;
          this.loadingMore = false;
        }
      }
    },

    patchCard(cardId, patch) {
      if (!this.cardsById[cardId]) return;
      this.cardsById[cardId] = { ...this.cardsById[cardId], ...patch };
    },

    cardForSession(sessionId) {
      for (const card of Object.values(this.cardsById)) {
        if (card.memberIds?.includes(sessionId)) return card;
      }
      return null;
    },

    applyCommandRunEvent(event) {
      return this._applyPatch(commandRunPatch(this.cardsById, event));
    },

    applySummaryEvent(sessionId, summary) {
      return this._applyPatch(summaryPatch(this.cardsById, sessionId, summary));
    },

    refreshCard: refreshWorkspaceCard,

    _applyPatch(next) {
      if (!next?.cardId) return null;
      this.patchCard(next.cardId, next.patch);
      return next.cardId;
    },

    applyOptimisticStar(cardId, starred) {
      const card = this.cardsById[cardId];
      if (!card) return null;
      const snapshot = {
        card,
        index: this.orderedIds.indexOf(cardId),
        total: this.total,
      };
      const filter = this.query.starred;
      if (typeof filter === 'boolean' && filter !== starred) {
        this.removeCard(cardId);
        return snapshot;
      }
      this.patchCard(cardId, { starred });
      this.orderedIds = [...this.orderedIds].sort((leftId, rightId) => {
        const left = Boolean(this.cardsById[leftId]?.starred);
        const right = Boolean(this.cardsById[rightId]?.starred);
        return Number(right) - Number(left);
      });
      return snapshot;
    },

    restoreOptimisticStar(snapshot) {
      if (!snapshot?.card) return;
      this.cardsById = { ...this.cardsById, [snapshot.card.id]: snapshot.card };
      const ids = this.orderedIds.filter(id => id !== snapshot.card.id);
      ids.splice(Math.max(0, snapshot.index), 0, snapshot.card.id);
      this.orderedIds = ids;
      this.total = snapshot.total;
      this.hasMore = ids.length < this.total;
    },

    removeCard(cardId) {
      if (!this.cardsById[cardId]) return;
      const next = { ...this.cardsById };
      delete next[cardId];
      this.cardsById = next;
      this.orderedIds = this.orderedIds.filter(id => id !== cardId);
      this.total = Math.max(0, this.total - 1);
      this.hasMore = this.orderedIds.length < this.total;
    },

    cancel() {
      const lifecycle = lifecycleFor(this);
      lifecycle.refreshController?.abort();
      lifecycle.loadMoreController?.abort();
      lifecycle.version += 1;
      lifecycle.refreshController = null;
      lifecycle.refreshPromise = null;
      lifecycle.loadMoreController = null;
      lifecycle.contextKey = null;
      lifecycle.snapshots.clear();
      this.loading = false;
      this.loadingMore = false;
    },
  },
});
