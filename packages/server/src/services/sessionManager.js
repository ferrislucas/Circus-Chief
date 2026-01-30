import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions, messages, workLogs, attachments, conversations, modelProviders } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES, DEFAULT_SERVER_PORT, DEFAULT_SYSTEM_PROMPT } from '@claudetools/shared';
import { updateTodos } from './todoStore.js';
import * as summaryService from './summaryService.js';
import { checkAndTriggerNextTemplate } from './templateTriggerService.js';
import * as diffService from './diffService.js';
import { createClaudeCodeSpawner, createRobustEnv } from './nodeSpawnHelper.js';
import { schedulerService } from './schedulerService.js';

/** @type {Map<string, string|null>} Track last message ID for end-of-turn work log association */
const lastMessageIds = new Map();

/** @type {Map<string, string>} Accumulate thinking content per session */
const thinkingAccumulators = new Map();

/** @type {Map<string, string>} Accumulate text content per session */
const textAccumulators = new Map();

/** @type {Map<string, { controller: AbortController }>} */
const activeSessions = new Map();

/** @type {Map<string, {inputTokens: number, outputTokens: number, lastMessageOutput: number, cacheReadInputTokens: number, cacheCreationInputTokens: number}>}
 * Current turn usage - accumulates across multiple messages within a turn
 * Keyed by conversationId (Issue #175)
 * - inputTokens: MAX seen across all messages (larger context with tool results)
 * - outputTokens: ACCUMULATED across all messages
 * - lastMessageOutput: Current message's output (to detect resets on message_start)
 */
const currentTurnUsage = new Map();

/** @type {Map<string, string>} Map sessionId -> conversationId for current turn */
const activeConversationIds = new Map();

/** @type {Map<string, string>} Track current model per session (updated on system.init) */
const currentModels = new Map();

/** @type {Map<string, number>} Estimated output tokens from streamed content (for real-time updates) */
const estimatedOutputTokens = new Map();

/**
 * Rough token estimation: ~4 characters per token (standard for English text)
 * @param {string} text
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Update current turn usage from stream events
 * Accumulates across multiple messages within a single turn
 * @param {string} conversationId
 * @param {Object} usage - Usage from stream event (snake_case)
 * @param {string} eventType - 'message_start' or 'message_delta'
 * @returns {Object} Total turn usage (accumulated + current message)
 */
function updateTurnUsage(conversationId, usage, eventType) {
  const current = currentTurnUsage.get(conversationId) || {
    inputTokens: 0,
    outputTokens: 0,
    lastMessageOutput: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };

  if (eventType === 'message_start') {
    // NEW MESSAGE STARTING
    // 1. Finalize previous message's output
    current.outputTokens += current.lastMessageOutput;
    // 2. Reset tracker for new message
    current.lastMessageOutput = 0;
    // 3. Reset estimated output when actual message starts
    estimatedOutputTokens.delete(conversationId);
    // 4. For input tokens, keep the MAX (larger context with tool results)
    current.inputTokens = Math.max(current.inputTokens, usage.input_tokens || 0);
    current.cacheReadInputTokens = Math.max(current.cacheReadInputTokens, usage.cache_read_input_tokens || 0);
    current.cacheCreationInputTokens = Math.max(current.cacheCreationInputTokens, usage.cache_creation_input_tokens || 0);
  } else if (eventType === 'message_delta') {
    // OUTPUT STREAMING - output_tokens is cumulative within this message
    current.lastMessageOutput = usage.output_tokens || 0;
    // Clear estimate when actual output tokens arrive
    estimatedOutputTokens.delete(conversationId);
  }

  currentTurnUsage.set(conversationId, current);

  // Return the TOTAL (accumulated + current message's output)
  return {
    inputTokens: current.inputTokens,
    outputTokens: current.outputTokens + current.lastMessageOutput,
    cacheReadInputTokens: current.cacheReadInputTokens,
    cacheCreationInputTokens: current.cacheCreationInputTokens,
  };
}

/** Check if mock mode is enabled (for E2E testing) */
const isMockMode = () => process.env.MOCK_CLAUDE === 'true';

/**
 * Get the base API URL for canvas and session operations.
 * Uses CLAUDETOOLS_API_URL environment variable if set, otherwise constructs
 * from the runtime port to ensure dynamic port handling.
 * @returns {string} The base API URL (e.g., http://localhost:5000)
 */
function getApiBaseUrl() {
  return process.env.CLAUDETOOLS_API_URL || `http://localhost:${process.env.PORT || DEFAULT_SERVER_PORT}`;
}

/**
 * Check if an error should trigger automatic rescheduling
 * @param {object} session - Session object
 * @param {Error} error - Error that occurred
 * @returns {boolean} True if should reschedule
 */
export function shouldRescheduleOnError(session, error) {
  const errorMessage = error.message.toLowerCase();

  // Check for token limit errors
  if (session.rescheduleOnTokenLimit) {
    if (
      errorMessage.includes('token') ||
      errorMessage.includes('context length') ||
      errorMessage.includes('max_tokens') ||
      errorMessage.includes('context window')
    ) {
      console.log('[SessionManager] Token limit error detected, rescheduling will be attempted');
      console.log('[SessionManager] Error:', error.message);
      console.log('[SessionManager] Session config: rescheduleOnTokenLimit=true, rescheduleDelayMinutes=', session.rescheduleDelayMinutes);
      return true;
    }
  } else {
    console.log('[SessionManager] rescheduleOnTokenLimit is false, skipping token limit rescheduling');
  }

  // Check for service errors
  if (session.rescheduleOnServiceError) {
    if (
      errorMessage.includes('overloaded') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('503') ||
      errorMessage.includes('529') ||
      errorMessage.includes('unavailable') ||
      errorMessage.includes('service unavailable') ||
      errorMessage.includes('too many requests')
    ) {
      console.log('[SessionManager] Service error detected, rescheduling will be attempted');
      console.log('[SessionManager] Error:', error.message);
      console.log('[SessionManager] Session config: rescheduleOnServiceError=true, rescheduleDelayMinutes=', session.rescheduleDelayMinutes);
      return true;
    }
  } else {
    console.log('[SessionManager] rescheduleOnServiceError is false, skipping service error rescheduling');
  }

  console.log('[SessionManager] Error does not match any rescheduling triggers');
  console.log('[SessionManager] Session config: rescheduleOnTokenLimit=', session.rescheduleOnTokenLimit, ', rescheduleOnServiceError=', session.rescheduleOnServiceError);
  return false;
}

