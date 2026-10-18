import { setupGitForSession } from './gitSessionSetup.js';
import { resolveCommitAttributionOverrideForModel } from './sessionProvider.js';
import * as gitService from './gitService.js';

export function throwIfAborted(controller) {
  if (controller?.signal.aborted) throw controller.signal.reason || new Error('Lane-entry delivery was aborted');
}

/**
 * Re-check the abort signal after git setup completed. Setup may have
 * allocated a worktree for a child that will now never run: release it before
 * the abort propagates, since no session row records it yet and nothing
 * downstream could clean it up (it would leak and pin its branch against the
 * resume retry).
 */
async function assertSetupNotAborted(project, gitSetup, gitOptions) {
  try {
    throwIfAborted(gitOptions.abortController);
  } catch (abortError) {
    if (gitSetup.gitWorktree) {
      try {
        await gitService.removeWorktree(project.workingDirectory, gitSetup.gitWorktree, true);
      } catch (error) {
        console.warn(`Kanban: Failed to remove worktree after aborted setup for session ${gitOptions.sessionId}:`, error.message);
      }
    }
    throw abortError;
  }
}

/**
 * Resolve the working directory for a lane-entry child. A redelivery reuses
 * its existing child's worktree (no fresh allocation); only a first delivery
 * allocates via determineWorkingDirectory, whose `allocatedWorktree` tracks
 * exactly what pause-abandon must release. Shared by both trigger paths so
 * allocation tracking cannot drift between template and prompt delivery.
 */
export function resolveTriggerWorkingDirectory(existingChild, parentSession, project, gitOptions) {
  if (existingChild?.gitWorktree) {
    return Promise.resolve({
      workingDirectory: existingChild.gitWorktree,
      gitWorktree: existingChild.gitWorktree,
      allocatedWorktree: null,
    });
  }
  return determineWorkingDirectory(parentSession, project, gitOptions);
}

/**
 * Determine working directory for child session, inheriting parent's worktree if present.
 * `allocatedWorktree` is the worktree path freshly allocated for this child
 * (null when inheriting the parent's, sharing the project directory, or when
 * no git isolation applies) so pause-abandon can release exactly what setup
 * created without touching shared state.
 * @param {Object} parentSession
 * @param {Object} project
 * @param {Object} [gitOptions]
 * @param {string} [gitOptions.gitMode]
 * @param {string} [gitOptions.gitBranch]
 * @param {string} [gitOptions.sessionId]
 * @returns {Promise<{workingDirectory: string, gitWorktree: string|null, allocatedWorktree: string|null}>}
 */
export async function determineWorkingDirectory(parentSession, project, gitOptions = {}) {
  throwIfAborted(gitOptions.abortController);
  if (parentSession.gitWorktree) {
    console.log(`Kanban: Inheriting parent worktree: ${parentSession.gitWorktree}`);
    return { workingDirectory: parentSession.gitWorktree, gitWorktree: parentSession.gitWorktree, allocatedWorktree: null };
  }

  if (gitOptions.sessionId) {
    const gitSetup = await setupGitForSession({
      projectDir: project.workingDirectory,
      gitMode: gitOptions.gitMode || null,
      gitBranch: gitOptions.gitBranch || null,
      sessionId: gitOptions.sessionId,
      worktreeBasePath: project.worktreePath || null,
      commitAttributionOverride: resolveCommitAttributionOverrideForModel(gitOptions.model),
    });
    await assertSetupNotAborted(project, gitSetup, gitOptions);
    return { workingDirectory: gitSetup.workingDirectory, gitWorktree: gitSetup.gitWorktree, allocatedWorktree: gitSetup.gitWorktree };
  }

  return { workingDirectory: project.workingDirectory, gitWorktree: null, allocatedWorktree: null };
}
