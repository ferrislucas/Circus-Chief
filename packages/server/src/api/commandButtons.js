import { Router } from 'express';
import { commandButtons, sessions, commandRuns, projects } from '../database.js';
import { CreateCommandButtonRequest, UpdateCommandButtonRequest } from '@circuschief/shared/contracts/commandButtons';
import { commandRunner } from '../services/commandRunner.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { databaseManager } from '../db/DatabaseManager.js';

// Error message constants
const ERR_SESSION_NOT_FOUND = 'Session not found';

const router = Router({ mergeParams: true });

/**
 * Create WebSocket broadcast callbacks for a command run
 * @param {string} sessionId
 * @param {string} projectId
 * @param {string} runId
 * @param {string} buttonId
 * @returns {Object} Callbacks for onOutput, onComplete, onError
 */
function createCommandRunCallbacks(sessionId, projectId, runId, buttonId) {
  return {
    onOutput: (text) => {
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
        sessionId, runId, buttonId, output: text,
      });
      broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
        projectId, sessionId, runId, buttonId, output: text,
      });
    },
    onComplete: (exitCode, output) => {
      const status = exitCode === 0 ? 'success' : 'error';
      console.log(`[CommandButtons] Command completed: runId=${runId}, buttonId=${buttonId}, exitCode=${exitCode}, status=${status}`);
      console.log(`[CommandButtons] Broadcasting to session ${sessionId}`);
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, {
        sessionId, runId, buttonId, status, exitCode, output,
      });
      console.log(`[CommandButtons] Broadcasting to project ${projectId}`);
      broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, {
        projectId, sessionId, runId, buttonId, status, exitCode, output,
      });
    },
    onError: (message) => {
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
        sessionId, runId, buttonId, error: message,
      });
      broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
        projectId, sessionId, runId, buttonId, error: message,
      });
    },
  };
}

/**
 * Broadcast a command run error to session and project subscribers
 */
function broadcastCommandRunError({ sessionId, projectId, runId, buttonId, errorMessage }) {
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
    sessionId, runId, buttonId, error: errorMessage,
  });
  broadcastToProject(projectId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
    projectId, sessionId, runId, buttonId, error: errorMessage,
  });
}

// GET /api/projects/:projectId/command-buttons - List all command buttons for project
router.get('/', (req, res) => {
  const { projectId } = req.params;
  const buttons = commandButtons.getByProjectId(projectId);
  res.json(buttons);
});

// GET /api/projects/:projectId/command-buttons/latest-runs - Get latest run for each button per session in project
router.get('/latest-runs', (req, res) => {
  const { projectId } = req.params;

  // Verify project exists
  const project = projects.getById(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const latestRuns = commandRuns.getLatestRunsForProject(projectId);
  res.json(latestRuns);
});

// POST /api/projects/:projectId/command-buttons - Create new command button
router.post('/', (req, res) => {
  const result = CreateCommandButtonRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const button = commandButtons.create({
    projectId: req.params.projectId,
    label: result.data.label,
    command: result.data.command,
    sortOrder: result.data.sortOrder,
    showOnList: result.data.showOnList,
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
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  // Map validated data and only include fields that were provided
  const updateData = {};
  if (result.data.label !== undefined) updateData.label = result.data.label;
  if (result.data.command !== undefined) updateData.command = result.data.command;
  if (result.data.sortOrder !== undefined) updateData.sortOrder = result.data.sortOrder;
  if (result.data.showOnList !== undefined) updateData.showOnList = result.data.showOnList;

  const updated = commandButtons.update(req.params.id, updateData);
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
  const { sessionId, buttonId } = req.params;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
  }

  const button = commandButtons.getById(buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }

  const workingDirectory = session.gitWorktree || session.project?.workingDirectory || process.cwd();
  const runId = databaseManager.generateId();

  res.json({ runId, buttonId, status: 'running', output: '' });

  const callbacks = createCommandRunCallbacks(sessionId, session.projectId, runId, buttonId);

  (async () => {
    try {
      await commandRunner.run(
        { runId, command: button.command, workingDirectory },
        callbacks,
        { sessionId, buttonId }
      );
    } catch (error) {
      console.error(`Error running command button ${buttonId}:`, error);
      broadcastCommandRunError({ sessionId, projectId: session.projectId, runId, buttonId, errorMessage: error.message });
    }
  })();
});

// GET /api/sessions/:sessionId/command-buttons/runs - Get active runs for session
router.get('/runs', (req, res) => {
  const { sessionId } = req.params;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
  }

  // Get running + recent (last hour) from commandRunner
  const activeRuns = commandRunner.getRunsBySession(sessionId);

  // Also get latest run per button (for historical context beyond 1 hour)
  const latestRuns = commandRuns.getLatestRunsForSession(sessionId);

  // Merge, preferring activeRuns data (more current output)
  // Use buttonId as the key to avoid duplicates
  const runMap = new Map();

  // First add latest runs from database
  for (const run of latestRuns) {
    runMap.set(run.buttonId, {
      runId: run.id,
      buttonId: run.buttonId,
      status: run.status,
      output: run.output,
      exitCode: run.exitCode,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    });
  }

  // Override with active/recent runs (they're more current)
  for (const run of activeRuns) {
    runMap.set(run.buttonId, run);
  }

  res.json(Array.from(runMap.values()));
});

// GET /api/sessions/:sessionId/command-buttons/runs/:runId - Get single run by ID
router.get('/runs/:runId', (req, res) => {
  const { sessionId, runId } = req.params;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
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

// DELETE /api/sessions/:sessionId/command-buttons/runs/:runId - Delete a command run record
router.delete('/runs/:runId', (req, res) => {
  const { sessionId, runId } = req.params;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
  }

  const run = commandRuns.getById(runId);
  if (!run || run.sessionId !== sessionId) {
    return res.status(404).json({ error: 'Run not found' });
  }

  if (commandRunner.isRunning(runId)) {
    return res.status(409).json({ error: 'Cannot delete a running command. Kill it first.' });
  }

  commandRuns.deleteById(runId);

  // Broadcast deletion to session and project subscribers
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, {
    runId,
    buttonId: run.buttonId,
    sessionId,
  });
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.COMMAND_RUN_DELETED, {
    runId,
    buttonId: run.buttonId,
    sessionId,
    projectId: session.projectId,
  });

  res.status(204).send();
});

// POST /api/sessions/:sessionId/command-buttons/runs/:runId/kill - Kill running command
router.post('/runs/:runId/kill', (req, res) => {
  const { sessionId, runId } = req.params;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: ERR_SESSION_NOT_FOUND });
  }

  const killed = commandRunner.kill(runId);
  if (!killed) {
    return res.status(404).json({ error: 'Run not found or already completed' });
  }

  res.json({ success: true, runId });
});

export default router;