/**
 * Check if session should be proactively rescheduled based on token count
 * Called after processing each message to check token thresholds
 * @param {string} sessionId - Session ID
 * @returns {Promise<boolean>} True if rescheduled
 */
export async function _checkProactiveReschedule(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.rescheduleAtTokenCount) {
    return false;
  }

  const totalTokens = session.inputTokens + session.outputTokens;
  if (totalTokens >= session.rescheduleAtTokenCount) {
    console.log(
      `[SessionManager] Proactive token threshold reached: ${totalTokens.toLocaleString()}/${session.rescheduleAtTokenCount.toLocaleString()}`
    );

    // Check if we've reached limits
    if (schedulerService.hasReachedLimits(session)) {
      console.log('[SessionManager] Cannot reschedule - limits reached');
      return false;
    }

    // Gracefully reschedule
    await schedulerService.rescheduleSession(
      sessionId,
      `Token threshold reached (${totalTokens.toLocaleString()} tokens)`
    );
    return true;
  }

  return false;
}

/**
 * Handle template triggering if a session has a nextTemplateId configured
 * Called after Claude finishes any turn (runSession or continueSession)
 * @param {string} sessionId
 */
async function handleTemplateTriggerIfNeeded(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.nextTemplateId) {
    return;
  }

  // Wait for summary to be generated (templates use summary data)
  await summaryService.generateSummaryNow(sessionId);

  // Trigger the template to create a new session
  await checkAndTriggerNextTemplate(sessionId);

  // Clear the template from the session (it's been triggered)
  sessions.update(sessionId, { nextTemplateId: null });

  // Broadcast the update so UI reflects the cleared template
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: session.projectId,
    sessionId: sessionId,
    session: { ...session, nextTemplateId: null }
  });
}

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
2. **Create a Plan**: Write a detailed implementation plan to a file:
   - Write your plan to: \`~/.claude/plans/<descriptive-name>.md\`
   - Create the file using the Write tool
   - Include in your plan:
     - Files that need to be created or modified
     - Order of changes
     - Key implementation decisions
     - Potential risks or edge cases
3. **Get Approval**: Present the plan to the user by putting it on the canvas and wait for user approval before proceeding
4. **Implement**: Only after approval, implement the changes step by step

CRITICAL: Do NOT start coding until you have presented a plan and received approval. Always write the plan file to \`~/.claude/plans/\` directory.

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

  // Yield message_start event with initial usage (enables real-time token updates)
  yield {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: prompt.split(' ').length, // Simple estimate: one token per word
          output_tokens: 0,
        },
      },
    },
  };

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

  // Yield message_delta events to simulate streaming output tokens (enables real-time token updates)
  // Send multiple deltas to simulate streaming
  const words = responseText.split(' ');
  let outputTokens = 0;
  for (const word of words) {
    outputTokens += 2; // Simulate 2 tokens per word
    yield {
      type: 'stream_event',
      event: {
        type: 'message_delta',
        delta: { type: 'text_delta', text: word + ' ' },
        usage: { output_tokens: outputTokens },
      },
    };
    // Small delay to simulate streaming
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  // Yield assistant message with text
  yield {
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: responseText }],
    },
  };

  // Yield result event with usage
  yield {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.001,
    usage: {
      input_tokens: prompt.split(' ').length,
      output_tokens: outputTokens,
    },
  };
}

/**
 * Build system prompt with canvas write instructions
 * @param {string} sessionId
 * @returns {string}
 */
function buildCanvasWriteSystemPrompt(sessionId) {
  const apiUrl = getApiBaseUrl();
  return `When you generate artifacts that should be displayed on the canvas (images, markdown documents, code snippets, data visualizations, PDFs), POST them to:

POST ${apiUrl}/api/sessions/${sessionId}/canvas
Body: {"filePath": "/path/to/file"}

The file type is automatically detected from the file extension. Supported formats:
- Images: .png, .jpg, .jpeg, .gif, .webp, .svg, .bmp
- PDFs: .pdf
- Markdown: .md, .mdx
- Code: .js, .ts, .py, .go, .rs, .java, etc.
- JSON: .json
- Text: .txt, .log, .csv`;
}

/**
 * Build system prompt with canvas read instructions
 * @param {string} sessionId
 * @returns {string}
 */
function buildCanvasReadSystemPrompt(sessionId) {
  const apiUrl = getApiBaseUrl();
  return `## Reading from Canvas

To list all files on the canvas:
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/canvas
\`\`\`

To read a specific file from the canvas (returns file path for Read tool):
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/canvas/file/{filename}
\`\`\`

Response: { filePath, type, mimeType, createdAt, version, totalVersions }

Then use the Read tool on the returned filePath to view the content.

Supported types: images, PDFs, markdown, text, JSON

### Accessing Historical Versions

If you need to access an earlier version of a file:
\`\`\`bash
curl ${apiUrl}/api/sessions/${sessionId}/canvas/file/{filename}/history/{version}
\`\`\`

Where version 1 = oldest, and higher numbers are newer versions.`;
}

/**
 * Build session API instructions for Claude to create/modify sessions
 * @param {string} sessionId - Current session ID
 * @param {string} projectId - Current project ID
 * @returns {string}
 */
