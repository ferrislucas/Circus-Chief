import { Router } from 'express';
import { sessions, messages, todos, conversations, attachments } from '../database.js';
import { continueSession } from '../services/sessionManager.js';
import { upload as _upload, handleUploadError } from '../middleware/upload.js';
import { requireSession, requireSessionAndProject } from '../middleware/sessionLookup.js';
import * as slashCommandService from '../services/slashCommandService.js';
import { resolveAgentTypeFromModel } from '../services/sessionProvider.js';

// Human-readable labels used in the cross-kind switch error message.
const AGENT_TYPE_LABELS = Object.freeze({
  'claude-code': 'Claude Code',
  codex: 'Codex',
});

function agentLabel(agentType) {
  return AGENT_TYPE_LABELS[agentType] || agentType || 'unknown';
}

/**
 * Cross-kind model switch guard. A session is bound to one agent type for its
 * lifetime. If the caller selected a model that resolves to a different agent
 * than the session's existing agentType, reject BEFORE dispatching
 * continueSession or updating session.model — mixing Claude and Codex
 * mid-conversation would produce a broken resume/context state. Same-kind
 * model changes (sonnet↔opus, gpt-4o↔o1-mini) pass through.
 *
 * @param {Object} session - The session row (must include agentType + model).
 * @param {string|null} requestedModel - Model ID from req.body.model, or null.
 * @returns {{ error: string, message: string }|null} 400-body on block, or null to allow.
 */
function checkCrossKindSwitch(session, requestedModel) {
  const sessionAgentType = session.agentType || 'claude-code';
  const effectiveModel = requestedModel || session.model;
  const requestedAgentType = resolveAgentTypeFromModel(effectiveModel);
  if (requestedAgentType === sessionAgentType) return null;
  return {
    error: 'CROSS_KIND_MODEL_SWITCH',
    message: `Cannot switch agent kind mid-session (${agentLabel(sessionAgentType)} → ${agentLabel(requestedAgentType)})`,
  };
}

const router = Router();

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

// POST /api/sessions/:id/message - Send follow-up message
// Supports both JSON and multipart/form-data (for file attachments)
router.post('/:id/message', _upload.array('files', 10), handleUploadError, requireSessionAndProject, async (req, res) => {
  const content = req.body.content;
  const model = req.body.model || null; // Model to use for this message
  const files = req.files || [];

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (req.session_.status !== 'waiting' && req.session_.status !== 'stopped' && req.session_.status !== 'error') {
    return res.status(400).json({ error: 'Session is not waiting for input' });
  }

  const crossKindError = checkCrossKindSwitch(req.session_, model);
  if (crossKindError) {
    return res.status(400).json(crossKindError);
  }

  try {
    // Store file attachments if any - saves to disk in workingDirectory/.attachments
    const messageAttachments = attachments.createBatch(req.session_.id, null, files, req.workingDirectory);

    // Check if the message is a slash command/skill invocation (starts with "/")
    const resolved = await slashCommandService.resolvePromptSkillOrCommand(
      req.workingDirectory, content, req.project.systemPrompt || null
    );

    if (resolved) {
      continueSession(req.session_.id, resolved.userMessage, req.workingDirectory, { systemPrompt: resolved.systemPrompt, fileAttachments: messageAttachments, model }).catch((error) => {
        console.error(`Continue session error (${resolved.type}):`, error);
      });
      return res.json({ success: true });
    }

    // Standard plain text message
    continueSession(req.session_.id, content, req.workingDirectory, { systemPrompt: req.project.systemPrompt, fileAttachments: messageAttachments, model }).catch((error) => {
      console.error('Continue session error:', error);
    });
    res.json({ success: true });
  } catch (error) {
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

// GET /api/sessions/:id/workflow-latest-response - Get the most recent assistant response across the entire workflow
router.get('/:id/workflow-latest-response', requireSession, (req, res) => {
  try {
    // Find the root of the workflow
    const rootId = sessions.getRootSessionId(req.params.id);
    if (!rootId) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Collect all session IDs in the workflow
    const descendantIds = sessions.getAllDescendantIds(rootId);
    const allSessionIds = [rootId, ...descendantIds];

    // Find the most recent assistant message across all sessions
    const message = messages.getLatestAssistantMessageForSessions(allSessionIds);
    if (!message) {
      return res.status(404).json({ error: 'No assistant response found' });
    }

    // Look up the session name for context
    const messageSession = sessions.getById(message.sessionId);
    const sessionName = messageSession?.name || null;

    res.json({ message, sessionName });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
