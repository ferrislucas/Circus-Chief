import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

const PAGE_SIZE = 50;

// Snapshots intentionally live outside Pinia state: navigating away must not
// discard a useful list, while a full page reload should still start cold.
const snapshots = new Map();
const inFlight = new Map();

function queryKey(projectId, query) {
  return `${projectId}:${JSON.stringify(query)}`;
}

function cardMatchesQuery(card, query) {
  return [
    query.archived === undefined || Boolean(card.archived) === Boolean(query.archived),
    query.starred === null || query.starred === undefined || Boolean(card.starred) === query.starred,
    query.status !== 'running' || card.runningCount > 0,
    query.status !== 'idle' || !(card.runningCount > 0),
    query.scheduled !== true || card.scheduledCount > 0,
    query.scheduled !== false || !(card.scheduledCount > 0),
  ].every(Boolean);
}

const orderValue = card => card.lastActivityAt ?? card.updatedAt ?? card.createdAt ?? 0;
function compareCards(left, right) {
  return Number(Boolean(right.starred)) - Number(Boolean(left.starred))
    || orderValue(right) - orderValue(left)
    || (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
    || (right.createdAt ?? 0) - (left.createdAt ?? 0)
    || right.id.localeCompare(left.id);
}

function abortPendingLoadMore(store) {
  store._loadMoreController?.abort();
}

function beginListRequest(store, key) {
  if (store._requestController && store._activeRequestKey !== key) store._requestController.abort();
  store._activeRequestKey = key;
  abortPendingLoadMore(store);
}

async function fetchWorkspaceExtent(projectId, query, loadedExtent, controller) {
  let cursor = null;
  let result;
  const cards = [];
  do {
    result = await api.getWorkspaceCards(projectId, {
      ...query, limit: PAGE_SIZE, cursor, signal: controller.signal,
    });
    cards.push(...(result.workspaces || []));
    cursor = result.pagination?.nextCursor || null;
  } while (cards.length < loadedExtent && result.pagination?.hasMore && cursor);
  return { workspaces: cards, pagination: result?.pagination || {} };
}

export const useWorkspaceListStore = defineStore('workspaceList', {
  state: () => ({
    projectId: null,
    query: {},
    cardsById: {},
    orderedIds: [],
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    nextCursor: null,
  }),
  getters: {
    cards: state => state.orderedIds.map(id => state.cardsById[id]).filter(Boolean),
    // `archived: false` is the default scope of the list rather than a filter
    // the user chose, so an empty unfiltered project still reads as
    // "no workspaces yet" instead of "nothing matches the filter".
    hasActiveFilters: state => state.query.archived === true
      || ['starred', 'status', 'scheduled']
        .some(key => state.query[key] !== undefined && state.query[key] !== null && state.query[key] !== ''),
  },
  actions: {
    _saveSnapshot() {
      if (!this.projectId) return;
      snapshots.set(queryKey(this.projectId, this.query), {
        cardsById: { ...this.cardsById }, orderedIds: [...this.orderedIds],
        nextCursor: this.nextCursor, hasMore: this.hasMore,
      });
    },
    _install(projectId, query, result, { append = false } = {}) {
      const cards = result.workspaces || [];
      if (!append) {
        this.cardsById = {};
        this.orderedIds = [];
      }
      for (const card of cards) {
        this.cardsById[card.id] = card;
        if (!this.orderedIds.includes(card.id)) this.orderedIds.push(card.id);
      }
      this.projectId = projectId;
      this.query = query;
      this.hasMore = Boolean(result.pagination?.hasMore);
      this.nextCursor = result.pagination?.nextCursor || null;
      this._saveSnapshot();
    },
    reconcileCard(card) {
      if (!card?.id || card.projectId !== this.projectId) return;
      if (!cardMatchesQuery(card, this.query)) {
        this.removeCard(card.id);
        return;
      }
      this.cardsById[card.id] = { ...this.cardsById[card.id], ...card };
      if (!this.orderedIds.includes(card.id)) this.orderedIds.push(card.id);
      this.orderedIds.sort((leftId, rightId) => compareCards(this.cardsById[leftId], this.cardsById[rightId]));
      this._saveSnapshot();
    },
    patchCard(cardId, patch) {
      const current = this.cardsById[cardId];
      if (current) this.reconcileCard({ ...current, ...patch });
    },
    removeCard(cardId) {
      if (!this.cardsById[cardId]) return;
      const next = { ...this.cardsById };
      delete next[cardId];
      this.cardsById = next;
      this.orderedIds = this.orderedIds.filter(id => id !== cardId);
      this._saveSnapshot();
    },
    async load(projectId, query = {}, { force = false } = {}) {
      const key = queryKey(projectId, query);
      const cached = snapshots.get(key);
      if (cached && !force) {
        this.projectId = projectId; this.query = query;
        this.cardsById = { ...cached.cardsById }; this.orderedIds = [...cached.orderedIds];
        this.nextCursor = cached.nextCursor; this.hasMore = cached.hasMore;
        // Paint the cache now; revalidate without blocking it.
        this.revalidate(projectId, query);
        return;
      }
      this.loading = true; this.error = null;
      try { await this.revalidate(projectId, query); } finally { this.loading = false; }
    },
    async revalidate(projectId, query = {}) {
      const key = queryKey(projectId, query);
      // A new query invalidates the former route's commit boundary. Keep only
      // one active list request: leaving a route must not install stale cards.
      // A page belongs to the list snapshot that produced its cursor. Starting
      // a fresh snapshot makes any in-progress page unsafe to append.
      beginListRequest(this, key);
      if (!inFlight.has(key)) {
        const controller = new AbortController();
        this._requestController = controller;
        // Refresh every page currently on screen. Replacing a multi-page cache
        // with only page one makes a cached return visibly collapse.
        const loadedExtent = this.projectId === projectId && queryKey(projectId, this.query) === key
          ? this.orderedIds.length : PAGE_SIZE;
        const promise = fetchWorkspaceExtent(projectId, query, loadedExtent, controller);
        inFlight.set(key, { promise, controller });
        promise.finally(() => {
          if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
        });
      }
      const request = inFlight.get(key);
      try {
        const result = await request.promise;
        if (this._activeRequestKey === key) {
          this._install(projectId, query, result);
        }
      } catch (error) {
        if (error?.name !== 'AbortError' && this._activeRequestKey === key) {
          if (!this.cards.length) this.error = error.message || 'Failed to load workspaces';
          throw error;
        }
      } finally {
        if (this._requestController === request.controller) this._requestController = null;
      }
    },
    async loadMore() {
      if (!this.projectId || !this.hasMore || this.loadingMore) return;
      const projectId = this.projectId;
      const query = { ...this.query };
      const key = queryKey(projectId, query);
      const cursor = this.nextCursor;
      const controller = new AbortController();
      this._loadMoreController = controller;
      this.loadingMore = true;
      try {
        const result = await api.getWorkspaceCards(projectId, {
          ...query, limit: PAGE_SIZE, cursor, signal: controller.signal,
        });
        // Do not let an old cursor append into a replacement project, filter,
        // or refreshed list snapshot.
        if (!controller.signal.aborted
          && this.projectId === projectId
          && queryKey(this.projectId, this.query) === key
          && this.nextCursor === cursor) {
          this._install(projectId, query, result, { append: true });
        }
      } catch (error) {
        if (error?.name !== 'AbortError') throw error;
      } finally {
        if (this._loadMoreController === controller) {
          this._loadMoreController = null;
          this.loadingMore = false;
        }
      }
    },
  },
});