function buildSessionApiInstructions(sessionId, projectId) {
  const apiUrl = getApiBaseUrl();

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
Optional fields: \`name\`, \`mode\`, \`thinkingEnabled\` (boolean), \`gitBranch\`, \`gitMode\`, \`parentSessionId\` (to create a child session)

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
 * Resolve the provider for a given model ID
 * Looks up which provider owns the model, or returns null for Anthropic defaults
 * @param {string|null} modelId - The model ID to look up
 * @returns {Object|null} Provider object or null if using Anthropic default
 */
function resolveProviderFromModel(modelId) {
  return modelProviders.getProviderByModelId(modelId);
}

/**
 * Build environment variables from provider configuration
 * @param {Object|null} provider - Provider object
 * @returns {Object} Environment variables to add to session env
 */
function buildProviderEnv(provider) {
  if (!provider) {
    console.log('[SessionManager] buildProviderEnv: No provider, using SDK defaults');
    return {}; // Use SDK defaults
  }

  const env = {};

  if (provider.baseUrl) {
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
  }
  if (provider.authToken) {
    // Set BOTH ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN
    // The SDK prioritizes ANTHROPIC_API_KEY, so we must set it to override
    // any user's existing ANTHROPIC_API_KEY in their environment
    env.ANTHROPIC_API_KEY = provider.authToken;
    env.ANTHROPIC_AUTH_TOKEN = provider.authToken;
  }
  if (provider.defaultOpusModel) {
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = provider.defaultOpusModel;
  }
  if (provider.defaultSonnetModel) {
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = provider.defaultSonnetModel;
  }
  if (provider.defaultHaikuModel) {
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = provider.defaultHaikuModel;
  }
  if (provider.apiTimeoutMs) {
    env.API_TIMEOUT_MS = String(provider.apiTimeoutMs);
  }

  // Parse additional env vars
  if (provider.additionalEnvVars) {
    Object.assign(env, provider.additionalEnvVars);
  }

  console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" env vars:`, {
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? '[SET]' : '[NOT SET]',
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? '[SET]' : '[NOT SET]',
    ANTHROPIC_DEFAULT_SONNET_MODEL: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  });

  return env;
}

/**
 * Build environment variables for Claude SDK based on provider and session settings.
 * Always returns a robust env with Node in PATH to prevent ENOENT errors.
 * @param {Object|null} provider - Provider object or null for Anthropic defaults
 * @param {boolean} thinkingEnabled - Whether thinking mode is enabled
 * @returns {Object}
 */
function buildSessionEnv(provider, thinkingEnabled = false) {
  const baseEnv = createRobustEnv(process.env);
  const providerEnv = buildProviderEnv(provider);

  // Combine all env vars
  const sessionEnv = {
    ...baseEnv,
    ...providerEnv, // Add provider env vars
  };

  // When no custom provider is configured, explicitly exclude ANTHROPIC_* variables
  // from the environment to ensure SDK uses its defaults (not user's env vars)
  if (!provider) {
    delete sessionEnv.ANTHROPIC_API_KEY;
    delete sessionEnv.ANTHROPIC_AUTH_TOKEN;
    delete sessionEnv.ANTHROPIC_BASE_URL;
  }

  // Add thinking tokens if enabled
  if (thinkingEnabled) {
    sessionEnv.MAX_THINKING_TOKENS = '10240';
  }

  return sessionEnv;
}

/**
 * Build worktree context for system prompt if session uses git worktree
 * @param {Object} session - Session object
 * @returns {string} Worktree context or empty string
 */
function buildWorktreeContext(session) {
  if (!session || !session.gitWorktree) {
    return '';
  }

  return `## Git Worktree Session

This session is running in an isolated git worktree:
- Worktree path: ${session.gitWorktree}
- Branch: ${session.gitBranch || 'unknown'}

CRITICAL: Do NOT use \`cd\` to navigate to the main repository. Your working directory is already set to the worktree. Running \`cd /home/ubuntu/workspace/claudetools.io && ...\` will escape the worktree isolation and affect the main repository instead.`;
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
  const session = sessions.getById(sessionId);
  const canvasWriteInstructions = buildCanvasWriteSystemPrompt(sessionId);
  const canvasReadInstructions = buildCanvasReadSystemPrompt(sessionId);
  const sessionApiInstructions = buildSessionApiInstructions(sessionId, projectId);
  const attachmentsContext = getSessionAttachmentsContext(sessionId);
  const worktreeContext = buildWorktreeContext(session);
  const basePrompt = customSystemPrompt || DEFAULT_SYSTEM_PROMPT;

  // Prepend plan mode instructions if in plan mode
  const modePrompt = mode === 'plan' ? PLAN_MODE_PROMPT : '';

  // Build prompt parts, filtering out empty sections
  const parts = [modePrompt, basePrompt, worktreeContext, attachmentsContext, canvasWriteInstructions, canvasReadInstructions, sessionApiInstructions].filter(
    Boolean
  );

  return parts.join('\n\n');
}

/**
 * Format an array of messages as a readable transcript.
 * Handles different message types and truncates long content.
 * @param {Array} messageArray - Array of message objects with role and content
 * @returns {string} Formatted transcript
 */
function formatConversationHistory(messageArray) {
  return messageArray.map(msg => {
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    // Truncate very long messages to avoid context overflow
    const content = msg.content.length > 10000
      ? msg.content.substring(0, 10000) + '\n[... message truncated ...]'
      : msg.content;
    return `${role}: ${content}`;
  }).join('\n\n');
}

/**
 * Build a context string from previous conversation messages.
 * Used when switching models mid-conversation to maintain context without resuming.
 * @param {string} conversationId - The conversation ID
 * @returns {string} Formatted conversation history as context, or empty string if no messages
 */
function buildConversationContextForModelSwitch(conversationId) {
  const conversationMessages = messages.getByConversationId(conversationId);

  // Don't include the last user message (that's the current prompt)
  const previousMessages = conversationMessages.slice(0, -1);

  if (previousMessages.length === 0) {
    return '';
  }

  const transcript = formatConversationHistory(previousMessages);

  return `<conversation_history>
The following is the conversation history from this session. You switched to a different model mid-conversation, so you're seeing this context to maintain continuity. Continue naturally from where the conversation left off.

${transcript}
</conversation_history>

`;
}

