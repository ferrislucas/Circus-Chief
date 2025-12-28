import { Router } from 'express';
import { commandButtons, sessions, commandRuns } from '../database.js';
import { CreateCommandButtonRequest, UpdateCommandButtonRequest } from '@claudetools/shared/contracts/commandButtons';
import { commandRunner } from '../services/commandRunner.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import { databaseManager } from '../db/DatabaseManager.js';

const router = Router();

// GET /api/projects/:projectId/command-buttons - List all command buttons for project
router.get('/', (req, res) => {
  const { projectId } = req.params;
  const buttons = commandButtons.getByProjectId(projectId);
  res.json(buttons);
});

// POST /api/projects/:projectId/command-buttons - Create new command button
router.post('/', (req, res) => {
  const result = CreateCommandButtonRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.errors[0].message });
  }

  const button = commandButtons.create({
    projectId: req.params.projectId,
    label: result.data.label,
    command: result.data.command,
    sortOrder: result.data.sortOrder,
  });

  res.status(201).json(button);
});

// GET /api/projects/:projectId/command-buttons/:id - Get single button
router.get('/:id', (req, res) => {
  const button = commandButtons.getById(req.params.id);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }
  res.json(button);
});

// PATCH /api/projects/:projectId/command-buttons/:id - Update button
router.patch('/:id', (req, res) => {
  const button = commandButtons.getById(req.params.id);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }

  const result = UpdateCommandButtonRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.errors[0].message });
  }

  const updated = commandButtons.update(req.params.id, result.data);
  res.json(updated);
});

// DELETE /api/projects/:projectId/command-buttons/:id - Delete button
router.delete('/:id', (req, res) => {
  const button = commandButtons.getById(req.params.id);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }

  commandButtons.delete(req.params.id);
  res.status(204).send();
});

// POST /api/sessions/:sessionId/command-buttons/:buttonId/run - Execute button command
router.post('/run/:buttonId', (req, res) => {
  const { sessionId } = req.params;
  const { buttonId } = req.params;

  // Get session and button
  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const button = commandButtons.getById(buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }

  // Determine working directory
  const workingDirectory = session.gitWorktree || session.project?.workingDirectory || process.cwd();

  // Generate run ID
  const runId = databaseManager.generateId();

  // Return immediately with runId
  res.json({ runId, buttonId, status: 'running', output: '' });

  // Execute command asynchronously
  (async () => {
    try {
      await commandRunner.run(
        runId,
        button.command,
        workingDirectory,
        (text) => {
          // Broadcast output via WebSocket
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
            sessionId,
            runId,
            buttonId,
            output: text,
          });
        },
        (exitCode, output) => {
          // Broadcast completion via WebSocket
          const status = exitCode === 0 ? 'success' : 'error';
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, {
            sessionId,
            runId,
            buttonId,
            status,
            exitCode,
            output,
          });
        },
        (message) => {
          // Broadcast error via WebSocket
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
            sessionId,
            runId,
            buttonId,
            error: message,
          });
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
    }
  })();
});

// GET /api/sessions/:sessionId/command-buttons/runs - Get active runs for session
router.get('/runs', (req, res) => {
  const { sessionId } = req.params;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const activeRuns = commandRunner.getRunsBySession(sessionId);
  res.json(activeRuns);
});

// GET /api/sessions/:sessionId/command-buttons/runs/:runId - Get single run by ID
router.get('/runs/:runId', (req, res) => {
  const { sessionId, runId } = req.params;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

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

// POST /api/sessions/:sessionId/command-buttons/runs/:runId/kill - Kill running command
router.post('/runs/:runId/kill', (req, res) => {
  const { sessionId, runId } = req.params;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const killed = commandRunner.kill(runId);
  if (!killed) {
    return res.status(404).json({ error: 'Run not found or already completed' });
  }

  res.json({ success: true, runId });
});

export default router;
