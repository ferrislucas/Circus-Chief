import { isGitRepo } from '../services/gitService.js';

/**
 * Validate and default git settings for git-backed projects.
 * If gitMode or gitBranch are missing for a git project, defaults are applied
 * (gitMode: 'none', gitBranch: 'main') instead of rejecting the request.
 * @param {Object} config - The session configuration (mutated in place)
 * @param {Object} project - The project object
 * @returns {Promise<string|null>} Error message if validation fails, null otherwise.
 */
export async function validateGitSettings(config, project) {
  if (!config.gitMode || !config.gitBranch) {
    const isGit = await isGitRepo(project.workingDirectory);
    if (isGit) {
      if (!config.gitMode) config.gitMode = 'none';
      if (!config.gitBranch) config.gitBranch = 'main';
    }
  }
  return null;
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
