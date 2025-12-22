import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions, messages, workLogs, attachments } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES, DEFAULT_SERVER_PORT, DEFAULT_SYSTEM_PROMPT } from '@claudetools/shared';
import { updateTodos } from './todoStore.js';
import * as summaryService from './summaryService.js';

/** @type {Map<string, string|null>} Track last message ID for end-of-turn work log association */
const lastMessageIds = new Map();

/** @type {Map<string, string>} Accumulate thinking content per session */
const thinkingAccumulators = new Map();

/** @type {Map<string, { controller: AbortController }>} */
const activeSessions = new Map();

/** Check if mock mode is enabled (for E2E testing) */
const isMockMode = () => process.env.MOCK_CLAUDE === 'true';

/**
 * Build prompt with file attachment context for the current turn
 * Includes text file contents inline, describes other file types
 * @param {string} prompt - Original prompt
 * @param {Array} fileAttachments - Array of attachment objects
 * @returns {string} Prompt with file context
 */
export function buildPromptWithAttachments(prompt, fileAttachments) {
  if (!fileAttachments || fileAttachments.length === 0) {
    return prompt;
  }

  const attachmentSections = fileAttachments.map((att) => {
    // Check if it's a text-based file that can be included inline
    const isTextFile =
      att.mimeType.startsWith('text/') ||
      att.mimeType === 'application/json' ||
      att.mimeType === 'application/javascript' ||
      att.mimeType === 'application/xml' ||
      att.mimeType === 'application/x-yaml' ||
      att.mimeType === 'application/x-sh';

    if (isTextFile && att.content) {
      try {
        const textContent = Buffer.from(att.content, 'base64').toString('utf-8');
        return `\n--- File: ${att.filename} (${att.mimeType}) ---\n${textContent}\n--- End of ${att.filename} ---`;
      } catch {
        return `\n[Attached file: ${att.filename} (${att.mimeType}, ${att.size} bytes) - could not decode]`;
      }
    } else if (att.mimeType.startsWith('image/')) {
      return `\n[Attached image: ${att.filename} (${att.mimeType}, ${att.size} bytes)]`;
    } else if (att.mimeType === 'application/pdf') {
      return `\n[Attached PDF: ${att.filename} (${att.size} bytes)]`;
    } else {
      return `\n[Attached file: ${att.filename} (${att.mimeType}, ${att.size} bytes)]`;
    }
  });

  return `${prompt}\n\n## Attached Files${attachmentSections.join('\n')}`;
}

/**
 * Format file size in human-readable format
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get session attachments context for system prompt
 * Returns a string describing all files attached to the session that Claude can read
 * @param {string} sessionId - Session ID
 * @returns {string} Attachments context for system prompt
 */
export function getSessionAttachmentsContext(sessionId) {
  const sessionAttachments = attachments.getBySessionId(sessionId);

  // Only include attachments that have been saved to disk
  const readableAttachments = sessionAttachments.filter((att) => att.filePath);

  if (readableAttachments.length === 0) {
    return '';
  }

  const fileList = readableAttachments
    .map((att) => `- \`${att.filePath}\` (${att.filename}, ${att.mimeType}, ${formatFileSize(att.size)})`)
    .join('\n');

  return `## Session Attached Files

The user has attached the following files to this session. You can read these files at any time using your Read tool:

${fileList}

These files persist throughout the conversation. When the user asks about attached files, use the Read tool with the file paths above.`;
}

/**
 * Map session mode to SDK permissionMode
 * @param {string} mode - Session mode ('plan', 'standard', 'yolo')
 * @returns {string} SDK permissionMode value
 */
export function getPermissionModeForSession(mode) {
  switch (mode) {
    case 'yolo':
      return 'bypassPermissions';
    case 'plan':
    case 'standard':
    default:
      return 'default';
  }
}

