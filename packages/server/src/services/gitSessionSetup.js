import { join } from 'path';
import * as gitService from './gitService.js';

/**
 * Setup git environment for a session based on git mode
 * @param {Object} options
 * @param {string} options.projectDir - Project working directory
 * @param {string|null} options.gitMode - 'branch', 'worktree', or null
 * @param {string|null} options.gitBranch - Branch name
 * @param {string} options.sessionId - Session ID
 * @returns {Promise<{workingDirectory: string, gitWorktree: string|null, effectiveGitMode: string|null}>}
 */
export async function setupGitForSession({ projectDir, gitMode, gitBranch, sessionId }) {
  // No git operations if no branch specified
  if (!gitBranch) {
    return {
      workingDirectory: projectDir,
      gitWorktree: null,
      effectiveGitMode: null,
    };
  }

  // Default to worktree mode when branch is specified but mode is not
  // Worktree mode provides proper isolation for concurrent sessions
  const effectiveGitMode = gitMode || 'worktree';

  if (effectiveGitMode === 'branch') {
    // Checkout (or create) the branch in the project directory
    // WARNING: This mode shares the main repo directory and is not safe for concurrent sessions
    await gitService.checkoutBranch(projectDir, gitBranch);
    return {
      workingDirectory: projectDir,
      gitWorktree: null,
      effectiveGitMode: 'branch',
    };
  }

  if (effectiveGitMode === 'worktree') {
    // Create a worktree in .worktrees/{sessionId}
    const worktreePath = join(projectDir, '.worktrees', sessionId);
    await gitService.createWorktreeForBranch(projectDir, gitBranch, worktreePath);
    return {
      workingDirectory: worktreePath,
      gitWorktree: worktreePath,
      effectiveGitMode: 'worktree',
    };
  }

  // Unknown git mode, fallback to project directory
  return {
    workingDirectory: projectDir,
    gitWorktree: null,
    effectiveGitMode: null,
  };
}
