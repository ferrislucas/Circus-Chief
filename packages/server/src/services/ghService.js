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
 * Extract repository information from a PR URL
 * @param {string} prUrl - GitHub PR URL
 * @returns {Object|null} - { owner, repo, number } or null if invalid
 */
export function extractPrInfo(prUrl) {
  if (!prUrl) return null;

  try {
    // Match GitHub PR URL pattern: https://github.com/{owner}/{repo}/pull/{number}
    const match = prUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
    if (!match) return null;

    return {
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
    };
  } catch {
    return null;
  }
}

/**
 * Validate that a PR URL belongs to the expected repository
 * @param {string} prUrl - GitHub PR URL
 * @param {string} expectedRepoUrl - Expected repository URL (https://github.com/owner/repo)
 * @returns {Object} - { valid: boolean, mismatch: boolean, error: string|null }
 */
export function validatePrRepository(prUrl, expectedRepoUrl) {
  if (!prUrl) {
    return { valid: false, mismatch: false, error: 'No PR URL provided' };
  }

  const prInfo = extractPrInfo(prUrl);
  if (!prInfo) {
    return { valid: false, mismatch: false, error: 'Invalid PR URL format' };
  }

  // If no expected repo URL, we can't validate - accept it
  if (!expectedRepoUrl) {
    return { valid: true, mismatch: false, error: null };
  }

  // Extract owner/repo from expected repo URL
  const expectedMatch = expectedRepoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/);
  if (!expectedMatch) {
    return { valid: true, mismatch: false, error: null };
  }

  const expectedOwner = expectedMatch[1];
  const expectedRepo = expectedMatch[2];

  // Check if PR belongs to expected repository
  if (prInfo.owner !== expectedOwner || prInfo.repo !== expectedRepo) {
    return {
      valid: false,
      mismatch: true,
      error: `PR from ${prInfo.owner}/${prInfo.repo} does not match expected ${expectedOwner}/${expectedRepo}`
    };
  }

  return { valid: true, mismatch: false, error: null };
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
      `gh pr view "${prUrl}" --json state,mergedAt,mergeable,isDraft,title`
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
      merged: Boolean(data.mergedAt),
      hasMergeConflicts,
      ciStatus,
      ciFailures,
      title: data.title || null,
    };
  } catch (error) {
    console.warn('[ghService] Failed to get PR info:', error.message);
    return null;
  }
}
