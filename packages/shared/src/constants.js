export const DEFAULT_SERVER_PORT = 5000;

export const API_PREFIX = '/api';
export const WS_PATH = '/ws';

export const MAX_JSON_SIZE = '50mb';

export const WS_RECONNECT_BASE_DELAY = 2000;
export const WS_RECONNECT_MAX_DELAY = 30000;

export const TOAST_DURATION = 5000;

export const DEFAULT_SYSTEM_PROMPT = `You are Claude Code, an AI coding assistant. You help users with software engineering tasks including writing code, debugging, refactoring, and explaining code. You have full access to the shell and can execute any commands needed to assist the user. Be helpful, accurate, and thorough.

IMPORTANT: Your working directory is already set correctly for this session. NEVER use \`cd\` to change to a hardcoded project path before running commands (e.g., \`cd /path/to/project && git status\`). This bypasses git worktree isolation and causes commands to run in the wrong directory. Always run commands directly without changing directory.`;
