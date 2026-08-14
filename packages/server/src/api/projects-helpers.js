import { generateWorktreeBranch } from '@circuschief/shared';
import { isGitRepo } from '../services/gitService.js';

/**
 * Validate and default git settings for git-backed projects.
 * If gitMode or gitBranch are missing for a git project, defaults are applied
 * instead of rejecting the request. Worktree sessions receive a generated branch
 * so they never try to check out an already-active branch such as main.
 * Current-mode sessions skip branch generation entirely.
 * @param {Object} config - The session configuration
 * @param {Object} project - The project object
 * @returns {Promise<{config: Object, error: string|null}>} Updated config and error message if validation fails.
 */
export async function validateGitSettings(config, project) {
  // Current mode: no branch needed, pass through as-is
  if (config.gitMode === 'current') {
    return {
      config: {
        ...config,
        gitBranch: null,
      },
      error: null,
    };
  }

  if (!config.gitMode || !config.gitBranch) {
    const isGit = await isGitRepo(project.workingDirectory);
    if (isGit) {
      const gitMode = config.gitMode || 'none';
      return {
        config: {
          ...config,
          gitMode,
          gitBranch: config.gitBranch || (gitMode === 'worktree'
            ? generateWorktreeBranch(config.name, config.prompt)
            : 'main'),
        },
        error: null,
      };
    }
  }
  return { config, error: null };
}

