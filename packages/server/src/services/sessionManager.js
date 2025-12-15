import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions, messages } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES, DEFAULT_SERVER_PORT } from '@claudetools/shared';

/** @type {Map<string, { controller: AbortController }>} */
const activeSessions = new Map();

/** Check if mock mode is enabled (for E2E testing) */
const isMockMode = () => process.env.MOCK_CLAUDE === 'true';

/**
 * Mock query generator for E2E testing
 * Simulates the Claude SDK's behavior for multi-turn conversations
 * @param {Object} params
 * @param {string} params.prompt - The prompt string
 */
async function* mockQuery({ prompt }) {
  // Yield system init event
  yield {
    type: 'system',
    subtype: 'init',
    session_id: 'mock-session-' + Date.now(),
    model: 'claude-sonnet-4-5-20250929',
  };

  // Small delay to simulate processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Generate a mock response based on the user's message
  const responseText = `Mock response to: "${prompt}"`;

  // Yield assistant message
  yield {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: responseText }],
    },
  };

  // Yield result event
  yield {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.001,
  };
}

/**
 * Build system prompt with canvas instructions
 * @param {string} sessionId
 * @returns {string}
 */
function buildCanvasSystemPrompt(sessionId) {
  const apiUrl = process.env.CLAUDETOOLS_API_URL || `http://localhost:${process.env.PORT || DEFAULT_SERVER_PORT}`;
  return `When you generate artifacts that should be displayed on the canvas (images, markdown documents, code snippets, data visualizations), POST them to:
POST ${apiUrl}/api/sessions/${sessionId}/canvas
Body: {"type": "image|markdown|text|json", "content": "...", "title": "..."}

For images, use base64 encoding in the content field.`;
}

/**
 * Run a Claude query (initial or follow-up)
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {string|null} resumeSessionId - Claude session ID to resume (for follow-ups)
 */
async function runQuery(sessionId, prompt, workingDirectory, resumeSessionId = null) {
  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  try {
    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Choose between mock and real query based on environment
    const queryFn = isMockMode() ? mockQuery : query;

    const queryParams = isMockMode()
      ? { prompt }
      : {
          prompt,
          options: {
            cwd: workingDirectory,
            abortController: controller,
            includePartialMessages: true,
            permissionMode: 'bypassPermissions',
            appendSystemPrompt: buildCanvasSystemPrompt(sessionId),
            ...(resumeSessionId && { resume: resumeSessionId }),
          },
        };

    // Run the query with the SDK (or mock)
    for await (const event of queryFn(queryParams)) {
      if (controller.signal.aborted) break;

      await handleStreamEvent(sessionId, event);
    }

    // Session completed - set to waiting for follow-up
    const session = activeSessions.get(sessionId);
    if (session && !controller.signal.aborted) {
      sessions.update(sessionId, { status: 'waiting' });
      broadcastSessionStatus(sessionId, 'waiting');
    }
  } catch (error) {
    console.error('Session error:', error);
    console.error('Error stack:', error.stack);
    if (!controller.signal.aborted) {
      sessions.update(sessionId, { status: 'error', error: error.message });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { error: error.message });
    }
    throw error;
  } finally {
    activeSessions.delete(sessionId);
  }
}

/**
 * Run a Claude session (initial prompt)
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 */
export async function runSession(sessionId, prompt, workingDirectory) {
  // Note: Initial user message is already created in SessionRepository.create()
  await runQuery(sessionId, prompt, workingDirectory, null);
}

/**
 * Send a follow-up message to a session
 * @param {string} sessionId
 * @param {string} content
 */
export async function sendMessage(sessionId, content) {
  // Get the session to find the Claude session ID and working directory
  const session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  if (session.status !== 'waiting') {
    throw new Error('Session is not waiting for input');
  }

  if (!session.claudeSessionId && !isMockMode()) {
    throw new Error('No Claude session ID available for resume');
  }

  // Store the user message
  const message = messages.create(sessionId, 'user', content);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, { message });

  // Get working directory from project
  const { projects } = await import('../database.js');
  const project = projects.getById(session.projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  // Run a new query with resume to continue the conversation
  await runQuery(sessionId, content, project.workingDirectory, session.claudeSessionId);
}

/**
 * Stop a running session
 * @param {string} sessionId
 */
export async function stopSession(sessionId) {
  const sessionData = activeSessions.get(sessionId);
  if (!sessionData) {
    throw new Error('Session is not active');
  }

  sessionData.controller.abort();
  sessions.update(sessionId, { status: 'completed' });
  broadcastSessionStatus(sessionId, 'completed');
}

/**
 * Handle a stream event from Claude SDK
 * @param {string} sessionId
 * @param {Object} event
 */
async function handleStreamEvent(sessionId, event) {
  switch (event.type) {
    case 'system': {
      // Store Claude's session info
      if (event.subtype === 'init') {
        sessions.update(sessionId, {
          claudeSessionId: event.session_id,
          model: event.model,
        });
      }
      break;
    }

    case 'assistant': {
      // Extract text content from assistant message
      const textContent = event.message?.content
        ?.filter((c) => c.type === 'text')
        ?.map((c) => c.text)
        ?.join('\n');

      if (textContent) {
        const toolUse = event.message?.content?.filter((c) => c.type === 'tool_use') || null;
        const message = messages.create(sessionId, 'assistant', textContent, toolUse);
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, { message });
      }
      break;
    }

    case 'stream_event': {
      // Real-time streaming - handle content_block_delta events
      if (event.event?.type === 'content_block_delta' && event.event?.delta?.type === 'text_delta') {
        const partialText = event.event.delta.text;
        if (partialText) {
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
            sessionId,
            text: partialText,
          });
        }
      }
      break;
    }

    case 'result': {
      if (event.subtype === 'error') {
        sessions.update(sessionId, { status: 'error', error: event.error });
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { error: event.error });
      } else {
        // Store cost info
        if (event.total_cost_usd !== undefined) {
          sessions.update(sessionId, { costUsd: event.total_cost_usd });
        }
      }
      break;
    }
  }
}

/**
 * Broadcast session status update
 * @param {string} sessionId
 * @param {string} status
 */
function broadcastSessionStatus(sessionId, status) {
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status });
}
