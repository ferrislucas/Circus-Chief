import { defineStore } from 'pinia';
import { api } from '../composables/useApi.js';

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
    getLaneById: (state) => (laneId) => {
      return state.board?.lanes?.find((l) => l.id === laneId) || null;
    },

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
    laneNames: (state) => {
      return state.board?.lanes?.map((l) => l.name) || [];
    },

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
        // Add lane to board state
        if (this.board) {
          this.board.lanes.push({ ...lane, cards: [] });
        }
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
        // Update lane in state
        if (this.board) {
          const index = this.board.lanes.findIndex((l) => l.id === laneId);
          if (index !== -1) {
            const existingCards = this.board.lanes[index].cards;
            this.board.lanes[index] = { ...updated, cards: existingCards };
          }
        }
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
        // Remove lane from state
        if (this.board) {
          this.board.lanes = this.board.lanes.filter((l) => l.id !== laneId);
        }
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
     * Add a session to the board
     */
    async addSessionToBoard(projectId, sessionId, laneId) {
      this.loading = true;
      this.error = null;

      try {
        const card = await api.createKanbanCard(projectId, { sessionId, laneId });
        // Add card to lane in state
        if (this.board) {
          const lane = this.board.lanes.find((l) => l.id === laneId);
          if (lane) {
            lane.cards = lane.cards || [];
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

    /**
     * Move a card to a different lane
     */
    async moveCard(projectId, cardId, targetLaneId, options = {}) {
      this.error = null;

      // Optimistic update
      let oldSourceLane = null;
      let oldCard = null;

      if (this.board) {
        for (const lane of this.board.lanes) {
          const cardIndex = lane.cards?.findIndex((c) => c.id === cardId);
          if (cardIndex !== -1 && cardIndex !== undefined) {
            oldSourceLane = lane;
            oldCard = lane.cards[cardIndex];
            // Remove from source lane
            lane.cards.splice(cardIndex, 1);
            // Add to target lane
            const targetLane = this.board.lanes.find((l) => l.id === targetLaneId);
            if (targetLane) {
              targetLane.cards = targetLane.cards || [];
              targetLane.cards.push({ ...oldCard, laneId: targetLaneId });
            }
            break;
          }
        }
      }

      try {
        const movedCard = await api.moveKanbanCard(projectId, cardId, {
          targetLaneId,
          ...options,
        });
        // Update card in state with server response
        if (this.board) {
          const targetLane = this.board.lanes.find((l) => l.id === targetLaneId);
          if (targetLane) {
            const cardIndex = targetLane.cards?.findIndex((c) => c.id === cardId);
            if (cardIndex !== -1 && cardIndex !== undefined) {
              targetLane.cards[cardIndex] = movedCard;
            }
          }
        }
        return movedCard;
      } catch (err) {
        // Revert on error
        if (oldSourceLane && oldCard && this.board) {
          // Remove from target
          const targetLane = this.board.lanes.find((l) => l.id === targetLaneId);
          if (targetLane) {
            targetLane.cards = targetLane.cards?.filter((c) => c.id !== cardId) || [];
          }
          // Add back to source
          oldSourceLane.cards = oldSourceLane.cards || [];
          oldSourceLane.cards.push(oldCard);
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
        if (this.board) {
          for (const lane of this.board.lanes) {
            const cardIndex = lane.cards?.findIndex((c) => c.id === cardId);
            if (cardIndex !== -1 && cardIndex !== undefined) {
              lane.cards.splice(cardIndex, 1);
              break;
            }
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

    // ============== WebSocket handlers ==============

    /**
     * Handle board update from WebSocket
     * @param {Object} board - The updated board object
     */
    handleBoardUpdated(board) {
      this.board = board;
    },

    /**
     * Handle card added from WebSocket
     * @param {Object} card - The card that was added
     * @param {string} laneId - The lane ID where the card was added
     */
    handleCardAdded(card, laneId) {
      const lane = this.board?.lanes?.find((l) => l.id === laneId);
      if (lane) {
        lane.cards = lane.cards || [];
        // Avoid duplicates
        if (!lane.cards.some((c) => c.id === card.id)) {
          lane.cards.push(card);
        }
      }
    },

    /**
     * Handle card moved from WebSocket
     * @param {string} cardId - The card ID that was moved
     * @param {string} fromLaneId - The source lane ID
     * @param {string} toLaneId - The target lane ID
     * @param {Object} card - The updated card object
     */
    handleCardMoved(cardId, fromLaneId, toLaneId, card) {
      // Remove from source lane
      const sourceLane = this.board?.lanes?.find((l) => l.id === fromLaneId);
      if (sourceLane) {
        sourceLane.cards = sourceLane.cards?.filter((c) => c.id !== cardId) || [];
      }

      // Add to target lane
      const targetLane = this.board?.lanes?.find((l) => l.id === toLaneId);
      if (targetLane) {
        targetLane.cards = targetLane.cards || [];
        // Avoid duplicates
        if (!targetLane.cards.some((c) => c.id === cardId)) {
          targetLane.cards.push(card);
        }
      }
    },

    /**
     * Handle card removed from WebSocket
     * @param {string} cardId - The card ID that was removed
     * @param {string} laneId - The lane ID where the card was removed from
     */
    handleCardRemoved(cardId, laneId) {
      const lane = this.board?.lanes?.find((l) => l.id === laneId);
      if (lane) {
        lane.cards = lane.cards?.filter((c) => c.id !== cardId) || [];
      }
    },

    /**
     * Handle session update from WebSocket (update card's session data)
     */
    handleSessionUpdated(session) {
      if (!this.board) return;

      for (const lane of this.board.lanes) {
        for (const card of lane.cards || []) {
          const sessionIndex = card.sessions?.findIndex((s) => s.id === session.id);
          if (sessionIndex !== -1 && sessionIndex !== undefined) {
            // Update session data in the card
            card.sessions[sessionIndex] = {
              ...card.sessions[sessionIndex],
              name: session.name,
              status: session.status,
              mode: session.mode,
              costUsd: session.costUsd,
              starred: session.starred,
              prUrl: session.prUrl,
              updatedAt: session.updatedAt,
            };
            return; // Found and updated, exit early
          }
        }
      }
    },
  },
});
