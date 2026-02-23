import { sessions, attachments } from '../database.js';
import { DEFAULT_SYSTEM_PROMPT } from '@claudetools/shared';
import { getApiBaseUrl } from './providerConfig.js';
import { buildSessionApiInstructions } from './sessionApiDocs.js';

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