/**
 * Build a context string from previous conversation messages for branched conversations.
 * Used when a conversation is branched and has no claudeSessionId (can't resume).
 * @param {string} conversationId - The conversation ID
 * @returns {string} Formatted conversation history as context, or empty string if no messages
 */
function buildConversationContextForBranch(conversationId) {
  const conversationMessages = messages.getByConversationId(conversationId);

  // Don't include the last user message (that's the current prompt)
  const previousMessages = conversationMessages.slice(0, -1);

  if (previousMessages.length === 0) {
    return '';
  }

  const transcript = formatConversationHistory(previousMessages);

  return `<conversation_history>
The following is the conversation history from this branched session. This is a continuation of a previous conversation. Continue naturally from where the conversation left off, taking into account the full context of what was discussed before.

${transcript}
</conversation_history>

`;
}

/**
 * Run a Claude session
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {string|null} systemPrompt - Custom system prompt from project settings
 * @param {Array} fileAttachments - File attachments for context
 * @param {string|null} model - Claude model to use
 */
export async function runSession(sessionId, prompt, workingDirectory, systemPrompt = null, fileAttachments = [], model = null) {
  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  try {
    // Get session for settings
    const session = sessions.getById(sessionId);

    // Get the active conversation for this session (created in SessionRepository.create)
    const activeConversation = conversations.ensureActiveConversation(sessionId);
    activeConversationIds.set(sessionId, activeConversation.id);
    console.log(`[SESSION] runSession: ensured active conversation ${activeConversation.id} for session ${sessionId}`);

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

    // Derive provider from the model ID (returns null for Anthropic/SDK defaults)
    const provider = resolveProviderFromModel(model);
    const sessionEnv = buildSessionEnv(provider, session.thinkingEnabled);

    const queryParams = isMockMode()
      ? { prompt: promptWithAttachments }
      : {
          prompt: promptWithAttachments,
          options: {
            cwd: workingDirectory,
            abortController: controller,
            includePartialMessages: true,
            permissionMode: getPermissionModeForSession(session.mode),
            settingSources: ['project'],
            env: sessionEnv,
            spawnClaudeCodeProcess: createClaudeCodeSpawner(),
            model: model,
            systemPrompt: buildSystemPromptConfig(sessionId, session.projectId, systemPrompt, session.mode),
          },
        };

    // Log query params for debugging third-party provider issues
    console.log(`[SessionManager] runSession query params:`, {
      model: queryParams.options?.model || '[not set - using SDK default]',
      hasEnv: !!queryParams.options?.env,
      envBaseUrl: queryParams.options?.env?.ANTHROPIC_BASE_URL || '[not set]',
      envApiKey: queryParams.options?.env?.ANTHROPIC_API_KEY ? '[SET]' : '[not set]',
      envAuthToken: queryParams.options?.env?.ANTHROPIC_AUTH_TOKEN ? '[SET]' : '[not set]',
    });

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

      // Check if session should be proactively rescheduled based on token threshold
      const wasRescheduled = await _checkProactiveReschedule(sessionId);
      if (wasRescheduled) {
        return; // Session was rescheduled, don't continue with normal completion
      }

      // Trigger summary generation when session completes a turn
      summaryService.onSessionActivity(sessionId);

      // Broadcast changes update when turn completes (real-time indicator)
      const currentSession = sessions.getById(sessionId);
      if (currentSession) {
        await broadcastChangesUpdate(sessionId, currentSession.projectId, workingDirectory);
      }

      // Check if template should be triggered after turn completion
      await handleTemplateTriggerIfNeeded(sessionId);
    }
  } catch (error) {
    console.error('Session error:', error);
    console.error('Error stack:', error.stack);
    if (!controller.signal.aborted) {
      // Check if we should reschedule instead of marking as error
      const session = sessions.getById(sessionId);
      if (session && shouldRescheduleOnError(session, error)) {
        const rescheduled = await schedulerService.rescheduleSession(sessionId, error.message);
        if (rescheduled) {
          console.log(`[SessionManager] Session ${sessionId} rescheduled due to error`);
          // Don't throw error or set error status - session is rescheduled
          return;
        }
        // If rescheduling failed (limits reached), fall through to error handling
      }

      // Normal error handling (no reschedule or reschedule limits reached)
      sessions.update(sessionId, { status: 'error', error: error.message });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });
      // Trigger summary generation on error
      summaryService.onSessionComplete(sessionId);
    }
    throw error;
  } finally {
    textAccumulators.delete(sessionId);
    thinkingAccumulators.delete(sessionId);
    currentModels.delete(sessionId);
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
 * @param {string|null} model - Model to use for this message
 */
export async function continueSession(sessionId, content, workingDirectory, systemPrompt = null, fileAttachments = [], model = null) {
  // [MODEL AUDIT] Log model received in continueSession
  console.log(`[MODEL AUDIT - SessionManager] continueSession called with model: "${model}"`);

  // Check if session is already running
  if (activeSessions.has(sessionId)) {
    throw new Error('Session is already processing');
  }

  // Get the session to retrieve the Claude session ID and settings
  const session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  try {
    // Ensure there's an active conversation for this session
    const activeConversation = conversations.ensureActiveConversation(sessionId);
    activeConversationIds.set(sessionId, activeConversation.id);
    console.log(`[SESSION] continueSession: ensured active conversation ${activeConversation.id} for session ${sessionId}`);

    // Each conversation has its own Claude session context
    // If null, Claude will start a fresh session (no resume)

    // Store the user message with conversation ID
    const message = messages.create(sessionId, 'user', content, null, activeConversation.id);
    console.log(`[SESSION] continueSession: created user message ${message.id} in conversation ${activeConversation.id}`);
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
      message,
      conversationId: activeConversation.id, // Include conversation context
    });
    console.log(`[SESSION] continueSession: broadcast user message ${message.id} to conversation ${activeConversation.id}`);

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

    // Derive provider from the model ID (returns null for Anthropic/SDK defaults)
    const provider = resolveProviderFromModel(model);
    const sessionEnv = buildSessionEnv(provider, session.thinkingEnabled);

    // Check if model changed from the conversation's last model
    // When model changes, we can't resume the previous session - thinking blocks and
    // session context may be incompatible between different models/providers
    const modelChanged = model && activeConversation.model && model !== activeConversation.model;

    // [MODEL AUDIT] Log model change detection
    console.log(`[MODEL AUDIT - SessionManager] Model change check:`, {
      requestedModel: model,
      conversationModel: activeConversation.model,
      modelChanged,
      conversationClaudeSessionId: activeConversation.claudeSessionId,
    });

    if (modelChanged) {
      console.log(`[SESSION] Model changed from "${activeConversation.model}" to "${model}" - including conversation context`);
    }

    // Only resume if we have a session ID AND model hasn't changed
    const canResume = activeConversation.claudeSessionId && !modelChanged;

    // [MODEL AUDIT] Log resume decision
    console.log(`[MODEL AUDIT - SessionManager] Resume decision: canResume=${canResume}`);

    // When model changes, include conversation history as context so the new model
    // can continue naturally without needing to resume the incompatible session
    const conversationContext = modelChanged
      ? buildConversationContextForModelSwitch(activeConversation.id)
      : '';
    const promptWithContext = conversationContext + promptWithAttachments;

    // [MODEL AUDIT] Log SDK query options
    console.log(`[MODEL AUDIT - SessionManager] SDK query options:`, {
      model: model,
      resume: canResume ? activeConversation.claudeSessionId : null,
      hasConversationContext: conversationContext.length > 0,
    });

    const queryParams = isMockMode()
      ? { prompt: promptWithContext }
      : {
          prompt: promptWithContext,
          options: {
            cwd: workingDirectory,
            abortController: controller,
            includePartialMessages: true,
            permissionMode: getPermissionModeForSession(session.mode),
            settingSources: ['project'],
            // Use conversation's claudeSessionId for context isolation
            // Only pass resume if we have an existing session AND model hasn't changed
            ...(canResume && { resume: activeConversation.claudeSessionId }),
            env: sessionEnv,
            spawnClaudeCodeProcess: createClaudeCodeSpawner(),
            model: model,
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

      // Check if session should be proactively rescheduled based on token threshold
      const wasRescheduled = await _checkProactiveReschedule(sessionId);
      if (wasRescheduled) {
        return; // Session was rescheduled, don't continue with normal completion
      }

      // Trigger summary generation when session completes a turn
      summaryService.onSessionActivity(sessionId);

      // Broadcast changes update when turn completes (real-time indicator)
      const currentSession = sessions.getById(sessionId);
      if (currentSession) {
        await broadcastChangesUpdate(sessionId, currentSession.projectId, workingDirectory);
      }

      // Check if template should be triggered after turn completion
      await handleTemplateTriggerIfNeeded(sessionId);
    }
  } catch (error) {
    console.error('Continue session error:', error);
    console.error('Error stack:', error.stack);
    if (!controller.signal.aborted) {
      // Check if we should reschedule instead of marking as error
      const session = sessions.getById(sessionId);
      if (session && shouldRescheduleOnError(session, error)) {
        const rescheduled = await schedulerService.rescheduleSession(sessionId, error.message);
        if (rescheduled) {
          console.log(`[SessionManager] Session ${sessionId} rescheduled due to error`);
          // Don't throw error or set error status - session is rescheduled
          return;
        }
        // If rescheduling failed (limits reached), fall through to error handling
      }

      // Normal error handling (no reschedule or reschedule limits reached)
      sessions.update(sessionId, { status: 'error', error: error.message });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });
      // Trigger summary generation on error
      summaryService.onSessionComplete(sessionId);
    }
    throw error;
  } finally {
    textAccumulators.delete(sessionId);
    thinkingAccumulators.delete(sessionId);
    currentModels.delete(sessionId);
    activeSessions.delete(sessionId);
  }
}