/** Plan mode system prompt instructions */
export const PLAN_MODE_PROMPT = `## Plan Mode Active

You are in PLAN mode. Before implementing any changes:

1. **Analyze the Request**: Understand what the user is asking for
2. **Create a Plan**: Write a detailed implementation plan with:
   - Files that need to be created or modified
   - Order of changes
   - Key implementation decisions
   - Potential risks or edge cases
3. **Get Approval**: Present the plan and wait for user approval before proceeding
4. **Implement**: Only after approval, implement the changes step by step

Do NOT start coding until you have presented a plan and received approval.

`;

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

  // Simulate thinking (creates a work log)
  yield {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: 'Analyzing the request...' },
    },
  };
  yield {
    type: 'stream_event',
    event: { type: 'content_block_stop' },
  };

  // Simulate tool use (creates work logs for input)
  const toolUseId = 'mock-tool-' + Date.now();
  yield {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'Bash',
          input: { command: 'echo "mock command"' },
        },
      ],
    },
  };

  // Simulate tool result (creates work log for output)
  yield {
    type: 'tool_result',
    tool_name: 'Bash',
    content: 'mock command output',
  };

  await new Promise((resolve) => setTimeout(resolve, 50));

  // Generate a mock response based on the user's message
  const responseText = `Mock response to: "${prompt}"`;

  // Yield assistant message with text
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

For images, use filePath to reference an image file on disk:
Body: {"type": "image", "filePath": "/path/to/image.png", "title": "..."}`;
}

/**
 * Build session API instructions for Claude to create/modify sessions
 * @param {string} sessionId - Current session ID
 * @param {string} projectId - Current project ID
 * @returns {string}
 */
function buildSessionApiInstructions(sessionId, projectId) {
  const apiUrl = process.env.CLAUDETOOLS_API_URL || `http://localhost:${process.env.PORT || DEFAULT_SERVER_PORT}`;

  return `## Session Management API

You can create and modify sessions in this system using curl or similar HTTP tools. Use the Bash tool to execute these commands.

**Base URL:** ${apiUrl}
**Current Session ID:** ${sessionId}
**Current Project ID:** ${projectId}

### Create a New Session
\`\`\`bash
curl -X POST ${apiUrl}/api/projects/${projectId}/sessions \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Your task description here", "name": "Optional session name"}'
\`\`\`
Optional fields: \`name\`, \`mode\`, \`thinkingEnabled\` (boolean), \`gitBranch\`, \`gitMode\`

### Send a Follow-up Message to a Session
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/<session_id>/message \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Your follow-up message"}'
\`\`\`

### List All Active Sessions
\`\`\`bash
curl ${apiUrl}/api/sessions
\`\`\`

### Get Session Details
\`\`\`bash
curl ${apiUrl}/api/sessions/<session_id>
\`\`\`

### Get Session Messages
\`\`\`bash
curl ${apiUrl}/api/sessions/<session_id>/messages
\`\`\`

### Stop a Running Session
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/<session_id>/stop
\`\`\`

### Restart a Completed/Errored Session
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/<session_id>/restart
\`\`\`

### Update Session Settings
\`\`\`bash
curl -X PATCH ${apiUrl}/api/sessions/<session_id> \\
  -H "Content-Type: application/json" \\
  -d '{"thinkingEnabled": true}'
\`\`\`

### Delete a Session
\`\`\`bash
curl -X DELETE ${apiUrl}/api/sessions/<session_id>
\`\`\`

### Project Operations

#### List All Projects
\`\`\`bash
curl ${apiUrl}/api/projects
\`\`\`

#### Get Project Details
\`\`\`bash
curl ${apiUrl}/api/projects/<project_id>
\`\`\`

#### List Sessions for a Project
\`\`\`bash
curl ${apiUrl}/api/projects/<project_id>/sessions
\`\`\`

#### Create a New Project
\`\`\`bash
curl -X POST ${apiUrl}/api/projects \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Project Name", "workingDirectory": "/path/to/directory"}'
\`\`\`
Optional field: \`systemPrompt\`

### Session Notes

#### Get Session Notes
\`\`\`bash
curl ${apiUrl}/api/sessions/<session_id>/notes
\`\`\`

#### Create a Note
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/<session_id>/notes \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Note content"}'
\`\`\`

### Session Summary

#### Get Session Summary
\`\`\`bash
curl "${apiUrl}/api/sessions/<session_id>/summary?generate=true"
\`\`\`

#### Regenerate Summary
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/<session_id>/summary
\`\`\``;
}

/**
 * Build environment variables for Claude SDK based on session settings
 * @param {Object} session
 * @returns {Object|undefined}
 */
function buildSessionEnv(session) {
  if (!session.thinkingEnabled) {
    return undefined; // Let SDK use process.env by default
  }
  // Merge with process.env to preserve PATH and other essential env vars
  return {
    ...process.env,
    MAX_THINKING_TOKENS: '10240',
  };
}

