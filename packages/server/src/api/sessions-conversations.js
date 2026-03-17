import { Router } from 'express';
import { messages, conversations, projects } from '../database.js';
import { continueSessionWithExistingMessage } from '../services/sessionManager.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as summaryService from '../services/summaryService.js';
import { requireSession } from '../middleware/sessionLookup.js';

const router = Router();

// GET /api/sessions/:id/conversations - List all conversations for a session
router.get('/:id/conversations', requireSession, (req, res) => {
  // Use getBySessionIdWithBranchInfo to include branching metadata
  const sessionConversations = conversations.getBySessionIdWithBranchInfo(req.params.id);
  res.json(sessionConversations);
});

// POST /api/sessions/:id/conversations - Create new conversation
router.post('/:id/conversations', requireSession, async (req, res) => {
  // Block creating new conversation while session is running
  if (req.session_.status === 'running') {
    return res.status(400).json({ error: 'Cannot create new conversation while session is running' });
  }

  const { name } = req.body;

  // Auto-generate summary for the current active conversation before creating new one
  const previousActive = conversations.getActiveBySessionId(req.params.id);
  if (previousActive && !previousActive.summary && summaryService.isConversationSummaryEnabled(req.params.id)) {
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
router.patch('/:id/conversations/:convId', requireSession, async (req, res) => {
  const conversation = conversations.getById(req.params.convId);
  if (!conversation || conversation.sessionId !== req.params.id) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const { name, isActive } = req.body;

  // Block switching conversation while session is running
  if (isActive && req.session_.status === 'running') {
    return res.status(400).json({ error: 'Cannot switch conversation while session is running' });
  }

  // If switching to this conversation, generate summary for the previous active one
  if (isActive && !conversation.isActive) {
    const previousActive = conversations.getActiveBySessionId(req.params.id);
    if (previousActive && previousActive.id !== req.params.convId && !previousActive.summary &&
        summaryService.isConversationSummaryEnabled(req.params.id)) {
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
router.delete('/:id/conversations/:convId', requireSession, (req, res) => {
  // Block deleting conversation while session is running
  if (req.session_.status === 'running') {
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
router.post('/:id/conversations/:convId/summary', requireSession, async (req, res) => {
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
router.post('/:id/conversations/:convId/branch', requireSession, async (req, res) => {
  // Block branching while session is running
  if (req.session_.status === 'running') {
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

    // Generate summary for the previous active conversation before branching
    const previousActive = conversations.getActiveBySessionId(req.params.id);
    if (previousActive && !previousActive.summary && summaryService.isConversationSummaryEnabled(req.params.id)) {
      // Generate summary in background (don't block the request)
      summaryService.generateConversationSummary(req.params.id, previousActive.id).catch((err) => {
        console.error('Failed to generate conversation summary:', err);
      });
    }

    // Broadcast the new conversation to session subscribers
    broadcastToSession(req.params.id, WS_MESSAGE_TYPES.CONVERSATION_CREATED, {
      sessionId: req.params.id,
      conversation: branchConversation,
    });

    // Auto-submit to Claude: Start the session with the new prompt
    // The branch already has the user message, so we use continueSessionWithExistingMessage
    // which triggers Claude's response WITHOUT creating a duplicate user message
    try {
      const project = projects.getById(req.session_.projectId);
      const workingDirectory = req.session_.gitWorktree || project?.workingDirectory;
      if (workingDirectory) {
        await continueSessionWithExistingMessage(
          req.params.id,
          branchConversation.id,
          workingDirectory,
          { systemPrompt: project?.systemPrompt }
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

export default router;