/**
 * Continue a session when the user message is already stored (e.g., from branching)
 * This triggers Claude's response without creating a new user message
 * @param {string} sessionId
 * @param {string} conversationId - The conversation to continue (must have an existing user message)
 * @param {string} workingDirectory
 * @param {string|null} systemPrompt - Custom system prompt from project settings
 * @param {string|null} model - Model to use for this message
 */
export async function continueSessionWithExistingMessage(sessionId, conversationId, workingDirectory, systemPrompt = null, model = null) {
  // Check if session is already running
  if (activeSessions.has(sessionId)) {
    throw new Error('Session is already processing');
  }

  // Get the session to retrieve settings
  const session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  // Get the conversation
  const conversation = conversations.getById(conversationId);
  if (!conversation || conversation.sessionId !== sessionId) {
    throw new Error('Conversation not found');
  }

  // Get the last user message from the conversation to use as the prompt
  const conversationMessages = messages.getByConversationId(conversationId);
  const lastUserMessage = [...conversationMessages].reverse().find(m => m.role === 'user');
  if (!lastUserMessage) {
    throw new Error('No user message found in conversation');
  }

  const controller = new AbortController();
  activeSessions.set(sessionId, { controller });

  try {
    // Make sure this conversation is active
    if (!conversation.isActive) {
      conversations.update(conversationId, { isActive: true });
    }
    activeConversationIds.set(sessionId, conversationId);

    // Update status to running
    sessions.update(sessionId, { status: 'running' });
    broadcastSessionStatus(sessionId, 'running');

    // Use the existing user message content as the prompt
    // Note: We do NOT create a new user message here - it already exists

    // Choose between mock and real query based on environment
    const queryFn = isMockMode() ? mockQuery : query;

    // Derive provider from the model ID (returns null for Anthropic/SDK defaults)
    const provider = resolveProviderFromModel(model);
    const sessionEnv = buildSessionEnv(provider, session.thinkingEnabled);

    // Check if model changed from the conversation's last model
    // When model changes, we can't resume the previous session - thinking blocks and
    // session context may be incompatible between different models/providers
    const modelChanged = model && conversation.model && model !== conversation.model;
    if (modelChanged) {
      console.log(`[SESSION] Model changed from "${conversation.model}" to "${model}" - including conversation context`);
    }

    // Check if this is a branched conversation without a claudeSessionId (can't resume)
    // Branched conversations have a parentConversationId but may not have their own claudeSessionId yet
    const isBranchedWithoutSession = conversation.parentConversationId && !conversation.claudeSessionId;
    if (isBranchedWithoutSession) {
      console.log(`[SESSION] Branched conversation without claudeSessionId - including conversation history`);
    }

    // Only resume if we have a session ID AND model hasn't changed
    const canResume = conversation.claudeSessionId && !modelChanged;

    // Build conversation context when either:
    // 1. Model changed - context needed because we can't resume with incompatible session
    // 2. Branched conversation without session - context needed because there's no session to resume
    let conversationContext = '';
    if (modelChanged) {
      conversationContext = buildConversationContextForModelSwitch(conversationId);
    } else if (isBranchedWithoutSession) {
      conversationContext = buildConversationContextForBranch(conversationId);
    }
    const promptWithContext = conversationContext + lastUserMessage.content;

    const queryParams = isMockMode()
      ? { prompt: promptWithContext }
      : {
          prompt: promptWithContext,
          options: {
            cwd: workingDirectory,
            abortController: controller,
            includePartialMessages: true,
            permissionMode: getPermissionModeForSession(session.mode),
            settingSources: ['project'],
            // Use conversation's claudeSessionId for context isolation
            // Only pass resume if we have an existing session AND model hasn't changed
            ...(canResume && { resume: conversation.claudeSessionId }),
            env: sessionEnv,
            spawnClaudeCodeProcess: createClaudeCodeSpawner(),
            model: model,
            systemPrompt: buildSystemPromptConfig(sessionId, session.projectId, systemPrompt, session.mode),
          },
        };

    // Run the query
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

      // Check if session should be proactively rescheduled based on token threshold
      const wasRescheduled = await _checkProactiveReschedule(sessionId);
      if (wasRescheduled) {
        return; // Session was rescheduled, don't continue with normal completion
      }

      // Trigger summary generation when session completes a turn
      summaryService.onSessionActivity(sessionId);

      // Broadcast changes update when turn completes (real-time indicator)
      const currentSession = sessions.getById(sessionId);
      if (currentSession) {
        await broadcastChangesUpdate(sessionId, currentSession.projectId, workingDirectory);
      }

      // Check if template should be triggered after turn completion
      await handleTemplateTriggerIfNeeded(sessionId);
    }
  } catch (error) {
    console.error('Continue session with existing message error:', error);
    console.error('Error stack:', error.stack);
    if (!controller.signal.aborted) {
      // Check if we should reschedule instead of marking as error
      const session = sessions.getById(sessionId);
      if (session && shouldRescheduleOnError(session, error)) {
        const rescheduled = await schedulerService.rescheduleSession(sessionId, error.message);
        if (rescheduled) {
          console.log(`[SessionManager] Session ${sessionId} rescheduled due to error`);
          // Don't throw error or set error status - session is rescheduled
          return;
        }
        // If rescheduling failed (limits reached), fall through to error handling
      }

      // Normal error handling (no reschedule or reschedule limits reached)
      sessions.update(sessionId, { status: 'error', error: error.message });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });
      // Trigger summary generation on error
      summaryService.onSessionComplete(sessionId);
    }
    throw error;
  } finally {
    textAccumulators.delete(sessionId);
    thinkingAccumulators.delete(sessionId);
    currentModels.delete(sessionId);
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
  // Check if session has been cleaned up (aborted/deleted) - don't process events for deleted sessions
  if (!activeSessions.has(sessionId)) {
    return;
  }

  switch (event.type) {
    case 'system': {
      // Store Claude's session info
      if (event.subtype === 'init') {
        // [MODEL AUDIT] Log model reported by SDK in system.init
        console.log(`[MODEL AUDIT - SDK Event] system.init received:`, {
          sessionId,
          sdkSessionId: event.session_id,
          modelFromSDK: event.model,
        });

        // Save Claude session ID to the active conversation for context isolation
        const activeConversation = conversations.getActiveBySessionId(sessionId);
        if (activeConversation) {
          conversations.update(activeConversation.id, {
            claudeSessionId: event.session_id,
          });
          console.log(`[MODEL AUDIT - SDK Event] Updated conversation ${activeConversation.id} claudeSessionId to ${event.session_id}`);
        }
        // Track current model for this session (used when creating messages)
        currentModels.set(sessionId, event.model);
        console.log(`[MODEL AUDIT - SDK Event] Set currentModels[${sessionId}] = "${event.model}"`);
        // Still update session's model and capture available slash commands
        sessions.update(sessionId, {
          model: event.model,
          slashCommands: JSON.stringify(event.slash_commands || []),
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

      // NOTE: Do NOT use assistant event usage for broadcasting
      // The stream events already provide real-time usage updates via message_start and message_delta
      // Using assistant event would double-count the usage

      if (textContent) {
        const toolUse = toolUseBlocks.length > 0 ? toolUseBlocks : null;
        const activeConversation = conversations.getActiveBySessionId(sessionId);
        const conversationId = activeConversation?.id || null;
        const currentModel = currentModels.get(sessionId) || null;
        // [MODEL AUDIT] Log model being saved with message
        console.log(`[MODEL AUDIT - Message Save] Creating assistant message with model: "${currentModel}"`);
        const message = messages.create(sessionId, 'assistant', textContent, toolUse, conversationId, currentModel);
        console.log(`[MODEL AUDIT - Message Save] Created message ${message.id} in conversation ${conversationId} with model: "${currentModel}"`);
        console.log(`[SESSION] assistant event: created assistant message ${message.id} in conversation ${conversationId} with model ${currentModel}`);

        // Associate pending work logs with this message immediately
        // This ensures work logs are attached to the correct message, not just the last one
        associateAndBroadcastWorkLogs(sessionId, message.id);

        // Track the message ID in case there are trailing work logs after the last message
        lastMessageIds.set(sessionId, message.id);

        // Broadcast message with conversationId for proper routing
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_MESSAGE, {
          message,
          conversationId, // Include conversation context to prevent ambiguity
        });
        console.log(`[SESSION] assistant event: broadcast assistant message ${message.id} to conversation ${conversationId}`);

        // Clear partial text on client now that complete message has been sent
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
          sessionId,
          text: '',
        });

        // Trigger debounced summary generation on new message
        summaryService.onSessionActivity(sessionId);
      }

      // Check for TodoWrite tool and update todos
      // NOTE: This must be OUTSIDE the if (textContent) block because Claude can call
      // TodoWrite without any accompanying text content (tool-only messages)
      if (toolUseBlocks.length > 0) {
        const todoWrite = toolUseBlocks.find((t) => t.name === 'TodoWrite');
        if (todoWrite?.input?.todos) {
          // Get active conversation to scope todos to it
          const activeConv = conversations.getActiveBySessionId(sessionId);
          if (activeConv) {
            updateTodos(sessionId, activeConv.id, todoWrite.input.todos);
          }
        }
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
      // Handle message_start for initial usage (input tokens) - enables real-time token updates
      if (event.event?.type === 'message_start') {
        // Clear text accumulator for fresh message
        textAccumulators.delete(sessionId);

        const usage = event.event?.message?.usage;
        if (usage) {
          const conversationId = activeConversationIds.get(sessionId);
          const turnUsage = updateTurnUsage(conversationId, usage, 'message_start');
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
            sessionId,
            conversationId,
            usage: turnUsage,
            isFinal: false,
          });
        }
      }

      // Handle message_delta for streaming output tokens
      if (event.event?.type === 'message_delta') {
        const usage = event.event?.usage;
        if (usage) {
          const conversationId = activeConversationIds.get(sessionId);
          const turnUsage = updateTurnUsage(conversationId, usage, 'message_delta');
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
            sessionId,
            conversationId,
            usage: turnUsage,
            isFinal: false,
          });
        }
      }

      // Real-time streaming - handle content_block_delta events
      if (event.event?.type === 'content_block_delta') {
        const delta = event.event.delta;

        if (delta?.type === 'text_delta' && delta.text) {
          // Accumulate text content
          const current = textAccumulators.get(sessionId) || '';
          const accumulated = current + delta.text;
          textAccumulators.set(sessionId, accumulated);

          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_PARTIAL, {
            sessionId,
            text: accumulated,
          });

          // ISSUE 2: Estimate tokens from streamed content for real-time output token updates
          const conversationId = activeConversationIds.get(sessionId);
          if (conversationId) {
            const currentEstimate = estimatedOutputTokens.get(conversationId) || 0;
            const newEstimate = currentEstimate + estimateTokens(delta.text);
            estimatedOutputTokens.set(conversationId, newEstimate);

            // Get current turn usage and add estimated output
            const turnData = currentTurnUsage.get(conversationId) || {
              inputTokens: 0,
              outputTokens: 0,
              lastMessageOutput: 0,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            };

            // Broadcast usage update with estimated tokens
            const broadcastUsage = {
              inputTokens: turnData.inputTokens,
              outputTokens: turnData.outputTokens + Math.max(turnData.lastMessageOutput, newEstimate),
              cacheReadInputTokens: turnData.cacheReadInputTokens,
              cacheCreationInputTokens: turnData.cacheCreationInputTokens,
            };

            broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
              sessionId,
              conversationId,
              usage: broadcastUsage,
              isFinal: false,
              isEstimate: true,  // Flag so UI can show "~" prefix if desired
            });
          }
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

      // Handle content_block_stop - finalize accumulated thinking and text
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

        // Clear text accumulator when content block finishes
        // The text has been finalized into a message
        textAccumulators.delete(sessionId);
      }
      break;
    }

    case 'result': {
      if (event.subtype === 'error') {
        sessions.update(sessionId, { status: 'error', error: event.error });
        broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: event.error });
        // Broadcast error status to project subscribers for session list updates
        broadcastSessionStatus(sessionId, 'error');
        // Generate summary on error
        summaryService.onSessionComplete(sessionId);
      } else {
        // Store cost info and broadcast to project subscribers
        if (event.total_cost_usd !== undefined) {
          sessions.update(sessionId, { costUsd: event.total_cost_usd });
        }

        // Store final usage stats to conversation (Issue #175)
        if (event.usage || event.modelUsage) {
          // Extract from modelUsage if available (has more detail)
          const modelUsageEntry = event.modelUsage
            ? Object.values(event.modelUsage)[0]
            : null;

          // Use the model from system.init (stored in currentModels) rather than modelUsage keys
          // because modelUsage can contain multiple models when sub-agents are used (e.g., Opus using Haiku)
          // and Object.keys()[0] would pick the wrong model
          const primaryModel = currentModels.get(sessionId) || Object.keys(event.modelUsage || {})[0] || null;

          const turnUsage = {
            inputTokens: modelUsageEntry?.inputTokens || event.usage?.input_tokens || 0,
            outputTokens: modelUsageEntry?.outputTokens || event.usage?.output_tokens || 0,
            cacheReadInputTokens: modelUsageEntry?.cacheReadInputTokens || event.usage?.cache_read_input_tokens || 0,
            cacheCreationInputTokens: modelUsageEntry?.cacheCreationInputTokens || event.usage?.cache_creation_input_tokens || 0,
            webSearchRequests: modelUsageEntry?.webSearchRequests || 0,
            contextWindow: modelUsageEntry?.contextWindow || 200000,
            model: primaryModel,
          };

          // [MODEL AUDIT] Log model from result event
          console.log(`[MODEL AUDIT - Result Event] Turn usage model extraction:`, {
            modelUsageKeys: Object.keys(event.modelUsage || {}),
            primaryModelFromInit: currentModels.get(sessionId),
            extractedModel: turnUsage.model,
            rawModelUsage: event.modelUsage,
          });

          // Get the conversation ID for this session's current turn
          const conversationId = activeConversationIds.get(sessionId);
          const currentConversation = conversationId ? conversations.getById(conversationId) : null;

          // Update conversation with cumulative usage (add to existing)
          let updatedConversation = null;
          if (currentConversation) {
            // [MODEL AUDIT] Log conversation model before update
            console.log(`[MODEL AUDIT - Conversation Update] Before updateUsage:`, {
              conversationId,
              currentConversationModel: currentConversation.model,
              newModelFromUsage: turnUsage.model,
            });

            const cumulativeConversationUsage = {
              inputTokens: (currentConversation.inputTokens || 0) + turnUsage.inputTokens,
              outputTokens: (currentConversation.outputTokens || 0) + turnUsage.outputTokens,
              cacheReadInputTokens: (currentConversation.cacheReadInputTokens || 0) + turnUsage.cacheReadInputTokens,
              cacheCreationInputTokens: (currentConversation.cacheCreationInputTokens || 0) + turnUsage.cacheCreationInputTokens,
              webSearchRequests: (currentConversation.webSearchRequests || 0) + turnUsage.webSearchRequests,
              contextWindow: turnUsage.contextWindow,
              model: turnUsage.model,
            };

            updatedConversation = conversations.updateUsage(conversationId, cumulativeConversationUsage);
            // [MODEL AUDIT] Log conversation model after update
            console.log(`[MODEL AUDIT - Conversation Update] After updateUsage:`, {
              conversationId,
              updatedConversationModel: updatedConversation?.model,
            });
          }

          // Also update session-level usage (aggregate of all conversations) for backward compatibility
          const currentSession = sessions.getById(sessionId);
          const cumulativeSessionUsage = {
            inputTokens: (currentSession.inputTokens || 0) + turnUsage.inputTokens,
            outputTokens: (currentSession.outputTokens || 0) + turnUsage.outputTokens,
            cacheReadInputTokens: (currentSession.cacheReadInputTokens || 0) + turnUsage.cacheReadInputTokens,
            cacheCreationInputTokens: (currentSession.cacheCreationInputTokens || 0) + turnUsage.cacheCreationInputTokens,
            webSearchRequests: (currentSession.webSearchRequests || 0) + turnUsage.webSearchRequests,
            contextWindow: turnUsage.contextWindow,
          };

          const updatedSession = sessions.updateUsage(sessionId, cumulativeSessionUsage);

          // Broadcast final usage update with conversationId
          broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_USAGE_UPDATE, {
            sessionId,
            conversationId,
            usage: updatedConversation ? {
              inputTokens: updatedConversation.inputTokens,
              outputTokens: updatedConversation.outputTokens,
              cacheReadInputTokens: updatedConversation.cacheReadInputTokens,
              cacheCreationInputTokens: updatedConversation.cacheCreationInputTokens,
              webSearchRequests: updatedConversation.webSearchRequests,
              contextWindow: updatedConversation.contextWindow,
            } : cumulativeSessionUsage,
            turnUsage,
            isFinal: true,
          });

          // Also broadcast session update for session list
          broadcastToProject(updatedSession.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
            projectId: updatedSession.projectId,
            sessionId,
            session: updatedSession,
          });

          // Broadcast conversation update for real-time UI updates
          if (updatedConversation) {
            broadcastToSession(sessionId, WS_MESSAGE_TYPES.CONVERSATION_UPDATED, {
              sessionId,
              conversation: updatedConversation,
            });
          }

          // Clean up turn usage and estimated tokens
          currentTurnUsage.delete(conversationId);
          estimatedOutputTokens.delete(conversationId);
          activeConversationIds.delete(sessionId);
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
  // Broadcast to session subscribers (for session detail view)
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status });

  // Also broadcast SESSION_UPDATED to project subscribers (for session list updates)
  const session = sessions.getById(sessionId);
  if (session) {
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: session.projectId,
      sessionId,
      session: { ...session, status },
    });
  }
}

