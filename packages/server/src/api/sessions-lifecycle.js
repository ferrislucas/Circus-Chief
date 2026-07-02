import { Router } from 'express';
import { sessions, attachments, sessionSummaries } from '../database.js';
import { cleanupActiveSession, stopSession, restartSession } from '../services/sessionManager.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as gitService from '../services/gitService.js';
import * as summaryService from '../services/summaryService.js';
import { executeHookAsync } from '../services/hookService.js';
import { requireRootSessionAndProject, requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import { duplicateSession } from '../services/sessionDuplicator.js';
import { validateScheduledAt } from './scheduledAtValidation.js';
import { validateModelId } from './model-validation.js';
import { broadcastSessionUpdate } from './sessions-patch.js';
import {
  checkCrossKindSwitch,
  sessionHasNoAssistantMessages,
  deriveAgentTypeUpdate,
} from '../services/sessionAgentGuard.js';

const router = Router();

// GET /api/sessions/:id/summary - Get workflow summary
// ?scope=session  — return only this exact session's own summary (no root resolution, no generation)
// ?generate=true  — (default scope) trigger LLM generation when no summary exists
router.get('/:id/summary', requireRootSessionAndProject, async (req, res) => {
  // scope=session: return the exact session's own summary, ignoring generate param
  if (req.query.scope === 'session') {
    const summary = sessionSummaries.getBySessionId(req.params.id);
    if (!summary) {
      return res.status(404).json({ error: 'Summary not found' });
    }
    return res.json(summary);
  }

  // Default: workflow-root scoped summary (may trigger generation)
  const generateIfMissing = req.query.generate === 'true';

  try {
    const summary = await summaryService.getSummary(req.rootSessionId, generateIfMissing);
    if (!summary) {
      return res.status(404).json({ error: 'Summary not found' });
    }
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/summary - Generate/regenerate workflow summary
router.post('/:id/summary', requireRootSessionAndProject, async (req, res) => {
  try {
    const summary = await summaryService.regenerateSummary(req.rootSessionId);
    if (!summary) {
      return res.status(500).json({ error: 'Failed to generate summary' });
    }
    res.status(201).json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sessions/:id/summary - Directly set workflow summary data (for testing/seeding)
// Resolves to the workflow root before writing and applies coverage repair + fingerprinting.
router.put('/:id/summary', requireRootSessionAndProject, async (req, res) => {
  try {
    const summary = summaryService.saveManualSummary(req.params.id, req.body);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Validate a /schedule request body and build the session update payload.
// Returns either { status, error } for a 4xx response, or { updateData } on success.
function buildScheduleUpdate(req) {
  const { prompt, scheduledAt: scheduledAtRaw, model } = req.body;

  // Validate prompt
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return { status: 400, error: { error: 'prompt must be a non-empty string' } };
  }

  // Validate scheduledAt: required, must parse, must be in the future
  if (scheduledAtRaw === undefined || scheduledAtRaw === null) {
    return { status: 400, error: { error: 'scheduledAt is required' } };
  }
  const scheduledAtResult = validateScheduledAt(scheduledAtRaw);
  if (scheduledAtResult.error) {
    return { status: 400, error: { error: scheduledAtResult.error } };
  }
  const scheduledAt = scheduledAtResult.value;
  if (scheduledAt <= Date.now()) {
    return { status: 400, error: { error: 'scheduledAt must be in the future' } };
  }

  // Validate model if provided, applying the cross-kind drift guard
  const modelResult = resolveScheduleModel(req, model);
  if (modelResult.error) {
    return modelResult;
  }

  const updateData = {
    status: 'scheduled',
    scheduledAt,
    pendingPrompt: prompt,
    ...modelResult.agentTypeUpdate,
  };
  if (Object.prototype.hasOwnProperty.call(modelResult, 'pendingModel')) {
    updateData.pendingModel = modelResult.pendingModel;
  }

  return { updateData };
}

// Validate the optional model field for /schedule and resolve the agentType update.
// Returns { pendingModel, agentTypeUpdate } when model is supplied,
// { agentTypeUpdate } when omitted, or { status, error } on failure.
function resolveScheduleModel(req, model) {
  if (model === undefined || model === null || model === '') {
    return { agentTypeUpdate: {} };
  }

  const modelResult = validateModelId(model, { fieldName: 'model' });
  if (modelResult.error) {
    return { status: 400, error: { error: modelResult.error } };
  }
  const pendingModel = modelResult.value;

  if (sessionHasNoAssistantMessages(req.params.id)) {
    // Draft session: re-derive agentType from model (safe to mutate kind)
    const agentTypeUpdate = deriveAgentTypeUpdate(req.session_, req.params.id, pendingModel, { providerId: null });
    return { pendingModel, agentTypeUpdate };
  }

  // Started session: reject cross-kind switches
  const driftError = checkCrossKindSwitch(req.session_, pendingModel);
  if (driftError) {
    return { status: 400, error: driftError };
  }
  return { pendingModel, agentTypeUpdate: {} };
}

// POST /api/sessions/:id/schedule - Schedule the current session to continue later.
//
// Takes prompt + scheduledAt directly so agents can schedule a continuation in
// one race-free call, without a multi-step PATCH dance. Works for both idle and
// running sessions: when a running session's turn completes, the turn-completion
// hook re-applies the scheduled status over the normal waiting write.
//
// Request body:
//   prompt      {string}               required — becomes pendingPrompt
//   scheduledAt {ISO 8601 | epoch ms}  required — must be in the future
//   model       {string}               optional — becomes pendingModel; cross-kind guarded
//
// Only prompt, scheduledAt, and model are honored here. Reschedule-policy fields
// must be set at session creation time or via PATCH /api/sessions/:id.
router.post('/:id/schedule', requireSession, (req, res) => {
  const result = buildScheduleUpdate(req);
  if (result.error) {
    return res.status(result.status).json(result.error);
  }

  const updated = sessions.update(req.params.id, result.updateData);
  broadcastSessionUpdate(req.params.id, req.session_.projectId, updated, result.updateData);
  res.json(updated);
});

// POST /api/sessions/:id/duplicate - Duplicate a session
router.post('/:id/duplicate', requireSession, async (req, res) => {
  try {
    const { name } = req.body;
    const newSession = await duplicateSession(req.params.id, { name });

    // Broadcast new session creation to project subscribers
    broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: req.session_.projectId,
      session: newSession,
    });

    res.status(201).json(newSession);
  } catch (error) {
    console.error('Error duplicating session:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/stop - Stop running session
router.post('/:id/stop', requireSession, async (req, res) => {
  // Allow stopping running, waiting, or stuck sessions (crashed sessions may be stuck in 'running')
  // Don't allow stopping already errored or stopped sessions
  if (req.session_.status === 'error' || req.session_.status === 'stopped') {
    return res.status(400).json({ error: 'Session is not active' });
  }

  try {
    await stopSession(req.session_.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/restart - Restart a completed/error session
router.post('/:id/restart', requireSession, (req, res) => {
  if (req.session_.status !== 'stopped' && req.session_.status !== 'error') {
    return res.status(400).json({ error: 'Session can only be restarted when stopped or in error state' });
  }

  try {
    restartSession(req.session_.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/sessions/:id - Delete session
router.delete('/:id', requireSessionAndProject, async (req, res) => {
  // Collect all descendant session IDs before any deletions
  // (database ON DELETE SET NULL would orphan them otherwise)
  const descendantIds = sessions.getAllDescendantIds(req.params.id);

  // Helper: clean up and delete a single session by ID
  const cleanupAndDeleteSession = async (sessionId) => {
    // Clean up active session if running
    cleanupActiveSession(sessionId);

    // Clean up summary service debounce timers
    summaryService.cleanupSession(sessionId);

    // Clean up attachment files from disk
    try {
      attachments.deleteSessionAttachmentsFromDisk(req.workingDirectory, sessionId);
    } catch (error) {
      console.warn(`Failed to remove attachment files for session ${sessionId}:`, error.message);
    }

    // Broadcast deletion to close any open WebSocket subscriptions
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_DELETED, { sessionId });

    // Delete session (cascade will handle messages, canvas items, notes)
    sessions.delete(sessionId);
  };

  // Delete all descendants first (leaves before branches to avoid orphaning)
  for (const descendantId of descendantIds.reverse()) {
    await cleanupAndDeleteSession(descendantId);
  }

  // Remove git worktree if parent session has one (skip for child sessions - they may share parent's worktree)
  if (req.session_.gitWorktree && !req.session_.parentSessionId) {
    try {
      await gitService.removeWorktree(req.project.workingDirectory, req.session_.gitWorktree, true);
    } catch (error) {
      // Log but don't fail - worktree may already be removed or have issues
      console.warn(`Failed to remove worktree for session ${req.session_.id}:`, error.message);
    }
  }

  // Clean up and delete the parent session itself
  await cleanupAndDeleteSession(req.params.id);

  // Broadcast deletion to project subscribers for real-time list updates
  // (sends one event per deleted session so the frontend can remove them all)
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_DELETED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
  });

  for (const descendantId of descendantIds) {
    broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_DELETED, {
      projectId: req.session_.projectId,
      sessionId: descendantId,
    });
  }

  // Execute on_session_deleted hook if configured (non-blocking)
  // Only run for worktree sessions - branch-mode sessions have nothing to clean up
  // Skip for child sessions - they share parent's resources and shouldn't trigger teardown
  if (req.project?.onSessionDeleted && req.session_.gitWorktree && !req.session_.parentSessionId) {
    executeHookAsync(req.project.onSessionDeleted, req.workingDirectory, {
      sessionId: req.session_.id,
      projectId: req.project.id,
      sessionName: req.session_.name,
    });
  }

  res.status(204).send();
});

export default router;
