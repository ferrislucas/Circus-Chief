import { commandRuns, sessions } from '../database.js';
import { commandRunner } from './commandRunner.js';

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
      hasOutput: run.hasOutput, outputHighWater: run.outputHighWater,
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

/**
 * Latest command runs (DB + in-memory) for an explicit, bounded set of sessions.
 * Views that render a page of cards use this instead of a project-wide scan so
 * the query cost follows what is actually on screen.
 * @param {string} projectId - Project the sessions belong to
 * @param {string[]} sessionIds - Sessions to index
 * @returns {Object} sessionId -> { buttonId -> run }
 */
export function latestCommandRunsBySession(projectId, sessionIds) {
  if (!sessionIds.length) return {};
  const wanted = new Set(sessionIds);
  return buildRunsBySession(
    commandRuns.getLatestRunsForSessions(sessionIds),
    commandRunner
      .getRunningByProjectId(projectId, (sessionId) => sessions.getById(sessionId))
      .filter((run) => wanted.has(run.sessionId)),
  );
}