/**
 * Build the full system prompt configuration
 * @param {string} sessionId
 * @param {string} projectId
 * @param {string|null} customSystemPrompt - Custom system prompt from project settings
 * @param {string} mode - Session mode ('plan', 'standard', 'yolo')
 * @returns {string} System prompt string
 */
export function buildSystemPromptConfig(sessionId, projectId, customSystemPrompt, mode) {
  const canvasInstructions = buildCanvasSystemPrompt(sessionId);
  const sessionApiInstructions = buildSessionApiInstructions(sessionId, projectId);
  const attachmentsContext = getSessionAttachmentsContext(sessionId);
  const basePrompt = customSystemPrompt || DEFAULT_SYSTEM_PROMPT;

  // Prepend plan mode instructions if in plan mode
  const modePrompt = mode === 'plan' ? PLAN_MODE_PROMPT : '';

  // Build prompt parts, filtering out empty sections
  const parts = [modePrompt, basePrompt, attachmentsContext, canvasInstructions, sessionApiInstructions].filter(
    Boolean
  );

  return parts.join('\n\n');
}

/**
 * Run a Claude session
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {string|null} systemPrompt - Custom system prompt from project settings
 * @param {Array} fileAttachments - File attachments for context
 */
export async function runSession(sessionId, prompt, workingDirectory, systemPrompt = null, fileAttachments = []) {
  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  try {
    // Get session for settings
    const session = sessions.getById(sessionId);

    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Note: Initial user message is already created in SessionRepository.create()
    // Associate any pending attachments with the initial message
    const initialMessage = messages.getBySessionId(sessionId)[0];
    if (initialMessage && fileAttachments.length > 0) {
      attachments.updateMessageIdForSession(sessionId, initialMessage.id);
    }

    // Build prompt with attachment context
    const promptWithAttachments = buildPromptWithAttachments(prompt, fileAttachments);

    // Choose between mock and real query based on environment
    const queryFn = isMockMode() ? mockQuery : query;

    // Build environment variables for thinking mode
    const sessionEnv = buildSessionEnv(session);

    const queryParams = isMockMode()
      ? { prompt: promptWithAttachments }
      : {
          prompt: promptWithAttachments,
          options: {
            cwd: workingDirectory,
            abortController: controller,
            includePartialMessages: true,
            permissionMode: getPermissionModeForSession(session.mode),
            ...(sessionEnv && { env: sessionEnv }),
            systemPrompt: buildSystemPromptConfig(sessionId, session.projectId, systemPrompt, session.mode),
          },
        };

    // Run the query with the SDK (or mock)
    for await (const event of queryFn(queryParams)) {
      if (controller.signal.aborted) break;

      await handleStreamEvent(sessionId, event);
    }

    // Associate work logs with the last message now that the turn is complete
    const lastMessageId = lastMessageIds.get(sessionId);
    if (lastMessageId) {
      associateAndBroadcastWorkLogs(sessionId, lastMessageId);
      lastMessageIds.delete(sessionId);
    }

    // Session ready for follow-up - set to waiting instead of completed
    const activeSession = activeSessions.get(sessionId);
    if (activeSession && !controller.signal.aborted) {
      sessions.update(sessionId, { status: 'waiting' });
      broadcastSessionStatus(sessionId, 'waiting');
      // Trigger summary generation when session completes a turn
      summaryService.onSessionActivity(sessionId);
    }
  } catch (error) {
    console.error('Session error:', error);
    console.error('Error stack:', error.stack);
    if (!controller.signal.aborted) {
      sessions.update(sessionId, { status: 'error', error: error.message });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });
      // Trigger summary generation on error
      summaryService.onSessionComplete(sessionId);
    }
    throw error;
  } finally {
    activeSessions.delete(sessionId);
  }
}

/**
 * Continue a session with a follow-up message
 * @param {string} sessionId
 * @param {string} content
 * @param {string} workingDirectory
 * @param {string|null} systemPrompt - Custom system prompt from project settings
 * @param {Array} fileAttachments - File attachments for context
 */
