import { sessions, kanbanBoards } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { broadcastSessionUpdate } from './summaryBroadcast.js';
import { buildFullBoardResponse } from './kanbanBoardResponse.js';

/**
 * Post-commit publication of tier-degradation change sets.
 *
 * `tierDeletionService` repairs persisted consumers inside a transaction and
 * returns a structured change set; this module turns that change set into
 * canonical websocket updates so connected clients reconcile immediately
 * instead of discovering the repair on their next refetch (or failing their
 * next request against a row that no longer matches what they display).
 *
 * Transport rules:
 * - Publishing happens strictly AFTER the repairing transaction commits —
 *   never inside it. A broadcast failure must never roll back a successful
 *   deletion; websocket delivery is fire-and-forget and clients can always
 *   recover through normal refetch/reconnect behavior.
 * - Only the mutated client-visible scopes are broadcast: affected sessions
 *   (SESSION_UPDATED to their session AND project subscribers) and projects
 *   whose kanban lanes were rewritten (KANBAN_BOARD_UPDATED). Global summary
 *   settings have no push channel in the protocol, so that change is picked
 *   up on the settings view's normal fetch.
 */

// ── Stale deleted-tier echo tolerance ───────────────────────────────────────
//
// A client whose follow-up was in flight while a tier was deleted still sends
// the old `tier::<id>` selection. Broadcasts reconcile the UI, but they cannot
// retroactively fix a request that already left. For exactly that race, the
// follow-up-message validation accepts the echo ONLY for a session this
// process just degraded FROM that exact tier, normalizing it to the
// server-side (concrete) binding. General unknown-tier validation is
// unchanged. Entries are single-use and expire quickly; the registry only
// ever matters within the deletion→delivery race window.

const STALE_ECHO_TTL_MS = 5 * 60 * 1000;
const recentlyDegradedBindings = new Map();

function rememberDegradedBinding(sessionId, tierRef) {
  recentlyDegradedBindings.set(sessionId, { tierRef, at: Date.now() });
}

/**
 * Whether `tierRef` is the just-degraded former binding of `sessionId`.
 * Consumes the entry on a match so each echo is tolerated once.
 *
 * @param {string} sessionId
 * @param {string} tierRef
 * @returns {boolean}
 */
export function consumeStaleTierEcho(sessionId, tierRef) {
  const entry = recentlyDegradedBindings.get(sessionId);
  if (!entry) return false;
  recentlyDegradedBindings.delete(sessionId);
  return entry.tierRef === tierRef && (Date.now() - entry.at) <= STALE_ECHO_TTL_MS;
}

/**
 * Publish one degradation change set to the affected client-visible scopes.
 * Safe to call with null/undefined (nothing degraded).
 *
 * @param {{
 *   degradedFrom: string,
 *   affectedSessions: Array<{ id: string, projectId: string }>,
 *   laneProjectIds: string[],
 *   summarySettingsChanged: boolean,
 * } | null} changeSet
 */
export function publishTierDegradation(changeSet) {
  if (!changeSet) return;

  for (const { id } of changeSet.affectedSessions) {
    const session = sessions.getById(id);
    if (!session) continue;
    rememberDegradedBinding(id, changeSet.degradedFrom);
    broadcastSessionUpdate(id, session.projectId, session);
  }

  for (const projectId of changeSet.laneProjectIds ?? []) {
    const board = kanbanBoards.getByProjectId(projectId);
    if (!board) continue;
    broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, {
      projectId,
      board: buildFullBoardResponse(board),
    });
  }
}

/**
 * Publish every change set produced by an emptied-tier sweep.
 *
 * @param {Array<Parameters<typeof publishTierDegradation>[0]>} changeSets
 */
export function publishEmptiedTierDegradations(changeSets) {
  for (const changeSet of changeSets ?? []) publishTierDegradation(changeSet);
}
