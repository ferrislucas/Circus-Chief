/**
 * @typedef {'starting' | 'running' | 'waiting' | 'stopped' | 'error'} SessionStatus
 */

/**
 * @typedef {'plan' | 'standard' | 'yolo'} SessionMode
 */

/**
 * @typedef {'claude-fable-5' | 'claude-sonnet-5' | 'claude-opus-4-6' | 'claude-opus-4-7' | 'claude-opus-4-8' | 'claude-haiku-4-5-20251001'} ClaudeModel
 */

/**
 * @typedef {'low' | 'medium' | 'high' | 'max' | 'auto'} EffortLevel
 */

/**
 * @typedef {'user' | 'assistant' | 'system'} MessageRole
 */

/**
 * @typedef {'image' | 'markdown' | 'text' | 'json'} CanvasItemType
 */

/**
 * @typedef {'command' | 'prompt'} ToolTemplatePayloadType
 */

/**
 * @typedef {Object} Project
 * @property {string} id
 * @property {string} name
 * @property {string} workingDirectory
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} projectId
 * @property {string} name
 * @property {SessionStatus} status
 * @property {SessionMode} mode
 * @property {ClaudeModel|null} model
 * @property {EffortLevel|null} effortLevel
 * @property {string|null} gitBranch
 * @property {string|null} gitWorktree
 * @property {string|null} prUrl
 * @property {boolean} prUrlAutoLinkDisabled
 * @property {string|null} error
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} ConversationMessage
 * @property {string} id
 * @property {string} sessionId
 * @property {MessageRole} role
 * @property {string} content
 * @property {Object[]|null} toolUse
 * @property {number} timestamp
 */

/**
 * @typedef {Object} CanvasItem
 * @property {string} id
 * @property {string|null} sessionId
 * @property {CanvasItemType} type
 * @property {string|null} content
 * @property {string|null} data
 * @property {string|null} mimeType
 * @property {string|null} filename
 * @property {string|null} label
 * @property {number|null} width
 * @property {number|null} height
 * @property {number} createdAt
 */

/**
 * @typedef {Object} GlobalToolTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} payload
 * @property {'command'} payloadType
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} ProjectToolTemplate
 * @property {string} id
 * @property {string} projectId
 * @property {string} name
 * @property {string} payload
 * @property {ToolTemplatePayloadType} payloadType
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export const SESSION_STATUSES = ['starting', 'running', 'waiting', 'stopped', 'error'];
export const SESSION_MODES = ['plan', 'standard', 'yolo'];
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'max', 'auto'];
export const MESSAGE_ROLES = ['user', 'assistant', 'system'];
export const CANVAS_ITEM_TYPES = ['image', 'markdown', 'text', 'json'];
export const TOOL_TEMPLATE_PAYLOAD_TYPES = ['command', 'prompt'];

export const CLAUDE_MODELS = [
  { id: 'claude-fable-5', name: 'Fable 5', description: 'Next-generation intelligence', tier: 'fable' },
  { id: 'claude-opus-4-8', name: 'Opus 4.8', description: 'Most capable (default)', tier: 'opus' },
  { id: 'claude-opus-4-7', name: 'Opus 4.7', description: 'Previous generation', tier: 'opus' },
  { id: 'claude-opus-4-6', name: 'Opus 4.6', description: 'Previous generation', tier: 'opus' },
  { id: 'claude-sonnet-5', name: 'Sonnet 5', description: 'Balanced', tier: 'sonnet' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', description: 'Fast & lightweight', tier: 'haiku' },
];
export const DEFAULT_MODEL = 'claude-opus-4-8';

export const OPENAI_MODELS = [
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    description: 'Frontier model for complex professional work',
    seedId: 'openai-gpt-5-6-sol',
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    description: 'Capable lower-cost GPT-5.6 model',
    seedId: 'openai-gpt-5-6-terra',
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    description: 'Fastest and most cost-efficient GPT-5.6 model',
    seedId: 'openai-gpt-5-6-luna',
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'High capability professional work',
    seedId: 'openai-gpt-5-4',
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 mini',
    description: 'Fast lower-cost coding and subagent work',
    seedId: 'openai-gpt-5-4-mini',
  },
  {
    id: 'gpt-5.3-codex',
    name: 'GPT-5.3-Codex',
    description: 'Coding-optimized agentic model',
    seedId: 'openai-gpt-5-3-codex',
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    description: 'Legacy Codex model',
    seedId: 'openai-gpt-5-5',
    defaultEnabled: false,
  },
];
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';

export const GEMINI_MODELS = [
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most capable reasoning model', seedId: 'google-gemini-2-5-pro' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast & cost-efficient', seedId: 'google-gemini-2-5-flash' },
  { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', description: 'Lightweight & cost-efficient', seedId: 'google-gemini-2-5-flash-lite' },
];
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * @typedef {Object} KanbanBoard
 * @property {string} id
 * @property {string} projectId
 * @property {KanbanLane[]} lanes
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} KanbanLane
 * @property {string} id
 * @property {string} boardId
 * @property {string} name
 * @property {number} sortOrder
 * @property {string|null} onEnterTemplateId
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} KanbanCard
 * @property {string} id
 * @property {string} laneId
 * @property {number} sortOrder
 * @property {KanbanCardSession[]} sessions
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {Object} KanbanCardSession
 * @property {string} id
 * @property {string} name
 * @property {SessionStatus} status
 * @property {SessionMode} [mode]
 * @property {number} [costUsd]
 * @property {boolean} [starred]
 * @property {string|null} [prUrl]
 * @property {number} createdAt
 * @property {number} updatedAt
 */

export const DEFAULT_KANBAN_LANES = ['To Do', 'In Progress', 'Review', 'Done'];
