import { git } from './gitService.js';

/**
 * Get diff for a directory
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function getDiff(directory) {
  return await git(directory, 'diff');
}

/**
 * Get staged diff for a directory
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function getStagedDiff(directory) {
  return await git(directory, 'diff --cached');
}

/**
 * Get list of untracked files
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
export async function getUntrackedFiles(directory) {
  const output = await git(directory, 'ls-files --others --exclude-standard');
  if (!output) return [];
  return output.split('\n').filter((line) => line.trim());
}

/**
 * Get diff for a directory compared to a specific branch
 * @param {string} directory
 * @param {string} branch - Branch to compare against (e.g., 'origin/main')
 * @returns {Promise<string>}
 */
export async function getDiffAgainstBranch(directory, branch) {
  return await git(directory, `diff ${branch}`);
}

/**
 * Get staged diff for a directory compared to a specific branch
 * @param {string} directory
 * @param {string} branch - Branch to compare against (e.g., 'origin/main')
 * @returns {Promise<string>}
 */
export async function getStagedDiffAgainstBranch(directory, branch) {
  return await git(directory, `diff --cached ${branch}`);
}

/**
 * Get diff between two git refs (e.g., comparing HEAD to origin/main)
 * This shows the committed changes between two refs, ignoring working tree state
 * @param {string} directory
 * @param {string} fromRef - Base ref (e.g., 'origin/main')
 * @param {string} toRef - Target ref (e.g., 'HEAD')
 * @returns {Promise<string>}
 */
export async function getDiffBetweenRefs(directory, fromRef, toRef) {
  return await git(directory, `diff ${fromRef} ${toRef}`);
}

/**
 * Get count of files modified/added compared to a branch
 * Includes committed changes + staged + unstaged + untracked files
 * @param {string} directory - The git repository directory
 * @param {string} branch - Branch to compare against (e.g., 'origin/main')
 * @returns {Promise<number>} - Total count of unique files modified/added
 */
export async function getModifiedFilesCount(directory, branch) {
  try {
    // Get all modified files in one command using --name-only
    // This includes: committed changes vs branch + staged
    const committedAndStaged = await git(
      directory,
      `diff --name-only ${branch}...HEAD`
    );

    // Get unstaged changes (working tree vs index)
    const unstaged = await git(directory, 'diff --name-only');

    // Get untracked files
    const untracked = await getUntrackedFiles(directory);

    // Combine all files into a Set to get unique count
    const allFiles = new Set();

    if (committedAndStaged) {
      committedAndStaged.split('\n').forEach(f => {
        if (f.trim()) allFiles.add(f.trim());
      });
    }

    if (unstaged) {
      unstaged.split('\n').forEach(f => {
        if (f.trim()) allFiles.add(f.trim());
      });
    }

    untracked.forEach(f => allFiles.add(f));

    return allFiles.size;
  } catch (error) {
    console.warn(`Failed to get modified files count for ${directory}:`, error.message);
    return 0;
  }
}
