import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Cache gh availability check
let ghAvailable = null;

/**
 * Check if gh CLI is installed and authenticated
 * @returns {Promise<boolean>}
 */
export async function isGhAvailable() {
  if (ghAvailable !== null) return ghAvailable;
  try {
    await execAsync('gh --version');
    await execAsync('gh auth status');
    ghAvailable = true;
  } catch {
    ghAvailable = false;
  }
  return ghAvailable;
}

/**
 * Reset the gh availability cache (useful for testing)
 */
export function resetGhAvailableCache() {
  ghAvailable = null;
}

/**
 * Get comprehensive PR info including state, merge conflicts, and CI status
 * @param {string} prUrl - GitHub PR URL
 * @returns {Promise<Object|null>} PR info or null if unavailable
 */
export async function getPrInfo(prUrl) {
  if (!(await isGhAvailable())) return null;

  try {
    // First fetch basic PR info (this should always work)
    const { stdout: basicStdout } = await execAsync(
      `gh pr view "${prUrl}" --json state,mergedAt,mergeable,isDraft`
    );
    const data = JSON.parse(basicStdout);

    // Determine PR state
    let state = data.state.toLowerCase();
    if (data.mergedAt) state = 'merged';
    else if (data.isDraft) state = 'draft';

    // Check for merge conflicts
    // mergeable can be: 'MERGEABLE', 'CONFLICTING', 'UNKNOWN'
    const hasMergeConflicts = data.mergeable === 'CONFLICTING';

    // Try to fetch CI status separately (may fail due to token permissions)
    let ciStatus = null;
    let ciFailures = [];

    try {
      const { stdout: ciStdout } = await execAsync(
        `gh pr view "${prUrl}" --json statusCheckRollup`
      );
      const ciData = JSON.parse(ciStdout);
      const checks = ciData.statusCheckRollup || [];

      if (checks.length > 0) {
        // Get failed checks with their names
        const failedChecks = checks.filter(
          (c) => c.conclusion === 'FAILURE' || c.conclusion === 'TIMED_OUT'
        );
        ciFailures = failedChecks.map((c) => c.name || c.context || 'Unknown check');

        // Determine overall CI status
        const hasPending = checks.some(
          (c) => c.status === 'IN_PROGRESS' || c.status === 'QUEUED' || c.status === 'PENDING'
        );

        if (failedChecks.length > 0) {
          ciStatus = 'failure';
        } else if (hasPending) {
          ciStatus = 'pending';
        } else {
          ciStatus = 'success';
        }
      }
    } catch (ciError) {
      // CI status unavailable (likely token permissions) - continue without it
      console.warn('[ghService] CI status unavailable:', ciError.message);
    }

    return {
      state,
      merged: !!data.mergedAt,
      hasMergeConflicts,
      ciStatus,
      ciFailures,
    };
  } catch (error) {
    console.warn('[ghService] Failed to get PR info:', error.message);
    return null;
  }
}
