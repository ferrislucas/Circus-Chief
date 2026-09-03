import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';
import { kanbanWebSocketActions } from './kanbanWebSocketActions.js';

export const useKanbanStore = defineStore('kanban', {
  state: () => ({
    board: null, // The full board with lanes and cards
    loading: false,
    error: null,
    currentProjectId: null, // Track which project's board is loaded
  }),

  getters: {
    /**
     * Get a lane by ID
     */
    getLaneById: (state) => (laneId) => state.board?.lanes?.find((l) => l.id === laneId) || null,

    /**
     * Get a card by ID
     */
    getCardById: (state) => (cardId) => {
      for (const lane of state.board?.lanes || []) {
        const card = lane.cards?.find((c) => c.id === cardId);
        if (card) return card;
      }
      return null;
    },

    /**
     * Get a card by session ID
     */
    getCardBySessionId: (state) => (sessionId) => {
      for (const lane of state.board?.lanes || []) {
        const card = lane.cards?.find((c) =>
          c.sessions?.some((s) => s.id === sessionId)
        );
        if (card) return card;
      }
      return null;
    },

    /**
     * Check if a session is on the board
     */
    isSessionOnBoard: (state) => (sessionId) => {
      for (const lane of state.board?.lanes || []) {
        const card = lane.cards?.find((c) =>
          c.sessions?.some((s) => s.id === sessionId)
        );
        if (card) return true;
      }
      return false;
    },

    /**
     * Get lane names in order
     */
    laneNames: (state) => state.board?.lanes?.map((l) => l.name) || [],

    /**
     * Get total card count
     */
    totalCardCount: (state) => {
      let count = 0;
      for (const lane of state.board?.lanes || []) {
        count += lane.cards?.length || 0;
      }
      return count;
    },
  },

  actions: {
    /**
     * Find a card by ID and return its lane and index
     * @private
     */
    _findCardLocation(cardId) {
      if (!this.board) return null;
      for (const lane of this.board.lanes) {
        const cardIndex = lane.cards?.findIndex((c) => c.id === cardId);
        if (cardIndex !== -1) {
          return { lane, cardIndex, card: lane.cards[cardIndex] };
        }
      }
      return null;
    },

    /**
     * Move a card optimistically (for UI responsiveness)
     * @private
     */
    _moveCardOptimistic(cardId, targetLaneId) {
      const location = this._findCardLocation(cardId);
      if (!location) return null;

      const { lane: sourceLane, cardIndex, card } = location;
      sourceLane.cards.splice(cardIndex, 1);

      const targetLane = this.board.lanes.find((l) => l.id === targetLaneId);
      if (targetLane) {
        targetLane.cards = targetLane.cards || [];
        targetLane.cards.push({ ...card, laneId: targetLaneId });
      }

      return { sourceLane, card };
    },

    /**
     * Revert an optimistic card move
     * @private
     */
    _revertCardMove(sourceLaneInput, card, targetLaneId) {
      const sourceLane = sourceLaneInput;
      if (!this.board) return;
      const targetLane = this.board.lanes.find((l) => l.id === targetLaneId);
      if (targetLane) {
        targetLane.cards = targetLane.cards?.filter((c) => c.id !== card.id) || [];
      }
      sourceLane.cards = sourceLane.cards || [];
      sourceLane.cards.push(card);
    },

    /**
     * Fetch the kanban board for a project
     * @param {string} projectId
     */
    async fetchBoard(projectId) {
      this.loading = true;
      this.error = null;
      this.currentProjectId = projectId;

      try {
        const board = await api.getKanbanBoard(projectId);
        this.board = board;
        return board;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Reset the board (called when switching projects)
     */
    reset() {
      this.board = null;
      this.loading = false;
      this.error = null;
      this.currentProjectId = null;
    },

    /**
     * Create a new lane
     */
    async createLane(projectId, data) {
      this.loading = true;
      this.error = null;

      try {
        const lane = await api.createKanbanLane(projectId, data);
        // Lane will be added via WebSocket KANBAN_BOARD_UPDATED message
        return lane;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Update a lane
     */
    async updateLane(projectId, laneId, data) {
      this.loading = true;
      this.error = null;

      try {
        const updated = await api.updateKanbanLane(projectId, laneId, data);
        // Lane will be updated via WebSocket KANBAN_BOARD_UPDATED message
        return updated;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Delete a lane
     */
    async deleteLane(projectId, laneId) {
      this.loading = true;
      this.error = null;

      try {
        await api.deleteKanbanLane(projectId, laneId);
        // Lane will be removed via WebSocket KANBAN_BOARD_UPDATED message
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Reorder lanes
     */
    async reorderLanes(projectId, laneIds) {
      this.error = null;

      // Optimistic update
      const oldLanes = [...(this.board?.lanes || [])];
      if (this.board) {
        const laneMap = new Map(this.board.lanes.map((l) => [l.id, l]));
        this.board.lanes = laneIds
          .map((id) => laneMap.get(id))
          .filter(Boolean);
      }

      try {
        const board = await api.reorderKanbanLanes(projectId, laneIds);
        this.board = board;
        return board;
      } catch (err) {
        // Revert on error
        if (this.board) {
          this.board.lanes = oldLanes;
        }
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Add a workspace to the board.
     * @param {string} projectId
     * @param {string} workspaceId - Workspace (root session) ID.  Callers
     *   should resolve the root before calling, but the server normalizes
     *   anyway as a fallback.
     * @param {string} laneId
     */
    async addSessionToBoard(projectId, workspaceId, laneId) {
      this.loading = true;
      this.error = null;

      try {
        const card = await api.createKanbanCard(projectId, { workspaceId, laneId });
        // Add card to lane in state
        const lane = this.board?.lanes.find((l) => l.id === laneId);
        if (lane) {
          lane.cards = lane.cards || [];
          if (!lane.cards.some((c) => c.id === card.id)) {
            lane.cards.push(card);
          }
        }
        return card;
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /** Route a workspace card to a lane. */
    async routeWorkspaceCard(projectId, workspaceId, cardId, targetLaneId) {
      this.error = null;

      // Optimistic update
      const optimisticResult = this._moveCardOptimistic(cardId, targetLaneId);

      try {
        const result = await api.routeWorkspaceKanbanCard(projectId, workspaceId, targetLaneId);
        if (result.status === 'scheduled') {
          if (optimisticResult) this._revertCardMove(optimisticResult.sourceLane, optimisticResult.card, targetLaneId);
          return result;
        }

        // The route response deliberately exposes no card internals.
        const location = this._findCardLocation(cardId);
        if (location) {
          location.lane.cards[location.cardIndex] = { ...location.card, laneId: targetLaneId };
        }

        return result;
      } catch (err) {
        // Revert on error
        if (optimisticResult) {
          this._revertCardMove(optimisticResult.sourceLane, optimisticResult.card, targetLaneId);
        }
        this.error = err.message;
        throw err;
      }
    },

    /**
     * Remove a card from the board
     */
    async removeCard(projectId, cardId) {
      this.loading = true;
      this.error = null;

      try {
        await api.deleteKanbanCard(projectId, cardId);
        // Remove card from state
        const lanes = this.board?.lanes || [];
        for (const lane of lanes) {
          const cardIndex = lane.cards?.findIndex((c) => c.id === cardId);
          if (cardIndex !== -1) {
            lane.cards.splice(cardIndex, 1);
            break;
          }
        }
      } catch (err) {
        this.error = err.message;
        throw err;
      } finally {
        this.loading = false;
      }
    },

    /**
     * Reorder cards within a lane
     */
    async reorderCards(projectId, laneId, cardIds) {
      this.error = null;

      // Optimistic update
      const lane = this.board?.lanes?.find((l) => l.id === laneId);
      const oldCards = lane?.cards ? [...lane.cards] : [];

      if (lane) {
        const cardMap = new Map(lane.cards.map((c) => [c.id, c]));
        lane.cards = cardIds.map((id) => cardMap.get(id)).filter(Boolean);
      }

      try {
        await api.reorderKanbanCards(projectId, laneId, cardIds);
      } catch (err) {
        // Revert on error
        if (lane) {
          lane.cards = oldCards;
        }
        this.error = err.message;
        throw err;
      }
    },

    ...kanbanWebSocketActions,
  },
});