export async function continueSession(sessionId, content, workingDirectory, systemPrompt = null, fileAttachments = []) {
  // Check if session is already running
  if (activeSessions.has(sessionId)) {
    throw new Error('Session is already processing');
  }

  // Get the session to retrieve the Claude session ID and settings
  const session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  if (!session.claudeSessionId && !isMockMode()) {
    throw new Error('Session has no Claude session ID - cannot resume');
  }

  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  try {
    // Store the user message
    const message = messages.create(sessionId, 'user', content);
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, { message });

    // Associate any pending attachments with the message
    if (fileAttachments.length > 0) {
      attachments.updateMessageIdForSession(sessionId, message.id);
    }

    // Build prompt with attachment context
    const promptWithAttachments = buildPromptWithAttachments(content, fileAttachments);

    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Choose between mock and real query based on environment
    const queryFn = isMockMode() ? mockQuery : query;

    // Build environment variables for thinking mode
    const sessionEnv = buildSessionEnv(session);

    const queryParams = isMockMode()
      ? { prompt: promptWithAttachments }
      : {
          prompt: promptWithAttachments,
          options: {
            cwd: workingDirectory,
            abortController: controller,
            includePartialMessages: true,
            permissionMode: getPermissionModeForSession(session.mode),
            resume: session.claudeSessionId,
            ...(sessionEnv && { env: sessionEnv }),
            systemPrompt: buildSystemPromptConfig(sessionId, session.projectId, systemPrompt, session.mode),
          },
        };

    // Resume the session with the new message
    for await (const event of queryFn(queryParams)) {
      if (controller.signal.aborted) break;

      await handleStreamEvent(sessionId, event);
    }

    // Associate work logs with the last message now that the turn is complete
    const lastMessageId = lastMessageIds.get(sessionId);
    if (lastMessageId) {
      associateAndBroadcastWorkLogs(sessionId, lastMessageId);
      lastMessageIds.delete(sessionId);
    }

    // Session ready for more follow-ups
    const activeSession = activeSessions.get(sessionId);
    if (activeSession && !controller.signal.aborted) {
      sessions.update(sessionId, { status: 'waiting' });
      broadcastSessionStatus(sessionId, 'waiting');
      // Trigger summary generation when session completes a turn
      summaryService.onSessionActivity(sessionId);
    }
  } catch (error) {
    console.error('Continue session error:', error);
    console.error('Error stack:', error.stack);
    if (!controller.signal.aborted) {
      sessions.update(sessionId, { status: 'error', error: error.message });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });
      // Trigger summary generation on error
      summaryService.onSessionComplete(sessionId);
    }
    throw error;
  } finally {
    activeSessions.delete(sessionId);
  }
}

/**
 * Stop a running or waiting session
 * @param {string} sessionId
 */
export async function stopSession(sessionId) {
  const sessionData = activeSessions.get(sessionId);

  if (sessionData) {
    // Session is actively processing - abort it
    sessionData.controller.abort();
    activeSessions.delete(sessionId);
  }
  // If not in activeSessions, session may have crashed or be waiting
  // Either way, we can still update the status to stopped

  sessions.update(sessionId, { status: 'stopped' });
  broadcastSessionStatus(sessionId, 'stopped');
}

/**
 * Restart a completed or errored session (set back to stopped so it can receive messages)
 * @param {string} sessionId
 */
export function restartSession(sessionId) {
  // Clear any error and set status to stopped (allows sending new messages)
  sessions.update(sessionId, { status: 'stopped', error: null });
  broadcastSessionStatus(sessionId, 'stopped');
}

/**
 * Clean up an active session before deletion
 * @param {string} sessionId
 * @returns {boolean} true if session was active and cleaned up
 */
export function cleanupActiveSession(sessionId) {
  const sessionData = activeSessions.get(sessionId);
  if (sessionData) {
    sessionData.controller.abort();
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}

/**
 * Create and broadcast a work log entry
 * Work logs are always created as unassociated during the turn,
 * then associated with the message when the turn completes.
 * @param {string} sessionId
 * @param {string} type - 'thinking', 'tool_input', or 'tool_output'
 * @param {string} content
 * @param {string|null} toolName
 */
function createWorkLog(sessionId, type, content, toolName = null) {
  // Always create as unassociated - will be associated at end of turn
  const log = workLogs.create(sessionId, type, content, null, toolName);
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_WORK_LOG, {
    sessionId,
    log
  });
  return log;
}

