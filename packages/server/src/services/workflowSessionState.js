import { databaseManager } from '../db/DatabaseManager.js';

const now = () => Date.now();

/**
 * Empty-draft exemption (FRD empty-draft-lane-run-blocker): a run-member
 * session meeting ALL of these holds no real open obligation, so it must not
 * block its lane run:
 *   1. own_work_state = 'open', and
 *   2. zero conversation messages ever (all roles — no role filter), and
 *   3. never executed (last_activity_at IS NULL, maintained by the
 *      trg_sessions_activity_on_* triggers on messages, summaries, and
 *      command runs; the computed active_time_ms is max-min message
 *      timestamps, so a zero message count implies it is 0), and
 *   4. no pending or scheduled work (pending_prompt AND scheduled_at NULL), and
 *   5. execution_state is 'idle'.
 *
 * Evaluated dynamically from live row state on every call, never stamped —
 * a draft that later starts immediately stops being exempt (FR-2).
 * @param {Object} sessionRow - sessions row (must carry id, own_work_state,
 *   last_activity_at, pending_prompt, scheduled_at, execution_state)
 * @param {Object} [db] - better-sqlite3 handle for the message-count lookup
 * @returns {boolean}
 */
export function isEmptyDraftSession(sessionRow, db = databaseManager.get()) {
  if (!sessionRow || sessionRow.own_work_state !== 'open') return false;
  if (sessionRow.last_activity_at != null) return false;
  if (sessionRow.pending_prompt != null || sessionRow.scheduled_at != null) return false;
  if ((sessionRow.execution_state || 'idle') !== 'idle') return false;
  const count = db.prepare('SELECT COUNT(*) AS count FROM conversation_messages WHERE session_id=?')
    .get(sessionRow.id)?.count || 0;
  return count === 0;
}

export function computeSubtreeOutcome(ownWorkState, childSubtreeOutcomes) {
  if (ownWorkState === 'closed_failed' || childSubtreeOutcomes.includes('failed')) return 'failed';
  if (ownWorkState === 'cancelled' || childSubtreeOutcomes.includes('cancelled')) return 'cancelled';
  if (ownWorkState !== 'closed_successfully') return 'open';
  if (childSubtreeOutcomes.some((outcome) => outcome !== 'succeeded')) return 'open';
  return 'succeeded';
}

export function recomputeSubtreeOutcomes(runId) {
  const db = databaseManager.get();
  const run = db.prepare('SELECT root_session_id FROM kanban_lane_runs WHERE id=?').get(runId);
  if (!run?.root_session_id) return null;
  const members = db.prepare(`SELECT id, parent_session_id, own_work_state, subtree_outcome,
    last_activity_at, pending_prompt, scheduled_at, execution_state FROM sessions WHERE lane_run_id=?`).all(runId);
  const byParent = new Map();
  for (const member of members) {
    if (!byParent.has(member.parent_session_id)) byParent.set(member.parent_session_id, []);
    byParent.get(member.parent_session_id).push(member);
  }
  const byId = new Map(members.map((member) => [member.id, member]));
  const computed = new Map();
  const time = now();
  function resolve(node) {
    if (computed.has(node.id)) return computed.get(node.id);
    const childOutcomes = (byParent.get(node.id) || []).map((child) => resolve(child));
    // An empty draft contributes no open obligation of its own: its own-work
    // side reads as satisfied, while any real work below it still rolls up
    // normally (a started child keeps blocking through the draft).
    const draft = isEmptyDraftSession(node, db);
    const outcome = computeSubtreeOutcome(draft ? 'closed_successfully' : node.own_work_state, childOutcomes);
    computed.set(node.id, outcome);
    // Never persist the exemption: the draft's own work IS still open, and a
    // stale 'succeeded' stamp would corrupt a later start (FR-2).
    if (!draft && outcome !== node.subtree_outcome) {
      db.prepare('UPDATE sessions SET subtree_outcome=?, workflow_updated_at=? WHERE id=?').run(outcome, time, node.id);
    }
    return outcome;
  }
  const root = byId.get(run.root_session_id);
  return root ? resolve(root) : null;
}
