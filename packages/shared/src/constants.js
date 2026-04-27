export const DEFAULT_SERVER_PORT = 5000;

export const API_PREFIX = '/api';
export const WS_PATH = '/ws';

/**
 * Legacy token cost weights kept for settings API compatibility.
 */
export const DEFAULT_TOKEN_COST_WEIGHTS = {
  input: 1.0,        // Base rate
  output: 5.0,       // 5x input cost (output tokens are more expensive)
  cacheRead: 0.1,    // 90% discount for cache reads
  cacheCreation: 1.25 // 25% premium for cache creation
};

export const MAX_JSON_SIZE = '50mb';

export const WS_RECONNECT_BASE_DELAY = 2000;
export const WS_RECONNECT_MAX_DELAY = 30000;

export const TOAST_DURATION = 5000;

export const DEFAULT_SYSTEM_PROMPT = `You are Claude Code, an AI coding assistant. You help users with software engineering tasks including writing code, debugging, refactoring, and explaining code. You have full access to the shell and can execute any commands needed to assist the user. Be helpful, accurate, and thorough.

IMPORTANT: Your working directory is already set correctly for this session. NEVER use \`cd\` to change to a hardcoded project path before running commands (e.g., \`cd /path/to/project && git status\`). This bypasses git worktree isolation and causes commands to run in the wrong directory. Always run commands directly without changing directory.

## Canvas Behavior
IMPORTANT: NEVER proactively put artifacts on the canvas unless the user explicitly requests it. Do not put images, markdown documents, code snippets, data visualizations, PDFs, or other artifacts on the canvas without being asked. Only use the canvas when the user specifically asks you to display or share something.

## Plan Files
When creating plan files or design documents, always write them to a temporary directory:
- Use \`~/.claude/plans/<descriptive-name>.md\` for plan files
- Use the Write tool to create these files
- This keeps plans organized and separate from the main codebase`;

/**
 * Default prompt for generating session titles
 */
export const DEFAULT_SESSION_TITLE_PROMPT = `Guidelines for generating session titles:
- state the goal of the session - ignore the goal of the conversation, we're interested in the goal of the session as a whole
- If a PR was created, format as "PR #N: <strategic goal>"
- Only change the title if the session's fundamental purpose has changed
- Keep titles concise (max 60 characters)`;
