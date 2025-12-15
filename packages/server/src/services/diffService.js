import * as gitService from './gitService.js';

/**
 * Get the combined diff (staged + unstaged + untracked) for a directory
 * @param {string} directory
 * @returns {Promise<{staged: string, unstaged: string, untracked: string[]}>}
 */
export async function getChanges(directory) {
  const [staged, unstaged, untracked] = await Promise.all([
    gitService.getStagedDiff(directory),
    gitService.getDiff(directory),
    gitService.getUntrackedFiles(directory),
  ]);

  return { staged, unstaged, untracked };
}
