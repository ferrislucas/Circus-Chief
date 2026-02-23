import { exec } from 'child_process';
import { promisify } from 'util';
import { getLogger } from './gitService.js';

const execAsync = promisify(exec);

/**
 * Execute a git command in a directory
 * @param {string} directory
 * @param {string} command
 * @returns {Promise<string>}
 */
async function git(directory, command) {
  const { stdout } = await execAsync(`git ${command}`, { cwd: directory });
  return stdout.trim();
}

/**
 * Check if a directory is a git repository
 * @param {string} directory
 * @returns {Promise<boolean>}
 */
export async function isGitRepo(directory) {
  try {
    await git(directory, 'rev-parse --git-dir');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get diff for a directory
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function getDiff(directory) {
  try {
    return await git(directory, 'diff');
  } catch {
    return '';
  }
}

/**
 * Get staged diff for a directory
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function getStagedDiff(directory) {
  try {
    return await git(directory, 'diff --cached');
  } catch {
    return '';
  }
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
  } catch {
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
  try {
    return await git(directory, `diff ${branch}`);
  } catch {
    return '';
  }
}

/**
 * Get staged diff for a directory compared to a specific branch
 * @param {string} directory
 * @param {string} branch - Branch to compare against (e.g., 'origin/main')
 * @returns {Promise<string>}
 */
export async function getStagedDiffAgainstBranch(directory, branch) {
  try {
    return await git(directory, `diff --cached ${branch}`);
  } catch {
    return '';
  }
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
  try {
    return await git(directory, `diff ${fromRef} ${toRef}`);
  } catch {
    return '';
  }
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

    // Parse committed+staged files
    if (committedAndStaged) {
      committedAndStaged.split('\n').forEach(f => {
        if (f.trim()) allFiles.add(f.trim());
      });
    }

    // Parse unstaged files
    if (unstaged) {
      unstaged.split('\n').forEach(f => {
        if (f.trim()) allFiles.add(f.trim());
      });
    }

    // Add untracked files
    untracked.forEach(f => allFiles.add(f));

    return allFiles.size;
  } catch (error) {
    const logger = getLogger();
    logger.warn(`Failed to get modified files count for ${directory}:`, error.message);
    return 0;
  }
}
