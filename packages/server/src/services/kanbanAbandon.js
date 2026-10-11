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
 */
export async function abandonUndispatchedChild({ laneRunId, childSessionId, allocatedWorktree = null }) {
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
