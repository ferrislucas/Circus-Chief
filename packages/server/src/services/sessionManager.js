import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions, messages } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES, DEFAULT_SERVER_PORT } from '@claudetools/shared';

/** @type {Map<string, { controller: AbortController, inputResolve: Function | null }>} */
const activeSessions = new Map();

/**
 * Create an async generator for multi-turn conversation input
 * @param {string} sessionId
 * @param {string} initialPrompt
 * @yields {{ role: 'user', content: string }}
 */
async function* createInputGenerator(sessionId, initialPrompt) {
  // Yield initial prompt
  yield { role: 'user', content: initialPrompt };

  // Continue yielding follow-up messages until session ends
  while (true) {
    const sessionData = activeSessions.get(sessionId);
    if (!sessionData || sessionData.controller.signal.aborted) {
      return;
    }

    // Signal waiting for input
    sessions.update(sessionId, { status: 'waiting' });
    broadcastSessionStatus(sessionId, 'waiting');

    // Wait for user input (sendMessage will resolve this)
    const input = await new Promise((resolve) => {
      const session = activeSessions.get(sessionId);
      if (session) {
        session.inputResolve = resolve;
      }
    });

    // Check if session was aborted while waiting
    const currentSession = activeSessions.get(sessionId);
    if (!currentSession || currentSession.controller.signal.aborted) {
      return;
    }

    yield { role: 'user', content: input };
  }
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
 * Run a Claude session
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 */
export async function runSession(sessionId, prompt, workingDirectory) {
  const controller = new AbortController();
  activeSessions.set(sessionId, { controller, inputResolve: null });

  try {
    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Note: Initial user message is already created in SessionRepository.create()

    // Create async generator for multi-turn conversation support
    const inputGenerator = createInputGenerator(sessionId, prompt);

    // Run the query with the SDK using the input generator
    for await (const event of query({
      prompt: inputGenerator,
      options: {
        cwd: workingDirectory,
        abortController: controller,
        includePartialMessages: true,
        permissionMode: 'bypassPermissions',
        appendSystemPrompt: buildCanvasSystemPrompt(sessionId),
      },
    })) {
      if (controller.signal.aborted) break;

      await handleStreamEvent(sessionId, event);
    }

    // Session completed
    const session = activeSessions.get(sessionId);
    if (session && !controller.signal.aborted) {
      sessions.update(sessionId, { status: 'completed' });
      broadcastSessionStatus(sessionId, 'completed');
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
 * Send a follow-up message to a session
 * @param {string} sessionId
 * @param {string} content
 */
export async function sendMessage(sessionId, content) {
  const sessionData = activeSessions.get(sessionId);
  if (!sessionData) {
    throw new Error('Session is not active');
  }

  if (!sessionData.inputResolve) {
    throw new Error('Session is not waiting for input');
  }

  // Store the message
  const message = messages.create(sessionId, 'user', content);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, { message });

  // Update status
  sessions.update(sessionId, { status: 'running' });
  broadcastSessionStatus(sessionId, 'running');

  // Resolve the waiting input generator
  sessionData.inputResolve(content);
  sessionData.inputResolve = null;
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
