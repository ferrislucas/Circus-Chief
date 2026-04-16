/**
 * @typedef {'starting' | 'running' | 'waiting' | 'stopped' | 'error'} SessionStatus
 */

/**
 * @typedef {'plan' | 'standard' | 'yolo'} SessionMode
 */

/**
 * @typedef {'claude-sonnet-4-6' | 'claude-opus-4-6' | 'claude-opus-4-7' | 'claude-haiku-4-5-20251001'} ClaudeModel
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

export const SESSION_STATUSES = ['starting', 'running', 'waiting', 'stopped', 'error'];
export const SESSION_MODES = ['plan', 'standard', 'yolo'];
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'max', 'auto'];
export const MESSAGE_ROLES = ['user', 'assistant', 'system'];
export const CANVAS_ITEM_TYPES = ['image', 'markdown', 'text', 'json'];
export const TOOL_TEMPLATE_PAYLOAD_TYPES = ['command', 'prompt'];

export const CLAUDE_MODELS = [
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', description: 'Fast & lightweight' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', description: 'Balanced' },
  { id: 'claude-opus-4-6', name: 'Opus 4.6', description: 'Previous generation' },
  { id: 'claude-opus-4-7', name: 'Opus 4.7', description: 'Most capable (default)' },
];
export const DEFAULT_MODEL = 'claude-opus-4-7';

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
