import { KanbanCardSessionResponse } from '@circuschief/shared/contracts/kanban';

// Kept adjacent to `KanbanCardSessionResponse` (instead of a hand-maintained
// list) so the allowlist below cannot silently drift from the contract: a
// field added to the server response without being added here is still
// dropped, safely, rather than requiring both to be updated in lockstep.
const KANBAN_CARD_SESSION_FIELDS = Object.keys(KanbanCardSessionResponse.shape);

/**
 * WebSocket-driven actions for the Kanban board store.
 *
 * The board is an authoritative server read model: mutations do not patch
 * local state, they rely on the broadcast that follows. These handlers apply
 * those broadcasts and are spread into the store's `actions`.
 */
export const kanbanWebSocketActions = {
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
          // Only copy allowlisted fields onto the card. A blind `...session`
          // spread would let every field the server ever adds to a
          // `session:updated` broadcast land in kanban card state,
          // bypassing `KanbanCardSessionResponse` entirely. A field this
          // update omits (e.g. a partial broadcast) must not clobber the
          // existing value, so only own-keys actually present are applied.
          const current = card.sessions[sessionIndex];
          const allowedUpdates = Object.fromEntries(
            KANBAN_CARD_SESSION_FIELDS
              .filter((field) => Object.hasOwn(session, field))
              .map((field) => [field, session[field]]),
          );
          card.sessions[sessionIndex] = { ...current, ...allowedUpdates };
          return; // Found and updated, exit early
        }
      }
    }
  },

  /**
   * Apply a mutation to a board session's latest command runs.
   * @param {string} sessionId - Session whose runs changed
   * @param {(runs: Array) => Array} mutate - Receives the current runs, returns the next set
   */
  _patchSessionCommandRuns(sessionId, mutate) {
    if (!this.board) return;

    for (const lane of this.board.lanes) {
      for (const card of lane.cards || []) {
        const index = card.sessions?.findIndex((s) => s.id === sessionId) ?? -1;
        if (index === -1) continue;
        const current = card.sessions[index];
        card.sessions[index] = {
          ...current,
          latestCommandRuns: mutate(current.latestCommandRuns || []),
        };
        return; // A session belongs to at most one card
      }
    }
  },

  /**
   * Upsert the latest run for a button on a board session. Kanban card
   * indicators read their state from board data, so realtime command-run
   * events have to land here to keep the icons live.
   * @param {string} sessionId - Session that ran the command
   * @param {Object} run - Run fields to store (must include buttonId)
   */
  handleSessionCommandRun(sessionId, run) {
    if (!run?.buttonId) return;
    this._patchSessionCommandRuns(sessionId, (runs) => {
      const next = runs.filter((r) => r.buttonId !== run.buttonId);
      next.push(run);
      return next;
    });
  },

  /**
   * Drop a button's run from a board session (run deleted).
   * @param {string} sessionId - Session the run belonged to
   * @param {string} buttonId - Button whose run was removed
   */
  handleSessionCommandRunRemoved(sessionId, buttonId) {
    this._patchSessionCommandRuns(sessionId, runs => runs.filter(r => r.buttonId !== buttonId));
  },
};
