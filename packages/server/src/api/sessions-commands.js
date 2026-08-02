import { Router } from 'express';
import { commandButtons, commandRuns } from '../database.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { requireRootSessionAndProject } from '../middleware/sessionLookup.js';
import { commandRunner } from '../services/commandRunner.js';
import { databaseManager } from '../db/DatabaseManager.js';
import { broadcastCommandEvent, broadcastCommandOutput } from './commandEventBroadcast.js';

// Error message constants
const ERR_BUTTON_NOT_FOUND = 'Circus Command not found';

const router = Router();

/**
 * Broadcast command output to session and project subscribers.
 * @param {{ sessionId: string, projectId: string, runId: string, buttonId: string }} ctx - Context
 * @param {string} output - Output text
 */
/**
 * Broadcast command completion to session and project subscribers.
 * @param {{ sessionId: string, projectId: string, runId: string, buttonId: string }} ctx - Context
 * @param {{ exitCode: number, output: string }} result - Completion result
 */
function broadcastCommandComplete(ctx, result) {
  const { sessionId, projectId, runId, buttonId } = ctx;
  const { exitCode } = result;
  const status = exitCode === 0 ? 'success' : 'error';
  console.log(`[RUN] Command completed for runId: ${runId}, exitCode: ${exitCode}, status: ${status}`);
  broadcastCommandEvent(sessionId, projectId, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, { runId, buttonId, status, exitCode });
}

/**
 * Broadcast command error to session and project subscribers.
 * @param {{ sessionId: string, projectId: string, runId: string, buttonId: string }} ctx - Context
 * @param {string} errorMessage - Error message
 */
function broadcastCommandError(ctx, errorMessage) {
  const { sessionId, projectId, runId, buttonId } = ctx;
  console.log(`[RUN] Error for runId: ${runId}: ${errorMessage}`);
  broadcastCommandEvent(sessionId, projectId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, { runId, buttonId, error: errorMessage });
}

// GET /api/sessions/:id/circus-commands - List command buttons for the workflow project
router.get('/:id/circus-commands', requireRootSessionAndProject, (req, res) => {
  res.json(commandButtons.getByProjectId(req.rootSession_.projectId));
});

