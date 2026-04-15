import { isGitRepo } from '../services/gitService.js';

/**
 * Validate and default git settings for git-backed projects.
 * If gitMode or gitBranch are missing for a git project, defaults are applied
 * (gitMode: 'none', gitBranch: 'main') instead of rejecting the request.
 * @param {Object} config - The session configuration
 * @param {Object} project - The project object
 * @returns {Promise<{config: Object, error: string|null}>} Updated config and error message if validation fails.
 */
export async function validateGitSettings(config, project) {
  if (!config.gitMode || !config.gitBranch) {
    const isGit = await isGitRepo(project.workingDirectory);
    if (isGit) {
      return {
        config: {
          ...config,
          gitMode: config.gitMode || 'none',
          gitBranch: config.gitBranch || 'main',
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
