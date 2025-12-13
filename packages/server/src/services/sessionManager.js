import { sessions, messages } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES, DEFAULT_SERVER_PORT } from '@claudetools/shared';

/** @type {Map<string, { controller: AbortController, inputResolve: Function | null }>} */
const activeSessions = new Map();

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

    // Create async generator for multi-turn input
    const inputGenerator = createInputGenerator(sessionId);

    // Import Claude SDK dynamically (allows mocking in tests)
    let queryFn;
    try {
      const sdk = await import('@anthropic-ai/claude-code');
      queryFn = sdk.query;
    } catch {
      // For tests or when SDK is not available, use mock
      console.log('Claude SDK not available, using mock responses');
      queryFn = mockQuery;
    }

    // Set up environment variables for canvas access
    const env = {
      ...process.env,
      CLAUDETOOLS_SESSION_ID: sessionId,
      CLAUDETOOLS_API_URL: `http://localhost:${process.env.PORT || DEFAULT_SERVER_PORT}`,
    };

    // Run the query
    for await (const event of queryFn({
      prompt,
      cwd: workingDirectory,
      abortController: controller,
      userMessageGenerator: inputGenerator,
      options: {
        env,
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
 * Create async generator for multi-turn input
 * @param {string} sessionId
 * @returns {AsyncGenerator<string>}
 */
async function* createInputGenerator(sessionId) {
  while (true) {
    const sessionData = activeSessions.get(sessionId);
    if (!sessionData || sessionData.controller.signal.aborted) {
      return;
    }

    // Wait for user input
    sessions.update(sessionId, { status: 'waiting' });
    broadcastSessionStatus(sessionId, 'waiting');

    const input = await new Promise((resolve) => {
      const session = activeSessions.get(sessionId);
      if (session) {
        session.inputResolve = resolve;
      }
    });

    yield input;
  }
}

/**
 * Handle a stream event from Claude SDK
 * @param {string} sessionId
 * @param {Object} event
 */
async function handleStreamEvent(sessionId, event) {
  switch (event.type) {
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

    case 'result': {
      if (event.subtype === 'error') {
        sessions.update(sessionId, { status: 'error', error: event.error });
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { error: event.error });
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

/**
 * Mock query function for testing
 * @param {Object} options
 */
async function* mockQuery({ prompt }) {
  // Simulate assistant response
  yield {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: `I received your prompt: "${prompt}". This is a mock response.` }],
    },
  };

  // Simulate completion
  yield { type: 'result', subtype: 'success' };
}
