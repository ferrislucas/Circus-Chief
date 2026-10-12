import {
  sessions,
  projects,
  databaseManager,
} from '../database.js';
import { broadcastToProject, broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { cleanupActiveSession } from './sessionManager.js';
import { cleanupSession as cleanupSummarySession } from './summaryService.js';
import * as gitService from './gitService.js';

/**
 * Best-effort release of a worktree allocated for a child that will never
 * run. Never touches inherited/shared worktrees: only the explicitly tracked
 * allocation for this child, or a persisted worktree that differs from the
 * parent's, is removed. Never throws — abandonment must always park cleanly.
 */
async function releaseAbandonedChildWorktree(child, allocatedWorktree) {
  let worktreeToRelease = allocatedWorktree || null;
  if (!worktreeToRelease && child.gitWorktree) {
    const parent = child.parentSessionId ? sessions.getById(child.parentSessionId) : null;
    if (child.gitWorktree !== parent?.gitWorktree) worktreeToRelease = child.gitWorktree;
  }
  if (!worktreeToRelease) return;
  try {
    const project = projects.getById(child.projectId);
    if (project?.workingDirectory) {
      await gitService.removeWorktree(project.workingDirectory, worktreeToRelease, true);
    }
  } catch (error) {
    console.warn(`Kanban: Failed to remove abandoned worktree for session ${child.id}:`, error.message);
  }
}

/**
 * Drop a child created but never dispatched because its lane was disabled
 * mid-setup. Restores the owning run to rootless so the parked entry keeps
 * the durable paused shape (open run, no root, card pointers intact).
 *
 * The removal mirrors the session-deletion notifications: clients that
 * already observed SESSION_CREATED (or running state) get SESSION_DELETED on
 * both the project channel and the per-session channel, so no phantom
 * session lingers without a reload. A worktree allocated for this child is
 * released so re-enable can dispatch cleanly; inherited/shared worktrees are
 * preserved. Missing children are a no-op (double-abandon emits once).
 *
 * With `preserveChild`, a redelivery's reused child is kept instead: the
 * child and its root attachment stay in place for resume, so re-enable reuses
 * the same child rather than leaking it and allocating another. Only a fresh
 * allocation from this attempt that never attached to the child is released
 * (an attached worktree is legitimately reused by the survivor). No deletion,
 * no notifications, and the run root is never cleared.
 */

/**
 * Pause/resume durability contract (PR #1166 issue 10; FR-3/FR-4/AC-5).
 *
 * A retry paused mid-setup keeps its child and run root for resume
 * (`preserveChild`). The preserved child MUST rest in a durable non-executing
 * state: status/execution_state settled, with its open obligation, lane_run
 * attachment, and worktree retained. This shape is what makes pause survive a
 * restart:
 * - boot recovery (`recoverOrphanedStartingSessions` /
 *   `recoverOrphanedRunningSessions`, which run before Kanban preflight)
 *   collects only `starting`/`running` rows, so a settled child is left
 *   alone instead of being closed as an orphaned startup;
 * - Kanban preflight preserves the open rooted run (pointers intact, root
 *   tree unambiguous), and re-enable redelivery reuses the same child
 *   exactly once.
 *
 * The provider-fence rejection in `sessionExecution` durably clears executing
 * state on its way out; this settle is the ownership-fenced convergence point
 * both pause paths meet at. Never settle a child whose obligation already
 * closed or whose run no longer owns it — that row belongs to boot recovery.
 */
/**
 * Best-effort SESSION_UPDATED for a preserved paused child. Never throws —
 * abandonment must always park cleanly even when no subscriber is listening.
 */
function broadcastPreservedChildSettled(projectId, childSessionId, session) {
  try {
    broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId,
      sessionId: childSessionId,
      session,
    });
  } catch {
    // Best-effort; the durable pause state is already correct.
  }
}

