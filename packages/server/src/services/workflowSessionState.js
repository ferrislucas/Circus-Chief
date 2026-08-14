import { databaseManager } from '../db/DatabaseManager.js';

const now = () => Date.now();

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
  const members = db.prepare('SELECT id, parent_session_id, own_work_state, subtree_outcome FROM sessions WHERE lane_run_id=?').all(runId);
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
    const outcome = computeSubtreeOutcome(node.own_work_state, childOutcomes);
    computed.set(node.id, outcome);
    if (outcome !== node.subtree_outcome) {
      db.prepare('UPDATE sessions SET subtree_outcome=?, workflow_updated_at=? WHERE id=?').run(outcome, time, node.id);
    }
    return outcome;
  }
  const root = byId.get(run.root_session_id);
  return root ? resolve(root) : null;
}
