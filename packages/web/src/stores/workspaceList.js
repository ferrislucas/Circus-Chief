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
    offset: 0,
  }),
  getters: {
    cards: state => state.orderedIds.map(id => state.cardsById[id]).filter(Boolean),
    hasActiveFilters: state => Object.values(state.query).some(value => value !== undefined && value !== null && value !== ''),
  },
  actions: {
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
      this.offset = this.orderedIds.length;
      this.hasMore = Boolean(result.pagination?.hasMore);
      snapshots.set(queryKey(projectId, query), {
        cardsById: { ...this.cardsById }, orderedIds: [...this.orderedIds],
        offset: this.offset, hasMore: this.hasMore,
      });
    },
    async load(projectId, query = {}, { force = false } = {}) {
      const key = queryKey(projectId, query);
      const cached = snapshots.get(key);
      if (cached && !force) {
        this.projectId = projectId; this.query = query;
        this.cardsById = { ...cached.cardsById }; this.orderedIds = [...cached.orderedIds];
        this.offset = cached.offset; this.hasMore = cached.hasMore;
        // Paint the cache now; revalidate without blocking it.
        this.revalidate(projectId, query);
        return;
      }
      this.loading = true; this.error = null;
      try { await this.revalidate(projectId, query); } finally { this.loading = false; }
    },
    async revalidate(projectId, query = {}) {
      const key = queryKey(projectId, query);
      if (!inFlight.has(key)) {
        inFlight.set(key, api.getWorkspaceCards(projectId, { ...query, limit: PAGE_SIZE, offset: 0 })
          .finally(() => inFlight.delete(key)));
      }
      try {
        const result = await inFlight.get(key);
        if (this.projectId === null || (this.projectId === projectId && queryKey(projectId, this.query) === key)) {
          this._install(projectId, query, result);
        }
      } catch (error) {
        if (!this.cards.length) this.error = error.message || 'Failed to load workspaces';
        throw error;
      }
    },
    async loadMore() {
      if (!this.projectId || !this.hasMore || this.loadingMore) return;
      this.loadingMore = true;
      try {
        const result = await api.getWorkspaceCards(this.projectId, {
          ...this.query, limit: PAGE_SIZE, offset: this.offset,
        });
        this._install(this.projectId, this.query, result, { append: true });
      } finally { this.loadingMore = false; }
    },
  },
});
