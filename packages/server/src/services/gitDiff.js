import { git } from './gitService.js';

/**
 * Get diff for a directory
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function getDiff(directory) {
  return git(directory, 'diff');
}

/**
 * Get staged diff for a directory
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function getStagedDiff(directory) {
  return git(directory, 'diff --cached');
}

/**
 * Get list of untracked files
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
export async function getUntrackedFiles(directory) {
  try {
    const output = await git(directory, 'ls-files --others --exclude-standard');
    if (!output) return [];
    return output.split('\n').filter((line) => line.trim());
  } catch (error) {
    console.warn(`Failed to get untracked files for ${directory}:`, error.message);
    return [];
  }
}

/**
 * Get diff for a directory compared to a specific branch
 * @param {string} directory
 * @param {string} branch - Branch to compare against (e.g., 'origin/main')
 * @returns {Promise<string>}
 */
export async function getDiffAgainstBranch(directory, branch) {
  return git(directory, `diff ${branch}`);
}

/**
 * Get staged diff for a directory compared to a specific branch
 * @param {string} directory
 * @param {string} branch - Branch to compare against (e.g., 'origin/main')
 * @returns {Promise<string>}
 */
export async function getStagedDiffAgainstBranch(directory, branch) {
  return git(directory, `diff --cached ${branch}`);
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
  return git(directory, `diff ${fromRef} ${toRef}`);
}

function addGitPathOutput(files, output) {
  if (!output) return;

  output.split('\n').forEach((file) => {
    const trimmed = file.trim();
    if (trimmed) files.add(trimmed);
  });
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
    const committed = await git(
      directory,
      `diff --name-only ${branch}...HEAD`
    );

    const staged = await git(directory, 'diff --cached --name-only');
    const unstaged = await git(directory, 'diff --name-only');
    const untracked = await getUntrackedFiles(directory);

    const allFiles = new Set();
    addGitPathOutput(allFiles, committed);
    addGitPathOutput(allFiles, staged);
    addGitPathOutput(allFiles, unstaged);
    untracked.forEach((file) => allFiles.add(file));

    return allFiles.size;
  } catch (error) {
    console.warn(`Failed to get modified files count for ${directory}:`, error.message);
    return 0;
  }
}