export function settlePreservedChildForPause({ laneRunId, childSessionId }) {
  if (!laneRunId || !childSessionId) return;
  const db = databaseManager.get();
  const child = db.prepare(`SELECT id, project_id, lane_run_id, own_work_state, status, execution_state
    FROM sessions WHERE id=?`).get(childSessionId);
  if (!child) return;
  // Ownership fences: only settle a child still attached to this OPEN run
  // with an open obligation.
  if (child.lane_run_id !== laneRunId || child.own_work_state !== 'open') return;
  const run = db.prepare('SELECT status FROM kanban_lane_runs WHERE id=?').get(laneRunId);
  if (!run || run.status !== 'open') return;
  // Only executing states need settling; an already-idle child is already
  // invisible to boot recovery and keeps its row untouched. Subscribers that
  // saw the earlier running state still need the settled lifecycle, though:
  // the provider fence may have durably parked this child on its way out, so
  // notify even when no second write is needed (PR #1166 issue 11).
  if (child.status !== 'starting' && child.status !== 'running' && child.execution_state !== 'running') {
    broadcastPreservedChildSettled(child.project_id, childSessionId, sessions.getById(childSessionId));
    return;
  }
  const updated = sessions.update(childSessionId, { status: 'stopped', executionState: 'stopped' });
  broadcastPreservedChildSettled(child.project_id, childSessionId, updated);
}

export async function abandonUndispatchedChild({ laneRunId, childSessionId, allocatedWorktree = null, preserveChild = false }) {
  if (preserveChild) {
    await releaseUnattachedRetryAllocation(childSessionId, allocatedWorktree);
    settlePreservedChildForPause({ laneRunId, childSessionId });
    return;
  }
  if (childSessionId) {
    const child = sessions.getById(childSessionId);
    if (child) {
      const projectId = child.projectId;
      await releaseAbandonedChildWorktree(child, allocatedWorktree);
      // Per-session cleanup applicable to an undispatched child. Attachments
      // cannot exist yet (nothing could be uploaded before dispatch), so only
      // active-execution and summary state plus deletion notifications apply.
      try {
        cleanupActiveSession(childSessionId);
      } catch {
        // Best-effort; abandonment must still park the entry.
      }
      try {
        cleanupSummarySession(childSessionId);
      } catch {
        // Best-effort; abandonment must still park the entry.
      }
      broadcastToSession(childSessionId, WS_MESSAGE_TYPES.SESSION_DELETED, { sessionId: childSessionId });
      try {
        sessions.delete(childSessionId);
      } catch {
        // The child may already be gone; the notifications above still apply.
      }
      broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_DELETED, {
        projectId,
        sessionId: childSessionId,
      });
    }
  }
  if (laneRunId) {
    databaseManager.get().prepare('UPDATE kanban_lane_runs SET root_session_id=NULL, updated_at=? WHERE id=?')
      .run(Date.now(), laneRunId);
  }
}

/**
 * Pause policy shared by the template and prompt trigger paths. A redelivery
 * reuses its existing child: preserve the child/root together for resume.
 * Only a first delivery abandons the child it just created.
 */
export async function abandonPausedTriggerChild({ laneRunId, childSessionId, createdChildId, allocatedWorktree }) {
  if (childSessionId) {
    await abandonUndispatchedChild({ laneRunId, childSessionId, allocatedWorktree, preserveChild: true });
  } else {
    await abandonUndispatchedChild({ laneRunId, childSessionId: createdChildId, allocatedWorktree });
  }
}

/**
 * Release a retry attempt's fresh worktree allocation when it never attached
 * to the preserved child. An attached worktree is legitimately reused by the
 * survivor and must stay.
 */
async function releaseUnattachedRetryAllocation(childSessionId, allocatedWorktree) {
  if (!childSessionId || !allocatedWorktree) return;
  const child = sessions.getById(childSessionId);
  if (child && child.gitWorktree !== allocatedWorktree) {
    await releaseAbandonedChildWorktree(child, allocatedWorktree);
  }
}
