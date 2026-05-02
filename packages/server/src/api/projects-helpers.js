import { generateWorktreeBranch } from '@circuschief/shared';
import { isGitRepo } from '../services/gitService.js';

/**
 * Validate and default git settings for git-backed projects.
 * If gitMode or gitBranch are missing for a git project, defaults are applied
 * instead of rejecting the request. Worktree sessions receive a generated branch
 * so they never try to check out an already-active branch such as main.
 * @param {Object} config - The session configuration
 * @param {Object} project - The project object
 * @returns {Promise<{config: Object, error: string|null}>} Updated config and error message if validation fails.
 */
export async function validateGitSettings(config, project) {
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

/**
 * Build a merged index of latest command runs per session.
 * Running commands from memory take precedence over completed DB runs.
 * @param {Array} dbRuns - Completed runs from the database
 * @param {Array} runningRuns - Currently running commands from memory
 * @returns {Object} sessionId -> { buttonId -> run }
 */
export function buildRunsBySession(dbRuns, runningRuns) {
  const runsBySession = {};
  for (const run of dbRuns) {
    if (!runsBySession[run.sessionId]) runsBySession[run.sessionId] = {};
    runsBySession[run.sessionId][run.buttonId] = {
      buttonId: run.buttonId, status: run.status, exitCode: run.exitCode,
      runId: run.id, startedAt: run.startedAt, completedAt: run.completedAt,
    };
  }
  for (const run of runningRuns) {
    if (!runsBySession[run.sessionId]) runsBySession[run.sessionId] = {};
    runsBySession[run.sessionId][run.buttonId] = {
      buttonId: run.buttonId, status: 'running', exitCode: null,
      runId: run.runId, startedAt: run.startedAt,
    };
  }
  return runsBySession;
}
