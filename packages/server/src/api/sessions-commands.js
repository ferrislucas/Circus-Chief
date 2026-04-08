import { Router } from 'express';
import { commandButtons, commandRuns } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import { commandRunner } from '../services/commandRunner.js';
import { databaseManager } from '../db/DatabaseManager.js';

const router = Router();

/**
 * Broadcast command output to session and project subscribers.
 * @param {{ sessionId: string, projectId: string, runId: string, buttonId: string }} ctx - Context
 * @param {string} output - Output text
 */
function broadcastCommandOutput(ctx, output) {
  const { sessionId, projectId, runId, buttonId } = ctx;
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, { sessionId, runId, buttonId, output });
  broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, { projectId, sessionId, runId, buttonId, output });
}

/**
 * Broadcast command completion to session and project subscribers.
 * @param {{ sessionId: string, projectId: string, runId: string, buttonId: string }} ctx - Context
 * @param {{ exitCode: number, output: string }} result - Completion result
 */
function broadcastCommandComplete(ctx, result) {
  const { sessionId, projectId, runId, buttonId } = ctx;
  const { exitCode, output } = result;
  const status = exitCode === 0 ? 'success' : 'error';
  console.log(`[RUN] Command completed for runId: ${runId}, exitCode: ${exitCode}, status: ${status}`);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, { sessionId, runId, buttonId, status, exitCode, output });
  console.log(`[RUN] Broadcasting COMMAND_RUN_COMPLETE to project ${projectId}`);
  broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, { projectId, sessionId, runId, buttonId, status, exitCode, output });
}

/**
 * Broadcast command error to session and project subscribers.
 * @param {{ sessionId: string, projectId: string, runId: string, buttonId: string }} ctx - Context
 * @param {string} errorMessage - Error message
 */
function broadcastCommandError(ctx, errorMessage) {
  const { sessionId, projectId, runId, buttonId } = ctx;
  console.log(`[RUN] Error for runId: ${runId}: ${errorMessage}`);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, { sessionId, runId, buttonId, error: errorMessage });
  broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, { projectId, sessionId, runId, buttonId, error: errorMessage });
}

// POST /api/sessions/:id/command-buttons/:buttonId/run - Execute button command
router.post('/:id/command-buttons/:buttonId/run', requireSessionAndProject, (req, res) => {
  const sessionId = req.params.id;
  const buttonId = req.params.buttonId;

  console.log(`[RUN] Starting command for buttonId: ${buttonId}, sessionId: ${sessionId}`);

  const button = commandButtons.getById(buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }

  // Generate run ID
  const runId = databaseManager.generateId();

  console.log(`[RUN] Generated runId: ${runId} for command: ${button.command}`);

  // Return immediately with runId
  res.json({ runId, buttonId, status: 'running', output: '' });

  // Capture middleware values for use in async callbacks
  const projectId = req.session_.projectId;
  const workingDirectory = req.workingDirectory;
  const ctx = { sessionId, projectId, runId, buttonId };

  // Broadcast initial "running" status immediately so session list can show the running indicator
  broadcastCommandOutput(ctx, '');

  // Execute command asynchronously
  (async () => {
    try {
      console.log(`[RUN] Starting async execution for runId: ${runId}`);
      await commandRunner.run(
        { runId, command: button.command, workingDirectory },
        {
          onOutput: (text) => {
            console.log(`[RUN] Output received for runId: ${runId}`);
            broadcastCommandOutput(ctx, text);
          },
          onComplete: (exitCode, output) => broadcastCommandComplete(ctx, { exitCode, output }),
          onError: (message) => broadcastCommandError(ctx, message),
        },
        { sessionId, buttonId }
      );
    } catch (error) {
      console.error(`Error running command button ${buttonId}:`, error);
      broadcastCommandError(ctx, error.message);
    }
  })();
});

// GET /api/sessions/:id/command-buttons/runs - Get active runs for session
router.get('/:id/command-buttons/runs', requireSession, (req, res) => {
  const sessionId = req.params.id;

  const activeRuns = commandRunner.getRunsBySession(sessionId);
  res.json(activeRuns);
});

// GET /api/sessions/:id/command-buttons/runs/:runId - Get single run by ID
router.get('/:id/command-buttons/runs/:runId', requireSession, (req, res) => {
  const { id: sessionId, runId } = req.params;

  // Check if run is currently running (in memory)
  if (commandRunner.isRunning(runId)) {
    const activeRuns = commandRunner.getRunsBySession(sessionId);
    const run = activeRuns.find((r) => r.runId === runId);
    if (run) {
      return res.json(run);
    }
  }

  // Otherwise check database
  const run = commandRuns.getById(runId);
  if (!run || run.sessionId !== sessionId) {
    return res.status(404).json({ error: 'Run not found' });
  }

  res.json({
    runId: run.id,
    buttonId: run.buttonId,
    status: run.status,
    output: run.output,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  });
});

// DELETE /api/sessions/:id/command-buttons/runs/:runId - Delete a command run record
router.delete('/:id/command-buttons/runs/:runId', requireSessionAndProject, (req, res) => {
  const sessionId = req.params.id;
  const { runId } = req.params;

  const run = commandRuns.getById(runId);
  if (!run || run.sessionId !== sessionId) {
    return res.status(404).json({ error: 'Run not found' });
  }

  if (commandRunner.isRunning(runId)) {
    return res.status(409).json({ error: 'Cannot delete a running command. Kill it first.' });
  }

  commandRuns.deleteById(runId);

  const projectId = req.session_.projectId;

  // Broadcast deletion to session and project subscribers
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, {
    runId,
    buttonId: run.buttonId,
    sessionId,
  });
  broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, {
    runId,
    buttonId: run.buttonId,
    sessionId,
    projectId,
  });

  res.status(204).send();
});

// DELETE /api/sessions/:id/command-buttons/:buttonId/runs/all - Delete all runs for a button in a session
router.delete('/:id/command-buttons/:buttonId/runs/all', requireSessionAndProject, (req, res) => {
  const sessionId = req.params.id;
  const { buttonId } = req.params;

  const button = commandButtons.getById(buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }

  const { deletedRuns } = commandRuns.deleteByButtonAndSession(buttonId, sessionId);

  const projectId = req.session_.projectId;

  // Broadcast individual COMMAND_RUN_DELETED events for each deleted run
  for (const run of deletedRuns) {
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, {
      runId: run.id,
      buttonId: run.buttonId,
      sessionId,
    });
    broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, {
      runId: run.id,
      buttonId: run.buttonId,
      sessionId,
      projectId,
    });
  }

  res.status(204).send();
});

// POST /api/sessions/:id/command-buttons/runs/:runId/kill - Kill running command
router.post('/:id/command-buttons/runs/:runId/kill', requireSession, (req, res) => {
  const sessionId = req.params.id;
  const runId = req.params.runId;

  console.log(`[KILL] Kill request for runId: ${runId}, sessionId: ${sessionId}`);

  const killed = commandRunner.kill(runId);
  console.log(`[KILL] Kill result: ${killed} for runId: ${runId}`);
  if (!killed) {
    return res.status(404).json({ error: 'Run not found or already completed' });
  }

  res.json({ success: true, runId });
});

export default router;