/**
 * Compute and broadcast changes state when turn completes
 * Called after status is set to "waiting" to provide real-time changes update
 * @param {string} sessionId
 * @param {string} projectId
 * @param {string} workingDirectory
 */
async function broadcastChangesUpdate(sessionId, projectId, workingDirectory) {
  try {
    const changes = await diffService.getChanges(workingDirectory);
    const hasChanges = !!(changes.staged || changes.unstaged || changes.untracked);

    // Count total files with changes
    // Parse diff output to count unique files
    const parseFilesFromDiff = (diff) => {
      if (!diff) return 0;
      const matches = diff.match(/^diff --git a\/(.+) b\//gm) || [];
      return matches.length;
    };

    const stagedCount = parseFilesFromDiff(changes.staged);
    const unstagedCount = parseFilesFromDiff(changes.unstaged);
    const untrackedCount = parseFilesFromDiff(changes.untracked);
    const changeCount = stagedCount + unstagedCount + untrackedCount;

    // Broadcast to session subscribers
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.CHANGES_UPDATE, {
      sessionId,
      hasChanges,
      changeCount,
    });
  } catch (error) {
    // Silently fail - changes indicator is not critical
    // This handles cases like non-git directories or permission errors
    console.error(`Failed to compute changes for session ${sessionId}:`, error.message);
  }
}
