import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { extname, resolve, normalize } from 'path';
import { sessions, messages, projects, todos, workLogs, sessionTemplates, conversations, attachments, commandRuns, modelProviders, sessionSummaries } from '../database.js';
import { continueSession, stopSession, restartSession, cleanupActiveSession } from '../services/sessionManager.js';
import { getChanges, getChangesBranch } from '../services/diffService.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as gitService from '../services/gitService.js';
import * as summaryService from '../services/summaryService.js';
import { executeHookAsync } from '../services/hookService.js';
import { upload as _upload, handleUploadError } from '../middleware/upload.js';
import { requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import { commandRunner } from '../services/commandRunner.js';
import { duplicateSession } from '../services/sessionDuplicator.js';
import * as slashCommandService from '../services/slashCommandService.js';
import { validateDraftSession, startDraft, DraftSessionError } from '../services/draftSessionService.js';
import { configureSchedule, ScheduleError } from '../services/scheduleService.js';

// Import sub-routers
import notesRouter from './sessions-notes.js';
import conversationsRouter from './sessions-conversations.js';
import commandsRouter from './sessions-commands.js';

const router = Router();

// Mount sub-routers
router.use('/', notesRouter);
router.use('/', conversationsRouter);
router.use('/', commandsRouter);

// TTL cache for files-count endpoint (60 second TTL)
const filesCountCache = new Map();
const FILES_COUNT_CACHE_TTL = 60_000; // 60 seconds

/**
 * Get cached files count or null if expired/missing
 * @param {string} sessionId
 * @returns {{ count: number } | null}
 */
function getCachedFilesCount(sessionId) {
  const cached = filesCountCache.get(sessionId);
  if (cached && (Date.now() - cached.timestamp) < FILES_COUNT_CACHE_TTL) {
    return { count: cached.count };
  }
  return null;
}

/**
 * Set files count in cache
 * @param {string} sessionId
 * @param {number} count
 */
function setCachedFilesCount(sessionId, count) {
  filesCountCache.set(sessionId, { count, timestamp: Date.now() });
}

/**
 * Invalidate files count cache for a session
 * @param {string} sessionId
 */
export function invalidateFilesCountCache(sessionId) {
  filesCountCache.delete(sessionId);
}

// GET /api/sessions - Get all active/waiting sessions across all projects
router.get('/', (req, res) => {
  const activeSessions = sessions.getActiveAndWaiting();
  res.json(activeSessions);
});

// GET /api/sessions/scheduled - Get all scheduled sessions (optionally filtered by project)
router.get('/scheduled', (req, res) => {
  const { projectId } = req.query;
  const scheduledSessions = sessions.getScheduledSessions(projectId || null);
  res.json(scheduledSessions);
});

// POST /api/sessions/summaries/batch - Get summaries for multiple sessions in one request
// Must be registered before /:id routes to avoid Express matching 'summaries' as an :id param
router.post('/summaries/batch', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required and must not be empty' });
  }

  const summaryList = sessionSummaries.getBySessionIds(ids);

  // Build a map of sessionId -> summary (or null if not found)
  const result = {};
  for (const id of ids) {
    result[id] = null;
  }
  for (const summary of summaryList) {
    result[summary.sessionId] = summary;
  }

  res.json(result);
});