// POST /api/sessions/:id/circus-commands/:buttonId/run - Execute button command
router.post('/:id/circus-commands/:buttonId/run', requireRootSessionAndProject, (req, res) => {
  const sessionId = req.rootSessionId;
  const buttonId = req.params.buttonId;

  console.log(`[RUN] Starting command for buttonId: ${buttonId}, sessionId: ${sessionId}`);

  const button = commandButtons.getById(buttonId);
  if (!button) {
    return res.status(404).json({ error: ERR_BUTTON_NOT_FOUND });
  }
  if (button.projectId !== req.rootSession_.projectId) {
    return res.status(404).json({ error: ERR_BUTTON_NOT_FOUND });
  }

  // Generate run ID
  const runId = databaseManager.generateId();

  console.log(`[RUN] Generated runId: ${runId} for command: ${button.command}`);

  // Return immediately with runId
  res.json({ runId, buttonId, status: 'running' });

  // Capture middleware values for use in async callbacks
  const projectId = req.rootSession_.projectId;
  const workingDirectory = req.rootWorkingDirectory;
  const ctx = { sessionId, projectId, runId, buttonId };

  // Execute command asynchronously
  (async () => {
    try {
      console.log(`[RUN] Starting async execution for runId: ${runId}`);
      await commandRunner.run(
        { runId, command: button.command, workingDirectory },
        {
          onStarted: () => broadcastCommandEvent(sessionId, projectId, WS_MESSAGE_TYPES.COMMAND_RUN_STARTED, { runId, buttonId, status: 'running' }),
          onOutputChunk: (chunk) => {
            broadcastCommandOutput(runId, chunk);
          },
          onComplete: (exitCode) => broadcastCommandComplete(ctx, { exitCode }),
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

// GET /api/sessions/:id/circus-commands/runs - Get active runs for session
router.get('/:id/circus-commands/runs', requireRootSessionAndProject, (req, res) => {
  const sessionId = req.rootSessionId;

  const activeRuns = commandRunner.getRunsBySession(sessionId);
  res.json(activeRuns);
});

// GET /api/sessions/:id/circus-commands/runs/:runId - Get single run by ID
router.get('/:id/circus-commands/runs/:runId', requireRootSessionAndProject, (req, res) => {
  const { runId } = req.params;
  const sessionId = req.rootSessionId;

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
    hasOutput: run.hasOutput,
    outputHighWater: run.outputHighWater,
    exitCode: run.exitCode,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  });
});

router.get('/:id/circus-commands/runs/:runId/output', requireRootSessionAndProject, (req, res) => {
  const { runId } = req.params;
  const run = commandRuns.getById(runId);
  if (!run || run.sessionId !== req.rootSessionId) return res.status(404).json({ error: 'Run not found' });
  const page = commandRuns.readAfter(runId, req.query.after, req.query.limitBytes);
  res.json({ ...page, after: Number(req.query.after) || 0 });
});

// DELETE /api/sessions/:id/circus-commands/runs/:runId - Delete a command run record
router.delete('/:id/circus-commands/runs/:runId', requireRootSessionAndProject, (req, res) => {
  const sessionId = req.rootSessionId;
  const { runId } = req.params;

  const run = commandRuns.getById(runId);
  if (!run || run.sessionId !== sessionId) {
    return res.status(404).json({ error: 'Run not found' });
  }

  if (commandRunner.isRunning(runId)) {
    return res.status(409).json({ error: 'Cannot delete a running command. Kill it first.' });
  }

  commandRuns.deleteById(runId);

  const projectId = req.rootSession_.projectId;

  // Broadcast deletion to session and project subscribers
  broadcastCommandEvent(sessionId, projectId, WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, { runId, buttonId: run.buttonId });

  res.status(204).send();
});

// DELETE /api/sessions/:id/circus-commands/:buttonId/runs/all - Delete all runs for a button in a session
router.delete('/:id/circus-commands/:buttonId/runs/all', requireRootSessionAndProject, (req, res) => {
  const sessionId = req.rootSessionId;
  const { buttonId } = req.params;

  const button = commandButtons.getById(buttonId);
  if (!button) {
    return res.status(404).json({ error: ERR_BUTTON_NOT_FOUND });
  }
  if (button.projectId !== req.rootSession_.projectId) {
    return res.status(404).json({ error: ERR_BUTTON_NOT_FOUND });
  }

  const { deletedRuns } = commandRuns.deleteByButtonAndSession(buttonId, sessionId);

  const projectId = req.rootSession_.projectId;

  // Broadcast individual COMMAND_RUN_DELETED events for each deleted run
  for (const run of deletedRuns) {
    broadcastCommandEvent(sessionId, projectId, WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, { runId: run.id, buttonId: run.buttonId });
  }

  res.status(204).send();
});

// POST /api/sessions/:id/circus-commands/runs/:runId/kill - Kill running command
router.post('/:id/circus-commands/runs/:runId/kill', requireRootSessionAndProject, (req, res) => {
  const sessionId = req.rootSessionId;
  const runId = req.params.runId;

  console.log(`[KILL] Kill request for runId: ${runId}, sessionId: ${sessionId}`);

  const activeRuns = commandRunner.getRunsBySession(sessionId);
  const activeRun = activeRuns.find((run) => run.runId === runId);
  if (!activeRun) {
    return res.status(404).json({ error: 'Run not found or already completed' });
  }

  const killed = commandRunner.kill(runId);
  console.log(`[KILL] Kill result: ${killed} for runId: ${runId}`);
  if (!killed) {
    return res.status(404).json({ error: 'Run not found or already completed' });
  }

  res.json({ success: true, runId });
});

export default router;
