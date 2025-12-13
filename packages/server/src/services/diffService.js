import * as gitService from './gitService.js';

/**
 * Get the combined diff (staged + unstaged) for a directory
 * @param {string} directory
 * @returns {Promise<{staged: string, unstaged: string}>}
 */
export async function getChanges(directory) {
  const [staged, unstaged] = await Promise.all([
    gitService.getStagedDiff(directory),
    gitService.getDiff(directory),
  ]);

  return { staged, unstaged };
}