/**
 * Associate pending work logs with a message and broadcast the event
 * @param {string} sessionId
 * @param {string} messageId
 */
function associateAndBroadcastWorkLogs(sessionId, messageId) {
  const associatedCount = workLogs.associatePendingLogs(sessionId, messageId);
  if (associatedCount > 0) {
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_WORK_LOGS_ASSOCIATED, {
      sessionId,
      messageId,
    });
  }
  return associatedCount;
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
        // Reset message tracking for new session
        lastMessageIds.delete(sessionId);
      }
      break;
    }

    case 'assistant': {
      // Extract text content from assistant message
      const textContent = event.message?.content
        ?.filter((c) => c.type === 'text')
        ?.map((c) => c.text)
        ?.join('\n');

      // Extract tool use for logging
      const toolUseBlocks = event.message?.content?.filter((c) => c.type === 'tool_use') || [];

      if (textContent) {
        const toolUse = toolUseBlocks.length > 0 ? toolUseBlocks : null;
        const message = messages.create(sessionId, 'assistant', textContent, toolUse);

        // Track the message ID for end-of-turn work log association
        lastMessageIds.set(sessionId, message.id);

        // Broadcast message
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, { message });

        // Check for TodoWrite tool and update todos
        if (toolUse) {
          const todoWrite = toolUse.find((t) => t.name === 'TodoWrite');
          if (todoWrite?.input?.todos) {
            updateTodos(sessionId, todoWrite.input.todos);
          }
        }

        // Trigger debounced summary generation on new message
        summaryService.onSessionActivity(sessionId);
      }

      // Note: Thinking content is logged via stream_event -> content_block_stop
      // to avoid duplicates (since includePartialMessages is always enabled)

      // Log tool use inputs
      for (const toolUse of toolUseBlocks) {
        const toolInput = JSON.stringify(toolUse.input, null, 2);
        createWorkLog(sessionId, 'tool_input', toolInput, toolUse.name);
      }
      break;
    }

    case 'tool_result': {
      // Log tool results/outputs
      const content = event.content || event.result || '';
      const toolName = event.tool_name || event.name || 'unknown';

      // Handle different content formats
      let logContent;
      if (typeof content === 'string') {
        logContent = content;
      } else if (Array.isArray(content)) {
        logContent = content
          .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
          .join('\n');
      } else {
        logContent = JSON.stringify(content, null, 2);
      }

      if (logContent) {
        createWorkLog(sessionId, 'tool_output', logContent, toolName);
      }
      break;
    }

    case 'stream_event': {
      // Real-time streaming - handle content_block_delta events
      if (event.event?.type === 'content_block_delta') {
        const delta = event.event.delta;

        if (delta?.type === 'text_delta' && delta.text) {
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
            sessionId,
            text: delta.text,
          });
        }

        // Handle thinking delta - accumulate and broadcast partial (don't create work log yet)
        if (delta?.type === 'thinking_delta' && delta.thinking) {
          const current = thinkingAccumulators.get(sessionId) || '';
          const accumulated = current + delta.thinking;
          thinkingAccumulators.set(sessionId, accumulated);

          // Broadcast partial thinking for real-time display
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_THINKING_PARTIAL, {
            sessionId,
            thinking: accumulated,
          });
        }
      }

      // Handle content_block_stop - finalize accumulated thinking
      if (event.event?.type === 'content_block_stop') {
        const accumulated = thinkingAccumulators.get(sessionId);
        if (accumulated) {
          // Create a single work log entry with the complete thinking content
          createWorkLog(sessionId, 'thinking', accumulated);
          thinkingAccumulators.delete(sessionId);

          // Clear partial thinking on client
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_THINKING_PARTIAL, {
            sessionId,
            thinking: null,
          });
        }
      }
      break;
    }

    case 'result': {
      if (event.subtype === 'error') {
        sessions.update(sessionId, { status: 'error', error: event.error });
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: event.error });
        // Generate summary on error
        summaryService.onSessionComplete(sessionId);
      } else {
        // Store cost info
        if (event.total_cost_usd !== undefined) {
          sessions.update(sessionId, { costUsd: event.total_cost_usd });
        }
      }
      // Note: Don't clear lastMessageIds here - let the post-loop association code handle it.
      // Clearing here was causing work logs to never be associated because the 'result' event
      // arrives before the loop ends, deleting the messageId before association can happen.
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
