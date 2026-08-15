import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

export const WORKSPACE_PAGE_SIZE = 50;

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

async function fetchExtent(projectId, query, extent, signal) {
  const cards = [];
  let traversed = 0;
  let response = { pagination: {}, facets: { running: 0, idle: 0 } };

  do {
    const limit = Math.min(WORKSPACE_PAGE_SIZE, extent - traversed);
    response = await api.getWorkspaceCards(projectId, {
      ...query,
      limit,
      offset: traversed,
      signal,
    });
    const page = response.workspaces || [];
    cards.push(...page);
    traversed += page.length;
    if (page.length === 0) break;
  } while (traversed < extent && response.pagination?.hasMore);

  return {
    workspaces: uniqueCards(cards),
    facets: response.facets || { running: 0, idle: 0 },
    pagination: {
      ...response.pagination,
      offset: traversed,
      hasMore: Boolean(response.pagination?.hasMore),
    },
  };
}

function isAbort(error) {
  return error?.name === 'AbortError';
}

function canCommitPage(store, lifecycle, request) {
  return !request.controller.signal.aborted
    && lifecycle.version === request.version
    && lifecycle.contextKey === request.contextKey
    && store.nextOffset === request.offset;
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
      this.nextOffset = result.pagination?.offset || cards.length;
      this.hasMore = Boolean(result.pagination?.hasMore);
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
      const extent = Math.max(WORKSPACE_PAGE_SIZE, this.orderedIds.length);
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
      const offset = this.nextOffset;
      const controller = new AbortController();
      const request = { controller, version, contextKey, offset };
      lifecycle.loadMoreController = controller;
      this.loadingMore = true;
      try {
        const result = await api.getWorkspaceCards(projectId, {
          ...query,
          limit: WORKSPACE_PAGE_SIZE,
          offset,
          signal: controller.signal,
        });
        if (canCommitPage(this, lifecycle, request)) this._appendPage(result, offset);
      } catch (error) {
        if (!isAbort(error)) {
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

    _appendPage(result, offset) {
      const appended = uniqueCards([
        ...this.orderedIds.map(id => this.cardsById[id]),
        ...(result.workspaces || []),
      ]);
      this.cardsById = Object.fromEntries(appended.map(card => [card.id, card]));
      this.orderedIds = appended.map(card => card.id);
      this.facets = result.facets || this.facets;
      this.total = result.pagination?.total ?? this.total;
      this.nextOffset = offset + (result.workspaces?.length || 0);
      this.hasMore = Boolean(result.pagination?.hasMore);
    },

    patchCard(cardId, patch) {
      if (!this.cardsById[cardId]) return;
      this.cardsById[cardId] = { ...this.cardsById[cardId], ...patch };
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
