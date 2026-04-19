import { join } from 'path';
import * as gitService from './gitService.js';

/**
 * Setup git environment for a session based on git mode
 * @param {Object} options
 * @param {string} options.projectDir - Project working directory
 * @param {string|null} options.gitMode - 'branch', 'worktree', or null
 * @param {string|null} options.gitBranch - Branch name
 * @param {string} options.sessionId - Session ID
 * @param {string|null} [options.worktreeBasePath] - Custom base path for worktrees (overrides default .worktrees)
 * @returns {Promise<{workingDirectory: string, gitWorktree: string|null}>}
 */
export async function setupGitForSession({ projectDir, gitMode, gitBranch, sessionId, worktreeBasePath }) {
  // No git operations if gitMode is not specified
  if (!gitMode || !gitBranch) {
    return {
      workingDirectory: projectDir,
      gitWorktree: null,
    };
  }

  if (gitMode === 'branch') {
    // Checkout (or create) the branch in the project directory
    await gitService.checkoutBranch(projectDir, gitBranch);
    return {
      workingDirectory: projectDir,
      gitWorktree: null,
    };
  }

  if (gitMode === 'worktree') {
    // Create a worktree in the configured base path or .worktrees/{sessionId}
    const worktreePath = join(worktreeBasePath || join(projectDir, '.worktrees'), sessionId);
    await gitService.createWorktreeForBranch(projectDir, gitBranch, worktreePath);
    // Pin the human developer's git identity so they are the commit Author
    await gitService.pinAuthorInWorktree(worktreePath, projectDir);
    return {
      workingDirectory: worktreePath,
      gitWorktree: worktreePath,
    };
  }

  // Unknown git mode, fallback to project directory
  return {
    workingDirectory: projectDir,
    gitWorktree: null,
  };
}
