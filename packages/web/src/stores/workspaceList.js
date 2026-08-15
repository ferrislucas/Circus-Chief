import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const WORKSPACE_PAGE_SIZE = 50;
export const WORKSPACE_MAX_EXTENT = 500;

const requestLifecycles = new WeakMap();

function lifecycleFor(store) {
  if (!requestLifecycles.has(store)) {
    requestLifecycles.set(store, {
      version: 0,
      contextKey: null,
      refreshController: null,
      refreshPromise: null,
      loadMoreController: null,
    });
  }
  return requestLifecycles.get(store);
}

function queryKey(projectId, query) {
  return `${projectId}:${JSON.stringify(query)}`;
}

function uniqueCards(cards) {
  const seen = new Set();
  return cards.filter((card) => {
    if (!card?.id || seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}

const fetchExtent = (projectId, query, extent, signal) => api.getWorkspaceCards(projectId, {
  ...query,
  limit: Math.min(extent, WORKSPACE_MAX_EXTENT),
  offset: 0,
  signal,
});

function isAbort(error) {
  return error?.name === 'AbortError';
}

function canCommitPage(store, lifecycle, request) {
  return !request.controller.signal.aborted
    && lifecycle.version === request.version
    && lifecycle.contextKey === request.contextKey
    && store.requestedExtent === request.extent;
}

export const useWorkspaceListStore = defineStore('workspaceList', {
  state: () => ({
    projectId: null,
    query: {},
    cardsById: {},
    orderedIds: [],
    facets: { running: 0, idle: 0 },
    total: 0,
    nextOffset: 0,
    requestedExtent: WORKSPACE_PAGE_SIZE,
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
      const cards = uniqueCards(result.workspaces || []);
      this.cardsById = Object.fromEntries(cards.map(card => [card.id, card]));
      this.orderedIds = cards.map(card => card.id);
      this.facets = result.facets || { running: 0, idle: 0 };
      this.total = result.pagination?.total || 0;
      this.nextOffset = cards.length;
      if (this.total < this.requestedExtent) {
        this.requestedExtent = Math.max(WORKSPACE_PAGE_SIZE, this.total);
      }
      this.hasMore = Boolean(result.pagination?.hasMore)
        && this.requestedExtent < WORKSPACE_MAX_EXTENT;
    },

    _resetContext(projectId, query) {
      const lifecycle = lifecycleFor(this);
      lifecycle.refreshController?.abort();
      lifecycle.loadMoreController?.abort();
      lifecycle.version += 1;
      lifecycle.contextKey = queryKey(projectId, query);
      lifecycle.refreshController = null;
      lifecycle.refreshPromise = null;
      lifecycle.loadMoreController = null;

      this.projectId = projectId;
      this.query = { ...query };
      this.cardsById = {};
      this.orderedIds = [];
      this.facets = { running: 0, idle: 0 };
      this.total = 0;
      this.nextOffset = 0;
      this.requestedExtent = WORKSPACE_PAGE_SIZE;
      this.hasMore = false;
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
      const extent = this.requestedExtent;
      this.loading = this.orderedIds.length === 0;
      this.error = null;

      const promise = fetchExtent(projectId, query, extent, controller.signal)
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
      const extent = Math.min(this.requestedExtent + WORKSPACE_PAGE_SIZE, WORKSPACE_MAX_EXTENT);
      if (extent === this.requestedExtent) return;
      const controller = new AbortController();
      const request = { controller, version, contextKey, extent };
      lifecycle.loadMoreController = controller;
      this.requestedExtent = extent;
      this.loadingMore = true;
      try {
        const result = await fetchExtent(projectId, query, extent, controller.signal);
        if (canCommitPage(this, lifecycle, request)) this._replace(result);
      } catch (error) {
        if (!isAbort(error)) {
          if (canCommitPage(this, lifecycle, request)) {
            this.requestedExtent = Math.max(WORKSPACE_PAGE_SIZE, extent - WORKSPACE_PAGE_SIZE);
          }
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
      this.nextOffset = ids.length;
      this.hasMore = ids.length < this.total;
    },

    removeCard(cardId) {
      if (!this.cardsById[cardId]) return;
      const next = { ...this.cardsById };
      delete next[cardId];
      this.cardsById = next;
      this.orderedIds = this.orderedIds.filter(id => id !== cardId);
      this.total = Math.max(0, this.total - 1);
      this.nextOffset = Math.max(0, this.nextOffset - 1);
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
      this.loading = false;
      this.loadingMore = false;
    },
  },
});
