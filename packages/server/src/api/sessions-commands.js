import { Router } from 'express';
import { commandButtons, commandRuns } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import { commandRunner } from '../services/commandRunner.js';
import { databaseManager } from '../db/DatabaseManager.js';

const router = Router();

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

  // Broadcast initial "running" status immediately so session list can show the running indicator
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
    sessionId,
    runId,
    buttonId,
    output: '',
  });
  broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
    projectId,
    sessionId,
    runId,
    buttonId,
    output: '',
  });

  // Execute command asynchronously
  (async () => {
    try {
      console.log(`[RUN] Starting async execution for runId: ${runId}`);
      await commandRunner.run(
        { runId, command: button.command, workingDirectory },
        {
          onOutput: (text) => {
            // Broadcast output via WebSocket to session subscribers
            console.log(`[RUN] Output received for runId: ${runId}`);
            broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
              sessionId,
              runId,
              buttonId,
              output: text,
            });
            // Also broadcast to project subscribers for session list updates
            broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
              projectId,
              sessionId,
              runId,
              buttonId,
              output: text,
            });
          },
          onComplete: (exitCode, output) => {
            // Broadcast completion via WebSocket to session subscribers
            const status = exitCode === 0 ? 'success' : 'error';
            console.log(`[RUN] Command completed for runId: ${runId}, exitCode: ${exitCode}, status: ${status}`);
            broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, {
              sessionId,
              runId,
              buttonId,
              status,
              exitCode,
              output,
            });
            // Also broadcast to project subscribers for session list updates
            console.log(`[RUN] Broadcasting COMMAND_RUN_COMPLETE to project ${projectId}`);
            broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, {
              projectId,
              sessionId,
              runId,
              buttonId,
              status,
              exitCode,
              output,
            });
          },
          onError: (message) => {
            // Broadcast error via WebSocket to session subscribers
            console.log(`[RUN] Error for runId: ${runId}: ${message}`);
            broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
              sessionId,
              runId,
              buttonId,
              error: message,
            });
            // Also broadcast to project subscribers for session list updates
            broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
              projectId,
              sessionId,
              runId,
              buttonId,
              error: message,
            });
          },
        },
        { sessionId, buttonId }
      );
    } catch (error) {
      console.error(`Error running command button ${buttonId}:`, error);
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
        sessionId,
        runId,
        buttonId,
        error: error.message,
      });
      // Also broadcast to project subscribers for session list updates
      broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
        projectId,
        sessionId,
        runId,
        buttonId,
        error: error.message,
      });
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