// GET /api/sessions/:id - Get session details
// Includes latestCommandRuns (merged from DB completed runs + in-memory running commands)
router.get('/:id', requireSession, (req, res) => {
  // Add hasResponses flag to indicate if session has ever received assistant responses
  // This is used by the frontend to determine if a session is a draft
  const allMessages = messages.getBySessionId(req.params.id);
  const hasResponses = allMessages.some(msg => msg.role === 'assistant');

  // Get command run statuses (latest run per button for this session)
  // Completed runs from DB
  const dbRuns = commandRuns.getLatestRunsForSession(req.params.id);
  // Currently running commands from memory - filter all runs for this session
  const allRunning = commandRunner.getRunsBySession(req.params.id);
  const runningRuns = allRunning.filter(run => run.status === 'running');

  // Build map of buttonId -> run data
  // Running commands take precedence over completed ones (more current state)
  const runsByButton = {};

  // First add DB runs (completed)
  for (const run of dbRuns) {
    runsByButton[run.buttonId] = {
      buttonId: run.buttonId,
      status: run.status,
      exitCode: run.exitCode,
      runId: run.id,
      completedAt: run.completedAt,
    };
  }

  // Then overlay running commands (takes precedence)
  for (const run of runningRuns) {
    runsByButton[run.buttonId] = {
      buttonId: run.buttonId,
      status: 'running',
      exitCode: null,
      runId: run.runId,
      startedAt: run.startedAt,
    };
  }

  const latestCommandRuns = Object.values(runsByButton);

  res.json({ ...req.session_, hasResponses, latestCommandRuns });
});

