import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { extname, resolve, normalize } from 'path';
import { sessions, messages, sessionNotes, projects, todos, workLogs, sessionTemplates, conversations, attachments, commandButtons, commandRuns } from '../database.js';
import { continueSession, stopSession, restartSession, cleanupActiveSession, continueSessionWithExistingMessage } from '../services/sessionManager.js';
import { getChanges, getChangesBranch } from '../services/diffService.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as gitService from '../services/gitService.js';
import * as summaryService from '../services/summaryService.js';
import { executeHookAsync } from '../services/hookService.js';
import { upload, handleUploadError } from '../middleware/upload.js';
import { commandRunner } from '../services/commandRunner.js';
import { databaseManager } from '../db/DatabaseManager.js';
import { duplicateSession } from '../services/sessionDuplicator.js';

const router = Router();

// GET /api/sessions - Get all active/waiting sessions across all projects
router.get('/', (req, res) => {
  const activeSessions = sessions.getActiveAndWaiting();
  res.json(activeSessions);
});

// GET /api/sessions/:id - Get session details
// Includes latestCommandRuns (merged from DB completed runs + in-memory running commands)
router.get('/:id', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
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

  res.json({ ...session, hasResponses, latestCommandRuns });
});

// GET /api/sessions/:id/changes - Get git changes for session
// Query params:
//   compareMode: 'local' (default) or 'branch' - determines what to compare against
//   branch: branch ref to compare against (e.g., 'origin/main') - used when compareMode='branch'
router.get('/:id/changes', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Use gitWorktree if set, otherwise use the project's working directory
  const directory = session.gitWorktree || project.workingDirectory;

  try {
    const { compareMode = 'local', branch } = req.query;

    let changes;
    if (compareMode === 'branch' && branch) {
      // Get changes compared to a specific branch
      changes = await getChangesBranch(directory, branch);
    } else {
      // Default: get local changes (staged, unstaged, untracked)
      changes = await getChanges(directory);
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
router.get('/:id/file', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const { path: filePath } = req.query;
  if (!filePath) {
    return res.status(400).json({ error: 'path query parameter is required' });
  }

  // Use gitWorktree if set, otherwise use the project's working directory
  const directory = session.gitWorktree || project.workingDirectory;

  // Security: ensure the requested path is within the working directory
  const fullPath = resolve(directory, filePath);
  const normalizedDir = normalize(directory);
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
router.get('/:id/default-branch', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Use gitWorktree if set, otherwise use the project's working directory
  const directory = session.gitWorktree || project.workingDirectory;

  try {
    const branch = await gitService.getOriginDefaultBranch(directory);
    res.json({ branch });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/files-count - Get count of modified files
router.get('/:id/files-count', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Use gitWorktree if set, otherwise use the project's working directory
  const directory = session.gitWorktree || project.workingDirectory;

  try {
    // Get the default branch to compare against
    const defaultBranch = await gitService.getOriginDefaultBranch(directory);
    const count = await gitService.getModifiedFilesCount(directory, defaultBranch);

    res.json({ count });
  } catch (error) {
    res.status(500).json({ error: error.message, count: 0 });
  }
});

// GET /api/sessions/:id/messages - Get session messages
// Supports ?conversation_id=xxx to filter by conversation
router.get('/:id/messages', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

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
router.get('/:id/work-logs', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Return work logs grouped by message ID
  const grouped = workLogs.getBySessionIdGrouped(req.params.id);
  res.json(grouped);
});

// POST /api/sessions/:id/work-logs - Create work log (for testing)
router.post('/:id/work-logs', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

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
router.post('/:id/message', upload.array('files', 10), handleUploadError, async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const content = req.body.content;
  const files = req.files || [];

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (session.status !== 'waiting' && session.status !== 'stopped' && session.status !== 'error') {
    return res.status(400).json({ error: 'Session is not waiting for input' });
  }

  // Get the project for the working directory
  const project = projects.getById(session.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    // Use gitWorktree if set, otherwise use the project's working directory
    const workingDirectory = session.gitWorktree || project.workingDirectory;

    // Store file attachments if any - saves to disk in workingDirectory/.attachments
    const messageAttachments = attachments.createBatch(session.id, null, files, workingDirectory);

    // Start continuation (non-blocking) - pass attachments for context
    continueSession(session.id, content, workingDirectory, project.systemPrompt, messageAttachments).catch((error) => {
      console.error('Continue session error:', error);
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/stop - Stop running session
router.post('/:id/stop', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Allow stopping running, waiting, or stuck sessions (crashed sessions may be stuck in 'running')
  // Don't allow stopping already errored or stopped sessions
  if (session.status === 'error' || session.status === 'stopped') {
    return res.status(400).json({ error: 'Session is not active' });
  }

  try {
    await stopSession(session.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/restart - Restart a completed/error session
router.post('/:id/restart', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  if (session.status !== 'stopped' && session.status !== 'error') {
    return res.status(400).json({ error: 'Session can only be restarted when stopped or in error state' });
  }

  try {
    restartSession(session.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/sessions/:id/initial-prompt - Update the initial prompt for a draft session
router.put('/:id/initial-prompt', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Validate session is in waiting status (draft state)
  if (session.status !== 'waiting') {
    return res.status(400).json({ error: 'Session must be in waiting status to edit the prompt' });
  }

  // Check if session has any assistant messages (should not have any for a draft)
  const allMessages = messages.getBySessionId(session.id);
  const hasAssistantMessages = allMessages.some(msg => msg.role === 'assistant');
  if (hasAssistantMessages) {
    return res.status(400).json({ error: 'Session is not a draft - it already has responses' });
  }

  // Get the request body
  const { prompt } = req.body;

  // Validate prompt is provided and non-empty
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return res.status(400).json({ error: 'Prompt must be a non-empty string' });
  }

  try {
    // Find the first user message and update it
    const userMessages = allMessages.filter(msg => msg.role === 'user');
    if (userMessages.length === 0) {
      return res.status(400).json({ error: 'No initial prompt found' });
    }

    const initialMessage = userMessages[0];
    const updatedMessage = messages.updateContent(initialMessage.id, prompt);

    // Broadcast the update to session subscribers
    broadcastToSession(session.id, WS_MESSAGE_TYPES.MESSAGE_UPDATED, {
      sessionId: session.id,
      message: updatedMessage,
    });

    res.json({ success: true, message: updatedMessage });
  } catch (error) {
    console.error('Update initial prompt error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/start - Start a draft session (waiting status with no assistant messages)
router.post('/:id/start', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Validate session is in waiting status (draft state)
  if (session.status !== 'waiting') {
    return res.status(400).json({ error: 'Session must be in waiting status to start' });
  }

  // Check if session has any assistant messages (should not have any for a draft)
  const allMessages = messages.getBySessionId(session.id);
  const hasAssistantMessages = allMessages.some(msg => msg.role === 'assistant');
  if (hasAssistantMessages) {
    return res.status(400).json({ error: 'Session is not a draft - it already has responses' });
  }

  try {
    // Get the project and initial prompt
    const project = projects.getById(session.projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Use gitWorktree if set, otherwise use project's working directory
    const workingDirectory = session.gitWorktree || project.workingDirectory;

    // Get the initial user message (prompt)
    const userMessages = allMessages.filter(msg => msg.role === 'user');
    if (userMessages.length === 0) {
      return res.status(400).json({ error: 'No initial prompt found' });
    }
    const initialMessage = userMessages[0];

    // If a new prompt is provided in the request body, update the message
    let finalPrompt = initialMessage.content;
    if (req.body.prompt !== undefined) {
      // Validate provided prompt
      if (!req.body.prompt || typeof req.body.prompt !== 'string' || req.body.prompt.trim() === '') {
        return res.status(400).json({ error: 'Prompt must be a non-empty string' });
      }
      // Update the message with the new prompt
      const updatedMessage = messages.updateContent(initialMessage.id, req.body.prompt);
      finalPrompt = updatedMessage.content;

      // Broadcast the update to session subscribers
      broadcastToSession(session.id, WS_MESSAGE_TYPES.MESSAGE_UPDATED, {
        sessionId: session.id,
        message: updatedMessage,
      });
    }

    // Get session attachments for context
    const sessionAttachments = attachments.getBySessionId(session.id);

    // Update session status to starting and begin processing
    sessions.update(session.id, { status: 'starting' });

    // Start session manager (non-blocking)
    const { runSession } = await import('../services/sessionManager.js');
    runSession(session.id, finalPrompt, workingDirectory, project.systemPrompt, sessionAttachments, session.model).catch((error) => {
      console.error('Session error:', error);
      sessions.update(session.id, { status: 'error', error: error.message });
    });

    // Broadcast status update
    broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_STATUS, {
      sessionId: session.id,
      status: 'starting',
    });

    // Broadcast to project subscribers
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: session.projectId,
      sessionId: session.id,
      session: sessions.getById(session.id),
    });

    res.json({ success: true, session: sessions.getById(session.id) });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/notes - Get session notes
router.get('/:id/notes', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const notes = sessionNotes.getBySessionId(req.params.id);
  res.json(notes);
});

// POST /api/sessions/:id/notes - Create session note
router.post('/:id/notes', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const note = sessionNotes.create(req.params.id, content);
  res.status(201).json(note);
});

// PUT /api/sessions/:id/notes/:noteId - Update session note
router.put('/:id/notes/:noteId', (req, res) => {
  const note = sessionNotes.getById(req.params.noteId);
  if (!note || note.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Note not found' });
  }

  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  const updated = sessionNotes.update(req.params.noteId, content);
  res.json(updated);
});

// DELETE /api/sessions/:id/notes/:noteId - Delete session note
router.delete('/:id/notes/:noteId', (req, res) => {
  const note = sessionNotes.getById(req.params.noteId);
  if (!note || note.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Note not found' });
  }

  sessionNotes.delete(req.params.noteId);
  res.status(204).send();
});

// ==================== CONVERSATION ENDPOINTS ====================

// GET /api/sessions/:id/conversations - List all conversations for a session
router.get('/:id/conversations', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Use getBySessionIdWithBranchInfo to include branching metadata
  const sessionConversations = conversations.getBySessionIdWithBranchInfo(req.params.id);
  res.json(sessionConversations);
});

// POST /api/sessions/:id/conversations - Create new conversation
router.post('/:id/conversations', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Block creating new conversation while session is running
  if (session.status === 'running') {
    return res.status(400).json({ error: 'Cannot create new conversation while session is running' });
  }

  const { name } = req.body;

  // Auto-generate summary for the current active conversation before creating new one
  const previousActive = conversations.getActiveBySessionId(req.params.id);
  if (previousActive && !previousActive.summary) {
    // Generate summary in background (don't block the request)
    summaryService.generateConversationSummary(req.params.id, previousActive.id).catch((err) => {
      console.error('Failed to generate conversation summary:', err);
    });
  }

  const conversation = conversations.create(req.params.id, name || null, true);

  // Broadcast conversation created event
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CONVERSATION_CREATED, {
    sessionId: req.params.id,
    conversation,
  });

  res.status(201).json(conversation);
});

// GET /api/sessions/:id/conversations/:convId - Get specific conversation
router.get('/:id/conversations/:convId', (req, res) => {
  const conversation = conversations.getById(req.params.convId);
  if (!conversation || conversation.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Include message count
  const messageCount = messages.getCountByConversationId(req.params.convId);
  res.json({ ...conversation, messageCount });
});

// PATCH /api/sessions/:id/conversations/:convId - Update conversation
router.patch('/:id/conversations/:convId', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const conversation = conversations.getById(req.params.convId);
  if (!conversation || conversation.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const { name, isActive } = req.body;

  // Block switching conversation while session is running
  if (isActive && session.status === 'running') {
    return res.status(400).json({ error: 'Cannot switch conversation while session is running' });
  }

  // If switching to this conversation, generate summary for the previous active one
  if (isActive && !conversation.isActive) {
    const previousActive = conversations.getActiveBySessionId(req.params.id);
    if (previousActive && previousActive.id !== req.params.convId && !previousActive.summary) {
      // Generate summary in background
      summaryService.generateConversationSummary(req.params.id, previousActive.id).catch((err) => {
        console.error('Failed to generate conversation summary:', err);
      });
    }
  }

  const updateData = {};
  if (name !== undefined) updateData.name = name;
  if (isActive !== undefined) updateData.isActive = isActive;

  const updated = conversations.update(req.params.convId, updateData);

  // Broadcast conversation updated event
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CONVERSATION_UPDATED, {
    sessionId: req.params.id,
    conversation: updated,
  });

  res.json(updated);
});

// DELETE /api/sessions/:id/conversations/:convId - Delete conversation
router.delete('/:id/conversations/:convId', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Block deleting conversation while session is running
  if (session.status === 'running') {
    return res.status(400).json({ error: 'Cannot delete conversation while session is running' });
  }

  const conversation = conversations.getById(req.params.convId);
  if (!conversation || conversation.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  // Delete and handle active conversation logic
  const newActive = conversations.deleteAndHandleActive(req.params.convId);

  // Broadcast conversation deleted event
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CONVERSATION_DELETED, {
    sessionId: req.params.id,
    conversationId: req.params.convId,
    newActiveConversation: newActive,
  });

  res.status(204).send();
});

// POST /api/sessions/:id/conversations/:convId/summary - Generate summary for conversation
router.post('/:id/conversations/:convId/summary', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const conversation = conversations.getById(req.params.convId);
  if (!conversation || conversation.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  try {
    const summary = await summaryService.generateConversationSummary(req.params.id, req.params.convId);
    res.json({ summary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/sessions/:id/conversations/:convId/branch - Create a branch from a conversation
router.post('/:id/conversations/:convId/branch', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Block branching while session is running
  if (session.status === 'running') {
    return res.status(400).json({ error: 'Cannot branch conversation while session is running' });
  }

  const conversation = conversations.getById(req.params.convId);
  if (!conversation || conversation.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const { messageId, prompt } = req.body;

  if (!messageId) {
    return res.status(400).json({ error: 'messageId is required' });
  }

  if (!prompt || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  try {
    // Create the branch
    // Note: name is auto-generated from the prompt in ConversationRepository.branch()
    const branchConversation = conversations.branch(
      req.params.convId,
      messageId,
      null, // name is auto-generated from prompt
      prompt
    );

    // Broadcast the new conversation to session subscribers
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CONVERSATION_CREATED, {
      sessionId: req.params.id,
      conversation: branchConversation,
    });

    // Auto-submit to Claude: Start the session with the new prompt
    // The branch already has the user message, so we use continueSessionWithExistingMessage
    // which triggers Claude's response WITHOUT creating a duplicate user message
    try {
      const project = projects.getById(session.projectId);
      const workingDirectory = session.gitWorktree || project?.workingDirectory;
      if (workingDirectory) {
        await continueSessionWithExistingMessage(
          req.params.id,
          branchConversation.id,
          workingDirectory,
          project?.systemPrompt
        );
      }
    } catch (err) {
      console.error('Failed to auto-start branched conversation:', err);
      // Don't fail the whole request if auto-start fails
      // User can manually trigger from the UI
    }

    res.status(201).json(branchConversation);
  } catch (error) {
    console.error('Branch conversation error:', error);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/sessions/:id/todos - Get session todos
// Supports ?conversation_id=xxx to fetch todos for a specific conversation
router.get('/:id/todos', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

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
router.patch('/:id', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const { thinkingEnabled, status, mode, nextTemplateId, model } = req.body;

  // Build update object with only provided fields
  const updateData = {};
  if (thinkingEnabled !== undefined) {
    updateData.thinkingEnabled = Boolean(thinkingEnabled);
  }
  if (status !== undefined) {
    const validStatuses = ['starting', 'running', 'waiting', 'error', 'stopped'];
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
    const validModels = ['claude-sonnet-4-5-20250929', 'claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001'];
    if (!validModels.includes(model)) {
      return res.status(400).json({ error: 'Invalid model. Must be one of: ' + validModels.join(', ') });
    }
    updateData.model = model;
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const updated = sessions.update(req.params.id, updateData);

  // Broadcast status update if status changed
  if (updateData.status) {
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_STATUS, {
      sessionId: req.params.id,
      status: updateData.status,
    });
  }

  // Broadcast session update to project subscribers for real-time list updates
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: session.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// GET /api/sessions/:id/summary - Get session summary
router.get('/:id/summary', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

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
router.post('/:id/summary', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

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

// POST /api/sessions/:id/archive - Archive a session
router.post('/:id/archive', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Only allow archiving stopped/waiting/error sessions (not active sessions like starting/running)
  if (!['stopped', 'waiting', 'error'].includes(session.status)) {
    return res.status(400).json({ error: 'Can only archive stopped, waiting, or error sessions' });
  }

  const updated = sessions.update(req.params.id, { archived: true });

  // Broadcast update to project subscribers
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: session.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// POST /api/sessions/:id/unarchive - Unarchive a session
router.post('/:id/unarchive', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const updated = sessions.update(req.params.id, { archived: false });

  // Broadcast update to project subscribers
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: session.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// POST /api/sessions/:id/star - Toggle star status for a session
router.post('/:id/star', (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const updated = sessions.update(req.params.id, { starred: !session.starred });

  // Broadcast update to project subscribers
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: session.projectId,
    sessionId: req.params.id,
    session: updated,
  });

  res.json(updated);
});

// POST /api/sessions/:id/duplicate - Duplicate a session
router.post('/:id/duplicate', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  try {
    const { name } = req.body;
    const newSession = await duplicateSession(req.params.id, { name });

    // Broadcast new session creation to project subscribers
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_CREATED, {
      projectId: session.projectId,
      session: newSession,
    });

    res.status(201).json(newSession);
  } catch (error) {
    console.error('Error duplicating session:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/sessions/:id - Delete session
router.delete('/:id', async (req, res) => {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Get project info before deletion for hook execution
  const project = projects.getById(session.projectId);

  // Clean up active session if running
  cleanupActiveSession(req.params.id);

  // Clean up summary service debounce timers
  summaryService.cleanupSession(req.params.id);

  // Remove git worktree if session has one
  if (session.gitWorktree && project) {
    try {
      await gitService.removeWorktree(project.workingDirectory, session.gitWorktree, true);
    } catch (error) {
      // Log but don't fail - worktree may already be removed or have issues
      console.warn(`Failed to remove worktree for session ${session.id}:`, error.message);
    }
  }

  // Clean up attachment files from disk
  if (project) {
    const workingDirectory = session.gitWorktree || project.workingDirectory;
    try {
      attachments.deleteSessionAttachmentsFromDisk(workingDirectory, session.id);
    } catch (error) {
      // Log but don't fail - files may already be removed
      console.warn(`Failed to remove attachment files for session ${session.id}:`, error.message);
    }
  }

  // Broadcast deletion to close any open WebSocket subscriptions
  broadcastToSession(req.params.id, WS_MESSAGE_TYPES.SESSION_DELETED, { sessionId: req.params.id });

  // Broadcast deletion to project subscribers for real-time list updates
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_DELETED, {
    projectId: session.projectId,
    sessionId: req.params.id,
  });

  // Delete session (cascade will handle messages, canvas items, notes)
  sessions.delete(req.params.id);

  // Execute on_session_deleted hook if configured (non-blocking)
  // Use session's worktree directory if available, otherwise project directory
  if (project?.onSessionDeleted) {
    const hookWorkingDirectory = session.gitWorktree || project.workingDirectory;
    executeHookAsync(project.onSessionDeleted, hookWorkingDirectory, {
      sessionId: session.id,
      projectId: project.id,
      sessionName: session.name,
    });
  }

  res.status(204).send();
});

// POST /api/sessions/:id/command-buttons/:buttonId/run - Execute button command
router.post('/:id/command-buttons/:buttonId/run', (req, res) => {
  const sessionId = req.params.id;
  const buttonId = req.params.buttonId;

  console.log(`[RUN] Starting command for buttonId: ${buttonId}, sessionId: ${sessionId}`);

  // Get session and button
  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const button = commandButtons.getById(buttonId);
  if (!button) {
    return res.status(404).json({ error: 'Command button not found' });
  }

  const project = projects.getById(session.projectId);
  // Determine working directory: use session's git_worktree if set, otherwise project's working_directory
  const workingDirectory = session.gitWorktree || (project?.workingDirectory) || process.cwd();

  // Generate run ID
  const runId = databaseManager.generateId();

  console.log(`[RUN] Generated runId: ${runId} for command: ${button.command}`);

  // Return immediately with runId
  res.json({ runId, buttonId, status: 'running', output: '' });

  // Broadcast initial "running" status immediately so session list can show the running indicator
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
    sessionId,
    runId,
    buttonId,
    output: '',
  });
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
    projectId: session.projectId,
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
        runId,
        button.command,
        workingDirectory,
        (text) => {
          // Broadcast output via WebSocket to session subscribers
          console.log(`[RUN] Output received for runId: ${runId}`);
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
            sessionId,
            runId,
            buttonId,
            output: text,
          });
          // Also broadcast to project subscribers for session list updates
          broadcastToProject(session.projectId, WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, {
            projectId: session.projectId,
            sessionId,
            runId,
            buttonId,
            output: text,
          });
        },
        (exitCode, output) => {
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
          console.log(`[RUN] Broadcasting COMMAND_RUN_COMPLETE to project ${session.projectId}`);
          broadcastToProject(session.projectId, WS_MESSAGE_TYPES.COMMAND_RUN_COMPLETE, {
            projectId: session.projectId,
            sessionId,
            runId,
            buttonId,
            status,
            exitCode,
            output,
          });
        },
        (message) => {
          // Broadcast error via WebSocket to session subscribers
          console.log(`[RUN] Error for runId: ${runId}: ${message}`);
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
            sessionId,
            runId,
            buttonId,
            error: message,
          });
          // Also broadcast to project subscribers for session list updates
          broadcastToProject(session.projectId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
            projectId: session.projectId,
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
      // Also broadcast to project subscribers for session list updates
      broadcastToProject(session.projectId, WS_MESSAGE_TYPES.COMMAND_RUN_ERROR, {
        projectId: session.projectId,
        sessionId,
        runId,
        buttonId,
        error: error.message,
      });
    }
  })();
});

// GET /api/sessions/:id/command-buttons/runs - Get active runs for session
router.get('/:id/command-buttons/runs', (req, res) => {
  const sessionId = req.params.id;

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const activeRuns = commandRunner.getRunsBySession(sessionId);
  res.json(activeRuns);
});

// GET /api/sessions/:id/command-buttons/runs/:runId - Get single run by ID
router.get('/:id/command-buttons/runs/:runId', (req, res) => {
  const { id: sessionId, runId } = req.params;

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

// POST /api/sessions/:id/command-buttons/runs/:runId/kill - Kill running command
router.post('/:id/command-buttons/runs/:runId/kill', (req, res) => {
  const sessionId = req.params.id;
  const runId = req.params.runId;

  console.log(`[KILL] Kill request for runId: ${runId}, sessionId: ${sessionId}`);

  const session = sessions.getById(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const killed = commandRunner.kill(runId);
  console.log(`[KILL] Kill result: ${killed} for runId: ${runId}`);
  if (!killed) {
    return res.status(404).json({ error: 'Run not found or already completed' });
  }

  res.json({ success: true, runId });
});

export default router;
