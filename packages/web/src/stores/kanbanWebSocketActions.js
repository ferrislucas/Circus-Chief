import { KanbanCardSessionResponse } from '@circuschief/shared/contracts/kanban';

// Kept adjacent to `KanbanCardSessionResponse` (instead of a hand-maintained
// list) so the allowlist below cannot silently drift from the contract: a
// field added to the server response without being added here is still
// dropped, safely, rather than requiring both to be updated in lockstep.
const KANBAN_CARD_SESSION_FIELDS = Object.keys(KanbanCardSessionResponse.shape);

/**
 * Describe a lane with one card removed, reporting whether the departing
 * card held a queue slot. Move and removal broadcasts carry no queue state,
 * so the caller drops the lane count for a departing queued card instead of
 * waiting for a full refetch. Pure — the caller assigns the returned cards
 * onto its own lane reference and applies the single count decrement.
 * @param {Object} lane - Lane the card is leaving
 * @param {string} cardId - Card leaving the lane
 * @returns {{ cards: Array, wasQueued: boolean }}
 */
function laneWithoutCard(lane, cardId) {
  const wasQueued = lane.cards?.some((c) => c.id === cardId && c.entryStatus === 'queued') ?? false;
  return {
    cards: lane.cards?.filter((c) => c.id !== cardId) || [],
    wasQueued,
  };
}

/**
 * Board-enrichment keys carried on card sessions by the full-board response
 * (`buildFullBoardResponse`) but absent from the thin `KANBAN_CARD_MOVED`
 * broadcast projection. Preserved across a move acknowledgement by session
 * ID; never a backdoor for un-allowlisted fields.
 */
const CARD_SESSION_ENRICHMENT_FIELDS = ['pendingAgentInput', 'latestCommandRuns'];

/**
 * Reconcile a thin move-broadcast card with the enriched board card it
 * acknowledges. The broadcast is authoritative for movement and queue state
 * (`id`, `laneId`, position, `entryStatus` — absent clears a stale queued
 * marker — and `activeLaneRun`, which is never carried over from the source
 * lane), while per-session board enrichment is preserved by session ID.
 * Pure.
 * @param {Object} existingCard - Enriched board card (optimistic copy)
 * @param {Object} broadcastCard - Thin authoritative broadcast card
 * @returns {Object} Merged card for the target lane
 */
export function mergeBroadcastCard(existingCard, broadcastCard) {
  const merged = { ...broadcastCard };
  const existingSessions = Array.isArray(existingCard?.sessions) ? existingCard.sessions : null;
  const broadcastSessions = Array.isArray(broadcastCard?.sessions) ? broadcastCard.sessions : null;
  if (broadcastSessions) {
    const existingById = new Map((existingSessions || []).map((s) => [s?.id, s]));
    merged.sessions = broadcastSessions.map((session) => {
      const local = existingById.get(session?.id);
      if (!local) return session;
      const reconciled = { ...session };
      for (const field of CARD_SESSION_ENRICHMENT_FIELDS) {
        if (!Object.hasOwn(session, field) && Object.hasOwn(local, field)) {
          reconciled[field] = local[field];
        }
      }
      return reconciled;
    });
  } else if (existingSessions) {
    // The broadcast carried no session projection; keep board state rather
    // than wiping the card's sessions.
    merged.sessions = existingSessions;
  }
  return merged;
}

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
    let departingWasQueued = false;
    if (sourceLane) {
      const next = laneWithoutCard(sourceLane, cardId);
      sourceLane.cards = next.cards;
      departingWasQueued = next.wasQueued;
    }

    // Add to target lane
    const targetLane = this.board?.lanes?.find((l) => l.id === toLaneId);
    if (targetLane) {
      targetLane.cards = targetLane.cards || [];
      const existingIndex = targetLane.cards.findIndex((c) => c.id === cardId);
      if (existingIndex !== -1) {
        // The owning browser moved this card optimistically before the
        // broadcast arrived, so its copy still carries the source queue
        // marker. That stale slot belongs to the source lane. The broadcast
        // is authoritative for movement and queue state, but it carries a
        // thin session projection without board enrichment, so the
        // acknowledgement reconciles instead of replacing outright.
        if (!departingWasQueued && targetLane.cards[existingIndex]?.entryStatus === 'queued') {
          departingWasQueued = true;
        }
        targetLane.cards[existingIndex] = mergeBroadcastCard(targetLane.cards[existingIndex], card);
      } else {
        targetLane.cards.push(card);
      }
    }

    if (departingWasQueued && sourceLane && (sourceLane.queuedCount || 0) > 0) {
      sourceLane.queuedCount -= 1;
    }
  },

  /**
   * Apply a queue-state broadcast without a full refetch. The server sends
   * the authoritative queue depth, so the lane badge converges; the card
   * gains the queued marker the board renders as a paused chip.
   * @param {Object} msg - KANBAN_ENTRY_QUEUED payload
   */
  handleEntryQueued(msg) {
    const lane = this.board?.lanes?.find((l) => l.id === msg?.laneId);
    if (!lane) return;
    if (typeof msg.queueDepth === 'number') lane.queuedCount = msg.queueDepth;
    const card = lane.cards?.find((c) => c.id === msg.cardId);
    if (card) card.entryStatus = 'queued';
  },

  /**
   * Clear a lane's queue state after a re-enable drain, without a refetch.
   * @param {Object} msg - KANBAN_QUEUE_DRAINED payload
   */
  handleQueueDrained(msg) {
    const lane = this.board?.lanes?.find((l) => l.id === msg?.laneId);
    if (!lane) return;
    lane.queuedCount = 0;
    for (const card of lane.cards || []) {
      if (card.entryStatus === 'queued') delete card.entryStatus;
    }
  },

  /** Update a card in place when the active run's shared exit is declared. */
  handleExitLaneDeclared(cardId, activeLaneRun) {
    const location = this._findCardLocation(cardId);
    if (!location) return;
    location.lane.cards[location.cardIndex] = {
      ...location.card,
      activeLaneRun,
    };
  },

  /**
   * Handle card removed from WebSocket
   * @param {string} cardId - The card ID that was removed
   * @param {string} laneId - The lane ID where the card was removed from
   */
  handleCardRemoved(cardId, laneId) {
    const lane = this.board?.lanes?.find((l) => l.id === laneId);
    if (!lane) return;
    const next = laneWithoutCard(lane, cardId);
    lane.cards = next.cards;
    if (next.wasQueued && (lane.queuedCount || 0) > 0) lane.queuedCount -= 1;
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
