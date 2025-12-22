/**
 * @typedef {'starting' | 'running' | 'waiting' | 'stopped' | 'completed' | 'error'} SessionStatus
 */

/**
 * @typedef {'plan' | 'standard' | 'yolo'} SessionMode
 */

/**
 * @typedef {'claude-sonnet-4-5-20250929' | 'claude-opus-4-5-20251101' | 'claude-haiku-4-5-20251001'} ClaudeModel
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
 * @property {string|null} gitBranch
 * @property {string|null} gitWorktree
 * @property {string|null} prUrl
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
 * @typedef {Object} SessionNote
 * @property {string} id
 * @property {string} sessionId
 * @property {string} content
 * @property {number} createdAt
 * @property {number} updatedAt
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

export const SESSION_STATUSES = ['starting', 'running', 'waiting', 'stopped', 'completed', 'error'];
export const SESSION_MODES = ['plan', 'standard', 'yolo'];
export const MESSAGE_ROLES = ['user', 'assistant', 'system'];
export const CANVAS_ITEM_TYPES = ['image', 'markdown', 'text', 'json'];
export const TOOL_TEMPLATE_PAYLOAD_TYPES = ['command', 'prompt'];

export const CLAUDE_MODELS = [
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', description: 'Balanced' },
  { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', description: 'Most capable (default)' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', description: 'Fast & lightweight' },
];
export const DEFAULT_MODEL = 'claude-opus-4-5-20251101';
