import { sessions, messages, projects, conversations, attachments } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as slashCommandService from './slashCommandService.js';

/**
 * Validates that a session is a draft (waiting status with no assistant messages).
 * @param {object} session - The session object
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateDraftSession(session) {
  if (session.status !== 'waiting') {
    return { valid: false, error: 'Session must be in waiting status to start' };
  }

  const allMessages = messages.getBySessionId(session.id);
  const hasAssistantMessages = allMessages.some(msg => msg.role === 'assistant');
  if (hasAssistantMessages) {
    return { valid: false, error: 'Session is not a draft - it already has responses' };
  }

  return { valid: true };
}

/**
 * Validate that a prompt is non-empty.
 * @param {*} prompt
 * @returns {boolean}
 */
function isValidPrompt(prompt) {
  return prompt && typeof prompt === 'string' && prompt.trim() !== '';
}

/**
 * Create the initial user message for a draft session.
 * @param {object} session
 * @param {string} promptToUse
 * @returns {object} The created message
 */
function createInitialMessage(session, promptToUse) {
  const activeConv = conversations.getActiveBySessionId(session.id);
  if (!activeConv) {
    throw new DraftSessionError('No active conversation found', 500);
  }

  const initialMessage = messages.create(session.id, 'user', promptToUse, { toolUse: null, conversationId: activeConv.id });
  sessions.update(session.id, { pendingPrompt: null });

  broadcastToSession(session.id, WS_MESSAGE_TYPES.MESSAGE_CREATED, {
    sessionId: session.id,
    message: initialMessage,
  });

  return initialMessage;
}

/**
 * Update an existing initial message with a new prompt.
 * @param {object} session
 * @param {object} initialMessage
 * @param {string} newPrompt
 * @returns {object} The updated message
 */
function updateInitialMessage(session, initialMessage, newPrompt) {
  const updatedMessage = messages.updateContent(initialMessage.id, newPrompt);

  broadcastToSession(session.id, WS_MESSAGE_TYPES.MESSAGE_UPDATED, {
    sessionId: session.id,
    message: updatedMessage,
  });

  return updatedMessage;
}

/**
 * Get or create the initial user message for a draft session.
 * @param {object} session
 * @param {object} options
 * @returns {object} The initial message
 */
function getOrCreateInitialMessage(session, options) {
  const allMessages = messages.getBySessionId(session.id);
  const userMessages = allMessages.filter(msg => msg.role === 'user');

  // No existing user messages - create one
  if (userMessages.length === 0) {
    const promptToUse = options.prompt || session.pendingPrompt;
    if (!isValidPrompt(promptToUse)) {
      throw new DraftSessionError('No initial prompt found', 400);
    }
    return createInitialMessage(session, promptToUse);
  }

  // Existing user message - optionally update it
  let initialMessage = userMessages[0];
  if (options.prompt !== undefined) {
    if (!isValidPrompt(options.prompt)) {
      throw new DraftSessionError('Prompt must be a non-empty string', 400);
    }
    initialMessage = updateInitialMessage(session, initialMessage, options.prompt);
  }

  return initialMessage;
}

/**
 * Starts a draft session by resolving the prompt, creating messages if needed,
 * and kicking off the session manager.
 *
 * @param {object} session - The session object (from req.session_)
 * @param {object} options
 * @param {string} [options.prompt] - Optional new prompt to use/override
 * @param {string} [options.model] - Optional model override
 * @returns {Promise<object>} The updated session
 */
export async function startDraft(session, options = {}) {
  const project = projects.getById(session.projectId);
  if (!project) {
    throw new DraftSessionError('Project not found', 404);
  }

  // Use gitWorktree if set, otherwise use project's working directory
  const workingDirectory = session.gitWorktree || project.workingDirectory;

  // Model to use for this session (optional - SDK will use default if not provided)
  const model = options.model || session.pendingModel || session.model || null;

  // Get or create the initial user message
  const initialMessage = getOrCreateInitialMessage(session, options);
  const finalPrompt = initialMessage.content;

  // Get session attachments for context
  const sessionAttachments = attachments.getBySessionId(session.id);

  // Update session status to starting and clear pendingModel (mirrors pendingPrompt cleanup above)
  sessions.update(session.id, { status: 'starting', pendingModel: null });

  // Resolve skill/command invocations so skill body goes into system prompt
  const resolved = await slashCommandService.resolvePromptSkillOrCommand(
    workingDirectory, finalPrompt, project.systemPrompt
  );
  const effectivePrompt = resolved ? resolved.userMessage : finalPrompt;
  const effectiveSystemPrompt = resolved ? resolved.systemPrompt : project.systemPrompt;

  // Start session manager (non-blocking)
  const { runSession } = await import('./sessionManager.js');
  runSession(session.id, effectivePrompt, workingDirectory, { systemPrompt: effectiveSystemPrompt, fileAttachments: sessionAttachments, model }).catch((error) => {
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

  return sessions.getById(session.id);
}

/**
 * Custom error class for draft session operations, includes HTTP status code.
 */
export class DraftSessionError extends Error {
  /**
   * @param {string} message
   * @param {number} statusCode
   */
  constructor(message, statusCode) {
    super(message);
    this.name = 'DraftSessionError';
    this.statusCode = statusCode;
  }
}
