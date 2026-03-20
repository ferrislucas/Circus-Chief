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
 * Validates that a prompt string is non-empty.
 * @param {string} prompt
 * @returns {boolean}
 */
function isValidPrompt(prompt) {
  return !!prompt && typeof prompt === 'string' && prompt.trim() !== '';
}

/**
 * Creates the initial user message for a draft session that has no messages yet.
 * @param {object} session - The session object
 * @param {string|undefined} optionsPrompt - Optional prompt from caller
 * @returns {object} The created message
 */
function createInitialMessage(session, optionsPrompt) {
  const promptToUse = optionsPrompt || session.pendingPrompt;
  if (!isValidPrompt(promptToUse)) {
    throw new DraftSessionError('No initial prompt found', 400);
  }

  const activeConv = conversations.getActiveBySessionId(session.id);
  if (!activeConv) {
    throw new DraftSessionError('No active conversation found', 500);
  }

  const initialMessage = messages.create(session.id, 'user', promptToUse, { toolUse: null, conversationId: activeConv.id });

  // Clear pendingPrompt since we've created the message
  sessions.update(session.id, { pendingPrompt: null });

  // Broadcast the new message
  broadcastToSession(session.id, WS_MESSAGE_TYPES.MESSAGE_CREATED, {
    sessionId: session.id,
    message: initialMessage,
  });

  return initialMessage;
}

/**
 * Returns the existing user message, optionally updating it with a new prompt.
 * @param {object} session - The session object
 * @param {object} existingMessage - The existing first user message
 * @param {string|undefined} optionsPrompt - Optional prompt from caller
 * @returns {object} The (possibly updated) message
 */
function resolveExistingMessage(session, existingMessage, optionsPrompt) {
  if (optionsPrompt === undefined) {
    return existingMessage;
  }

  if (!isValidPrompt(optionsPrompt)) {
    throw new DraftSessionError('Prompt must be a non-empty string', 400);
  }

  const updatedMessage = messages.updateContent(existingMessage.id, optionsPrompt);

  broadcastToSession(session.id, WS_MESSAGE_TYPES.MESSAGE_UPDATED, {
    sessionId: session.id,
    message: updatedMessage,
  });

  return updatedMessage;
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
  // Fallback chain: explicit request body > pendingModel (set at draft creation) > session.model > null (SDK default)
  const model = options.model || session.pendingModel || session.model || null;

  // Get all messages to find user messages
  const allMessages = messages.getBySessionId(session.id);
  const userMessages = allMessages.filter(msg => msg.role === 'user');

  // Get or create the initial user message (prompt)
  const initialMessage = userMessages.length === 0
    ? createInitialMessage(session, options.prompt)
    : resolveExistingMessage(session, userMessages[0], options.prompt);

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
