import { sessions, attachments, projects, kanbanBoards, kanbanLanes } from '../database.js';
import { DEFAULT_SERVER_PORT, DEFAULT_SYSTEM_PROMPT } from '@circuschief/shared';
import { buildCommandButtonApiInstructions } from './commandButtonPrompts.js';

/**
 * Get the base API URL for canvas and session operations.
 * Uses CIRCUSCHIEF_API_URL environment variable if set, otherwise constructs
 * from the runtime port to ensure dynamic port handling.
 * @returns {string} The base API URL (e.g., http://localhost:5000)
 */
export function getApiBaseUrl() {
  return process.env.CIRCUSCHIEF_API_URL || `http://localhost:${process.env.PORT || DEFAULT_SERVER_PORT}`;
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

/**
 * Map session mode to the Codex CLI --sandbox flag value.
 *
 *   plan     → read-only           (parity with Claude plan mode's read-mostly posture)
 *   standard → workspace-write     (default; Codex can edit files in cwd)
 *   yolo     → danger-full-access  (parallels Claude's bypassPermissions)
 *
 * Note: `--full-auto` is intentionally NOT used — it is a shorthand that also
 * overrides approval policies, which would conflate two orthogonal concerns.
 *
 * @param {string} mode - Session mode ('plan', 'standard', 'yolo')
 * @returns {string} Codex sandbox mode
 */
export function getSandboxModeForSession(mode) {
  switch (mode) {
    case 'plan':
      return 'read-only';
    case 'yolo':
      return 'danger-full-access';
    case 'standard':
    default:
      return 'workspace-write';
  }
}

/**
 * Map session mode to Gemini CLI --approval-mode.
 *
 *   plan     -> plan
 *   standard -> auto_edit
 *   yolo     -> yolo
 *
 * @param {string} mode - Session mode ('plan', 'standard', 'yolo')
 * @returns {string} Gemini CLI approval mode
 */
export function getGeminiApprovalModeForSession(mode) {
  switch (mode) {
    case 'plan':
      return 'plan';
    case 'yolo':
      return 'yolo';
    case 'standard':
    default:
      return 'auto_edit';
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
 * Build system prompt with canvas write instructions
 * @param {object|null} session - Session object
 * @returns {string}
 */
function buildCanvasWriteSystemPrompt(session) {
  const apiUrl = getApiBaseUrl();
  const sessionId = session?.id || 'unknown-session';
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
 * @param {object|null} session - Session object
 * @returns {string}
 */
function buildCanvasReadSystemPrompt(session) {
  const apiUrl = getApiBaseUrl();
  const sessionId = session?.id || 'unknown-session';
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

/** Build workspace and session CRUD operations section */
function buildSessionCrudOps(apiUrl, projectId, sessionId, workspaceId) {
  return `### Create a New Workspace
\`\`\`bash
curl -X POST ${apiUrl}/api/projects/${projectId}/workspaces \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Your task description here"}'
\`\`\`
Use this to **start a completely new line of work**. Only \`prompt\` is required.
Optional fields: \`name\`, \`mode\`, \`thinkingEnabled\` (boolean), \`effortLevel\` (low/medium/high/max/auto), \`model\`, \`providerId\`, \`gitBranch\`, \`gitMode\`, \`templateId\`, \`nextTemplateId\`, \`startImmediately\`, \`scheduledAt\` (ISO 8601 date-time string with timezone, e.g. \`"2026-06-12T14:00:00Z"\`), \`autoRescheduleEnabled\`, \`rescheduleDelayMinutes\`, \`rescheduleOnTokenLimit\`, \`rescheduleOnServiceError\`, \`maxRescheduleCount\`, \`maxTotalTokens\`, and \`rescheduleAtTokenCount\`.

### Add a Session to this Workspace
\`\`\`bash
curl -X POST ${apiUrl}/api/workspaces/${workspaceId}/sessions \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Your task description here"}'
\`\`\`
Use this to **continue work inside the current workspace**. The new session is attached at the workspace root by default.
Pass \`"afterSessionId": "${sessionId}"\` to chain the new session directly after the current one (useful when you want the follow-on to be contextually linked to this session rather than the workspace root).
Optional fields: same as creating a workspace plus \`afterSessionId\`. Add \`scheduledAt\` to schedule the new session without starting it immediately. Only schedule a new *workspace* when starting genuinely independent work; for continuations, schedule a *session within this workspace* instead.

**Note:** "workspace" here refers to a group of related sessions. This is distinct from the Codex \`workspace-write\` sandbox mode — those are separate concepts.

### Send a Follow-up Message
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/<session_id>/message \\
  -H "Content-Type: application/json" \\
  -d '{"content": "Your follow-up message"}'
\`\`\`

### List All Active Sessions / Get Session Details / Get Messages
\`\`\`bash
curl ${apiUrl}/api/sessions
curl ${apiUrl}/api/sessions/<session_id>
curl ${apiUrl}/api/sessions/<session_id>/messages
\`\`\`

### List Workspaces / Get Workspace Detail
\`\`\`bash
curl ${apiUrl}/api/projects/${projectId}/workspaces
curl ${apiUrl}/api/workspaces/${workspaceId}
\`\`\`

### Stop / Restart / Delete a Session
\`\`\`bash
curl -X POST ${apiUrl}/api/sessions/<session_id>/stop
curl -X POST ${apiUrl}/api/sessions/<session_id>/restart
curl -X DELETE ${apiUrl}/api/sessions/<session_id>
\`\`\`

### Update Session Settings
\`\`\`bash
curl -X PATCH ${apiUrl}/api/sessions/<session_id> \\
  -H "Content-Type: application/json" \\
  -d '{"thinkingEnabled": true, "effortLevel": "high"}'
\`\`\``;
}

/** Build project and summary operations section */
function buildProjectOps(apiUrl, sessionId) {
  return `### Project Operations
\`\`\`bash
curl ${apiUrl}/api/projects                          # List all projects
curl ${apiUrl}/api/projects/<project_id>             # Get project details
curl ${apiUrl}/api/projects/<project_id>/sessions    # List project sessions
curl -X POST ${apiUrl}/api/projects \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Project Name", "workingDirectory": "/path/to/directory"}'
\`\`\`
Optional field: \`systemPrompt\`

### Workflow Summary
\`\`\`bash
curl "${apiUrl}/api/sessions/${sessionId}/summary?generate=true"
curl -X POST ${apiUrl}/api/sessions/${sessionId}/summary  # Regenerate
\`\`\``;
}

/** Build session API instructions for Claude to create/modify sessions */
function buildSessionApiInstructions(sessionId, projectId) {
  const apiUrl = getApiBaseUrl();
  // Compute the workspace ID (= root session ID) for this session. This is
  // needed so agents can reference the current workspace in API calls without
  // having to walk the parent chain themselves.
  const workspaceId = sessions.getRootSessionId(sessionId) || sessionId;
  return `## Session Management API

You can create and modify sessions in this system using curl or similar HTTP tools. Use the Bash tool to execute these commands.

**Base URL:** ${apiUrl}
**Current Session ID:** ${sessionId}
**Current Project ID:** ${projectId}
**Current Workspace ID:** ${workspaceId}

${buildSessionCrudOps(apiUrl, projectId, sessionId, workspaceId)}

${buildProjectOps(apiUrl, sessionId)}`;
}

/**
 * Build Kanban API instructions for system prompt.
 * @param {string} sessionId - Current session ID
 * @param {string} projectId - Current project ID
 * @returns {string} Kanban instructions or empty string if the project is missing
 */
function buildKanbanApiInstructions(sessionId, projectId) {
  const project = projects.getById(projectId);
  if (!project) {
    return '';
  }

  const apiUrl = getApiBaseUrl();
  // Compute the workspace id for this session — the agent uses workspace
  // addressing for all kanban operations.
  const workspaceId = sessions.getRootSessionId(sessionId) || sessionId;
  const board = kanbanBoards.getByProjectId(projectId);

  // Get lane names for context
  let laneContext = '';
  if (board) {
    const lanes = kanbanLanes.getByBoardId(board.id);
    if (lanes && lanes.length > 0) {
      const laneList = lanes.map((l) => `  - "${l.name}" (ID: ${l.id})`).join('\n');
      laneContext = `\n### Available Lanes\n${laneList}\n`;
    }
  }

  return `## Kanban Board API

This project has a Kanban board enabled for organizing sessions visually. You can manage the board using these API endpoints.

Note: Moving a workspace card moves all sessions in the workspace together.
${laneContext}
### Get Board with All Lanes and Cards
\`\`\`bash
curl ${apiUrl}/api/projects/${projectId}/kanban
\`\`\`

### Add Current Workspace to the Board
\`\`\`bash
curl -X POST ${apiUrl}/api/projects/${projectId}/kanban/cards \\
  -H "Content-Type: application/json" \\
  -d '{"workspaceId": "${workspaceId}", "laneId": "<lane_id>"}'
\`\`\`

### Move a Card to a Different Lane
\`\`\`bash
curl -X PATCH ${apiUrl}/api/projects/${projectId}/kanban/cards/by-workspace/${workspaceId}/move \\
  -H "Content-Type: application/json" \\
  -d '{"targetLaneId": "<lane_id>"}'
\`\`\`

### Remove a Card from the Board
\`\`\`bash
curl -X DELETE ${apiUrl}/api/projects/${projectId}/kanban/cards/by-workspace/${workspaceId}
\`\`\`

### Create a New Lane
\`\`\`bash
curl -X POST ${apiUrl}/api/projects/${projectId}/kanban/lanes \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Lane Name"}'
\`\`\`

### Update a Lane
\`\`\`bash
curl -X PATCH ${apiUrl}/api/projects/${projectId}/kanban/lanes/<lane_id> \\
  -H "Content-Type: application/json" \\
  -d '{"name": "New Name"}'
\`\`\`

### Delete a Lane
\`\`\`bash
curl -X DELETE ${apiUrl}/api/projects/${projectId}/kanban/lanes/<lane_id>
\`\`\``;
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

CRITICAL: Do NOT use \`cd\` to navigate to the main repository. Your working directory is already set to the worktree. Running \`cd /home/ubuntu/workspace/circus-chief && ...\` will escape the worktree isolation and affect the main repository instead.`;
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
  const apiUrl = getApiBaseUrl();
  const session = sessions.getById(sessionId);
  // Build prompt parts, filtering out empty sections
  const parts = [
    mode === 'plan' ? PLAN_MODE_PROMPT : '',
    customSystemPrompt || DEFAULT_SYSTEM_PROMPT,
    buildWorktreeContext(session),
    getSessionAttachmentsContext(sessionId),
    buildCanvasWriteSystemPrompt(session),
    buildCanvasReadSystemPrompt(session),
    buildSessionApiInstructions(sessionId, projectId),
    buildCommandButtonApiInstructions(apiUrl, sessionId, projectId),
    buildKanbanApiInstructions(sessionId, projectId),
  ].filter(Boolean);

  return parts.join('\n\n');
}