// GET /api/sessions/:id/changes - Get git changes for session
// Query params:
//   compareMode: 'local' (default) or 'branch' - determines what to compare against
//   branch: branch ref to compare against (e.g., 'origin/main') - used when compareMode='branch'
router.get('/:id/changes', requireSessionAndProject, async (req, res) => {
  try {
    const { compareMode = 'local', branch } = req.query;

    let changes;
    if (compareMode === 'branch' && branch) {
      // Get changes compared to a specific branch
      changes = await getChangesBranch(req.workingDirectory, branch);
    } else {
      // Default: get local changes (staged, unstaged, untracked)
      changes = await getChanges(req.workingDirectory);
    }

    res.json(changes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Image MIME types for the file endpoint
const IMAGE_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

// GET /api/sessions/:id/file - Get a file from the session's working directory
// Used for displaying images in the diff viewer
router.get('/:id/file', requireSessionAndProject, (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) {
    return res.status(400).json({ error: 'path query parameter is required' });
  }

  // Security: ensure the requested path is within the working directory
  const fullPath = resolve(req.workingDirectory, filePath);
  const normalizedDir = normalize(req.workingDirectory);
  if (!fullPath.startsWith(normalizedDir)) {
    return res.status(403).json({ error: 'Access denied: path outside working directory' });
  }

  if (!existsSync(fullPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const ext = extname(fullPath).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES[ext];

    if (!mimeType) {
      return res.status(400).json({ error: 'Only image files are supported' });
    }

    const fileBuffer = readFileSync(fullPath);
    const base64 = fileBuffer.toString('base64');

    res.json({
      data: base64,
      mimeType,
      filename: filePath,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/default-branch - Get the default branch for branch comparison
router.get('/:id/default-branch', requireSessionAndProject, async (req, res) => {
  try {
    const branch = await gitService.getOriginDefaultBranch(req.workingDirectory);
    res.json({ branch });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/files-count - Get count of modified files
// Uses a 60-second TTL cache to avoid expensive git operations on every request
router.get('/:id/files-count', requireSession, async (req, res) => {
  // Check cache first
  const cached = getCachedFilesCount(req.params.id);
  if (cached) {
    return res.json(cached);
  }

  const project = projects.getById(req.session_.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Use gitWorktree if set, otherwise use the project's working directory
  const directory = req.session_.gitWorktree || project.workingDirectory;

  try {
    // Get the default branch to compare against
    const defaultBranch = await gitService.getOriginDefaultBranch(directory);
    const count = await gitService.getModifiedFilesCount(directory, defaultBranch);

    // Cache the result
    setCachedFilesCount(req.params.id, count);

    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message, count: 0 });
  }
});

// GET /api/sessions/:id/messages - Get session messages
// Supports ?conversation_id=xxx to filter by conversation
router.get('/:id/messages', requireSession, (req, res) => {
  const { conversation_id } = req.query;

  let sessionMessages;
  let resolvedConvId = null;
  if (conversation_id) {
    // Get messages for specific conversation
    const conv = conversations.getById(conversation_id);
    if (!conv || conv.sessionId !== req.params.id) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    sessionMessages = messages.getByConversationId(conversation_id);
    resolvedConvId = conversation_id;
  } else {
    // Get messages for active conversation, or all messages if no active conversation
    const activeConv = conversations.getActiveBySessionId(req.params.id);
    if (activeConv) {
      sessionMessages = messages.getByConversationId(activeConv.id);
      resolvedConvId = activeConv.id;
    } else {
      // Fall back to all messages (for legacy/migration)
      sessionMessages = messages.getBySessionId(req.params.id);
      resolvedConvId = 'all (no active conversation)';
    }
  }

  console.log(`[API] fetchMessages: session ${req.params.id}, conversation ${resolvedConvId}, returned ${sessionMessages.length} messages`);

  // Attach file attachments to each message (without content for efficiency)
  const messagesWithAttachments = sessionMessages.map((msg) => ({
    ...msg,
    attachments: attachments.getByMessageIdWithoutContent(msg.id),
  }));

  res.json(messagesWithAttachments);
});

// GET /api/sessions/:id/work-logs - Get work logs for session
router.get('/:id/work-logs', requireSession, (req, res) => {
  // Return work logs grouped by message ID
  const grouped = workLogs.getBySessionIdGrouped(req.params.id);
  res.json(grouped);
});

// POST /api/sessions/:id/work-logs - Create work log (for testing)
router.post('/:id/work-logs', requireSession, (req, res) => {
  const { type, content, toolName, messageId } = req.body;
  if (!type || !content) {
    return res.status(400).json({ error: 'Type and content are required' });
  }

  const log = workLogs.create(req.params.id, type, content, messageId || null, toolName || null);

  // Broadcast to session subscribers
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_WORK_LOG, {
    sessionId: req.params.id,
    log,
  });

  res.status(201).json(log);
});

// POST /api/sessions/:id/message - Send follow-up message
// Supports both JSON and multipart/form-data (for file attachments)
router.post('/:id/message', _upload.array('files', 10), handleUploadError, requireSessionAndProject, async (req, res) => {
  const content = req.body.content;
  const model = req.body.model || null; // Model to use for this message
  const files = req.files || [];

  // [MODEL AUDIT] Log model received from request
  console.log(`[MODEL AUDIT - API] POST /sessions/${req.params.id}/message - model from request: "${model}"`);

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (req.session_.status !== 'waiting' && req.session_.status !== 'stopped' && req.session_.status !== 'error') {
    return res.status(400).json({ error: 'Session is not waiting for input' });
  }

  try {
    // Store file attachments if any - saves to disk in workingDirectory/.attachments
    const messageAttachments = attachments.createBatch(req.session_.id, null, files, req.workingDirectory);

    // [MODEL AUDIT] Log model being passed to continueSession
    console.log(`[MODEL AUDIT - API] Calling continueSession with model: "${model}"`);

    // Check if the message is a slash command/skill invocation (starts with "/")
    const resolved = await slashCommandService.resolvePromptSkillOrCommand(
      req.workingDirectory, content, req.project.systemPrompt || null
    );

    if (resolved) {
      continueSession(req.session_.id, resolved.userMessage, req.workingDirectory, resolved.systemPrompt, messageAttachments, model).catch((error) => {
        console.error(`Continue session error (${resolved.type}):`, error);
      });
      return res.json({ success: true });
    }

    // Standard plain text message
    continueSession(req.session_.id, content, req.workingDirectory, req.project.systemPrompt, messageAttachments, model).catch((error) => {
      console.error('Continue session error:', error);
    });
    res.json({ success: true });
  } catch (error) {
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

// PUT /api/sessions/:id/initial-prompt - Update the initial prompt for a draft session
router.put('/:id/initial-prompt', requireSession, (req, res) => {
  const validation = validateDraftSession(req.session_);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // Get the request body
  const { prompt } = req.body;

  // Validate prompt is provided and non-empty
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'Prompt must be a non-empty string' });
  }

  try {
    const allMessages = messages.getBySessionId(req.session_.id);
    // Find the first user message and update it
    const userMessages = allMessages.filter(msg => msg.role === 'user');
    if (userMessages.length === 0) {
      return res.status(400).json({ error: 'No initial prompt found' });
    }

    const initialMessage = userMessages[0];
    const updatedMessage = messages.updateContent(initialMessage.id, prompt);

    // Broadcast the update to session subscribers
    broadcastToSession(req.session_.id, WS_MESSAGE_TYPES.MESSAGE_UPDATED, {
      sessionId: req.session_.id,
      message: updatedMessage,
    });

    res.json({ success: true, message: updatedMessage });
  } catch (error) {
    console.error('Update initial prompt error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/start - Start a draft session (waiting status with no assistant messages)
router.post('/:id/start', requireSession, async (req, res) => {
  const validation = validateDraftSession(req.session_);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const updatedSession = await startDraft(req.session_, {
      prompt: req.body.prompt,
      model: req.body.model,
    });

    res.json({ success: true, session: updatedSession });
  } catch (error) {
    if (error instanceof DraftSessionError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Start session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/todos - Get session todos
// Supports ?conversation_id=xxx to fetch todos for a specific conversation
router.get('/:id/todos', requireSession, (req, res) => {
  const { conversation_id } = req.query;

  let sessionTodos;
  if (conversation_id) {
    // Get todos for specific conversation
    const conv = conversations.getById(conversation_id);
    if (!conv || conv.sessionId !== req.params.id) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    sessionTodos = todos.getByConversationId(conversation_id);
  } else {
    // Get todos for active conversation, or empty array if no active conversation
    const activeConv = conversations.getActiveBySessionId(req.params.id);
    sessionTodos = activeConv ? todos.getByConversationId(activeConv.id) : [];
  }

  res.json(sessionTodos);
});

// PATCH /api/sessions/:id - Update session settings
router.patch('/:id', requireSession, (req, res) => {
  const {
    name,
    manuallyNamed,
    thinkingEnabled,
    effortLevel,
    status,
    mode,
    nextTemplateId,
    model,
    providerId,
    prUrl,
    pendingModel,
    autoSendPendingPrompt,
    // Scheduling fields
    scheduledAt,
    autoRescheduleEnabled,
    rescheduleDelayMinutes,
    rescheduleOnTokenLimit,
    rescheduleOnServiceError,
    maxRescheduleCount,
    maxTotalTokens,
    rescheduleCount,
    rescheduleAtTokenCount,
  } = req.body;

  // Build update object with only provided fields
  const updateData = {};
  if (name !== undefined) {
    updateData.name = name;
    // Auto-set manuallyNamed when name is updated via user-facing PATCH endpoint
    // (unless manuallyNamed is explicitly provided)
    if (manuallyNamed === undefined) {
      updateData.manuallyNamed = true;
    }
  }
  if (manuallyNamed !== undefined) {
    updateData.manuallyNamed = Boolean(manuallyNamed);
  }
  if (thinkingEnabled !== undefined) {
    updateData.thinkingEnabled = Boolean(thinkingEnabled);
  }
  if (effortLevel !== undefined) {
    if (effortLevel !== null) {
      const validEffortLevels = ['low', 'medium', 'high', 'max', 'auto'];
      if (!validEffortLevels.includes(effortLevel)) {
        return res.status(400).json({ error: 'Invalid effort level. Must be one of: low, medium, high, max, auto' });
      }
    }
    updateData.effortLevel = effortLevel;
  }
  if (status !== undefined) {
    const validStatuses = ['starting', 'running', 'waiting', 'error', 'stopped', 'scheduled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    updateData.status = status;
  }
  if (mode !== undefined) {
    const validModes = ['plan', 'standard', 'yolo'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Must be one of: plan, standard, yolo' });
    }
    updateData.mode = mode;
  }
  if (nextTemplateId !== undefined) {
    // Validate template exists if not null
    if (nextTemplateId !== null) {
      const template = sessionTemplates.getById(nextTemplateId);
      if (!template) {
        return res.status(400).json({ error: 'Template not found' });
      }
    }
    updateData.nextTemplateId = nextTemplateId;
  }
  if (model !== undefined) {
    updateData.model = model;
  }
  if (pendingModel !== undefined) {
    updateData.pendingModel = pendingModel;
  }
  if (autoSendPendingPrompt !== undefined) {
    updateData.autoSendPendingPrompt = autoSendPendingPrompt;
  }
  // Provider ID - allow setting, updating, or clearing (null clears it to use Anthropic)
  if (providerId !== undefined) {
    if (providerId !== null) {
      const provider = modelProviders.getById(providerId);
      if (!provider) {
        return res.status(400).json({ error: 'Provider not found' });
      }
    }
    updateData.providerId = providerId;
  }
  // PR URL - allow setting, updating, or clearing (null or empty string clears it)
  if (prUrl !== undefined) {
    if (prUrl === null || prUrl === '') {
      // Allow clearing the PR URL
      updateData.prUrl = null;
    } else if (typeof prUrl === 'string') {
      // Validate PR URL format if provided
      const prUrlPattern = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/;
      if (!prUrlPattern.test(prUrl)) {
        return res.status(400).json({ error: 'Invalid PR URL format. Must be a valid GitHub PR URL (e.g., https://github.com/owner/repo/pull/123)' });
      }
      updateData.prUrl = prUrl;
    } else {
      return res.status(400).json({ error: 'prUrl must be a string or null' });
    }
  }
  // Scheduling fields
  if (scheduledAt !== undefined) {
    updateData.scheduledAt = scheduledAt;
  }
  if (autoRescheduleEnabled !== undefined) {
    updateData.autoRescheduleEnabled = Boolean(autoRescheduleEnabled);
  }
  if (rescheduleDelayMinutes !== undefined) {
    updateData.rescheduleDelayMinutes = parseInt(rescheduleDelayMinutes, 10);
  }
  if (rescheduleOnTokenLimit !== undefined) {
    updateData.rescheduleOnTokenLimit = Boolean(rescheduleOnTokenLimit);
  }
  if (rescheduleOnServiceError !== undefined) {
    updateData.rescheduleOnServiceError = Boolean(rescheduleOnServiceError);
  }
  if (maxRescheduleCount !== undefined) {
    updateData.maxRescheduleCount = maxRescheduleCount ? parseInt(maxRescheduleCount, 10) : null;
  }
  if (maxTotalTokens !== undefined) {
    updateData.maxTotalTokens = maxTotalTokens ? parseInt(maxTotalTokens, 10) : null;
  }
  if (rescheduleCount !== undefined) {
    updateData.rescheduleCount = parseInt(rescheduleCount, 10);
  }
  if (rescheduleAtTokenCount !== undefined) {
    updateData.rescheduleAtTokenCount = rescheduleAtTokenCount ? parseInt(rescheduleAtTokenCount, 10) : null;
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const updated = sessions.update(req.params.id, updateData);

  // Propagate PR URL to parent session if set (not when clearing)
  if (updateData.prUrl) {
    summaryService.propagatePrUrlToParent(req.params.id, updateData.prUrl);
  }

  // Broadcast status update if status changed
  if (updateData.status) {
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_STATUS, {
      sessionId: req.params.id,
      status: updateData.status,
    });
  }

  // Broadcast session update to session subscribers (e.g. detail view)
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    sessionId: req.params.id,
    session: updated,
  });

  // Broadcast session update to project subscribers for real-time list updates
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// PATCH /api/sessions/:id/pending-prompt - Update pending prompt for auto-save
router.patch('/:id/pending-prompt', requireSession, (req, res) => {
  const { pendingPrompt } = req.body;

  // Allow null or string (including empty string for clearing)
  if (pendingPrompt !== null && typeof pendingPrompt !== 'string') {
    return res.status(400).json({ error: 'pendingPrompt must be a string or null' });
  }

  const updated = sessions.update(req.params.id, { pendingPrompt });

  // Broadcast update to session subscribers
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    sessionId: req.params.id,
    session: updated,
  });

  // Broadcast to project subscribers for real-time updates
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// GET /api/sessions/:id/summary - Get session summary
router.get('/:id/summary', requireSession, async (req, res) => {
  // Check if generateIfMissing query param is set
  const generateIfMissing = req.query.generate === 'true';

  try {
    const summary = await summaryService.getSummary(req.params.id, generateIfMissing);
    if (!summary) {
      return res.status(404).json({ error: 'Summary not found' });
    }
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/summary - Generate/regenerate session summary
router.post('/:id/summary', requireSession, async (req, res) => {
  try {
    const summary = await summaryService.regenerateSummary(req.params.id);
    if (!summary) {
      return res.status(500).json({ error: 'Failed to generate summary' });
    }
    res.status(201).json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sessions/:id/summary - Directly set summary data (for testing/seeding)
router.put('/:id/summary', requireSession, async (req, res) => {
  try {
    const summary = sessionSummaries.upsert(req.params.id, req.body);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/archive - Archive a session
router.post('/:id/archive', requireSession, (req, res) => {
  // Only allow archiving stopped/waiting/error sessions (not active sessions like starting/running)
  if (!['stopped', 'waiting', 'error'].includes(req.session_.status)) {
    return res.status(400).json({ error: 'Can only archive stopped, waiting, or error sessions' });
  }

  const updated = sessions.update(req.params.id, { archived: true });

  // Broadcast update to project subscribers
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// POST /api/sessions/:id/unarchive - Unarchive a session
router.post('/:id/unarchive', requireSession, (req, res) => {
  const updated = sessions.update(req.params.id, { archived: false });

  // Broadcast update to project subscribers
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// POST /api/sessions/:id/star - Toggle star status for a session
router.post('/:id/star', requireSession, (req, res) => {
  const updated = sessions.update(req.params.id, { starred: !req.session_.starred });

  // Broadcast update to project subscribers
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// POST /api/sessions/:id/schedule - Schedule a follow-up message for an existing session
router.post('/:id/schedule', requireSessionAndProject, async (req, res) => {
  try {
    const updated = configureSchedule(req.session_, req.body);
    res.json(updated);
  } catch (error) {
    if (error instanceof ScheduleError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Schedule session error:', error);
    res.status(500).json({ error: error.message });
  }
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

// DELETE /api/sessions/:id - Delete session
router.delete('/:id', requireSessionAndProject, async (req, res) => {
  // Clean up active session if running
  cleanupActiveSession(req.params.id);

  // Clean up summary service debounce timers
  summaryService.cleanupSession(req.params.id);

  // Remove git worktree if session has one (skip for child sessions - they may share parent's worktree)
  if (req.session_.gitWorktree && !req.session_.parentSessionId) {
    try {
      await gitService.removeWorktree(req.project.workingDirectory, req.session_.gitWorktree, true);
    } catch (error) {
      // Log but don't fail - worktree may already be removed or have issues
      console.warn(`Failed to remove worktree for session ${req.session_.id}:`, error.message);
    }
  }

  // Clean up attachment files from disk
  try {
    attachments.deleteSessionAttachmentsFromDisk(req.workingDirectory, req.session_.id);
  } catch (error) {
    // Log but don't fail - files may already be removed
    console.warn(`Failed to remove attachment files for session ${req.session_.id}:`, error.message);
  }

  // Broadcast deletion to close any open WebSocket subscriptions
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_DELETED, { sessionId: req.params.id });

  // Broadcast deletion to project subscribers for real-time list updates
  broadcastToProject(req.session_.projectId, WS_MESSAGE_TYPES.SESSION_DELETED, {
    projectId: req.session_.projectId,
    sessionId: req.params.id,
  });

  // Delete session (cascade will handle messages, canvas items, notes)
  sessions.delete(req.params.id);

  // Execute on_session_deleted hook if configured (non-blocking)
  // Skip for child sessions - they share parent's resources and shouldn't trigger teardown
  if (req.project?.onSessionDeleted && !req.session_.parentSessionId) {
    executeHookAsync(req.project.onSessionDeleted, req.workingDirectory, {
      sessionId: req.session_.id,
      projectId: req.project.id,
      sessionName: req.session_.name,
    });
  }

  res.status(204).send();
});

export default router;
