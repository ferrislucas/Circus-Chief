import { sessions, attachments } from '../database.js';
import { DEFAULT_SERVER_PORT, DEFAULT_SYSTEM_PROMPT } from '@circuschief/shared';
import { buildCommandButtonApiInstructions } from './commandButtonPrompts.js';
import { buildSessionApiInstructions, buildKanbanApiInstructions } from './sessionApiPrompts.js';

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
    buildCommandButtonApiInstructions(apiUrl, sessionId),
    buildKanbanApiInstructions(sessionId, projectId),
  ].filter(Boolean);

  return parts.join('\n\n');
}
