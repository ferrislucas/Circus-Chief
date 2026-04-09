import { databaseManager } from './DatabaseManager.js';

/**
 * Map a raw database row to a conversation object.
 * @param {Object} row - The raw database row
 * @returns {Object} The mapped conversation object
 */
export function mapConversationRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    name: row.name,
    summary: row.summary,
    summaryGeneratedAt: row.summary_generated_at,
    isActive: row.is_active === 1,
    claudeSessionId: row.claude_session_id,

    // Branching fields
    parentConversationId: row.parent_conversation_id || null,
    branchFromMessageId: row.branch_from_message_id || null,

    // Token usage fields
    inputTokens: row.input_tokens || 0,
    outputTokens: row.output_tokens || 0,
    cacheReadInputTokens: row.cache_read_input_tokens || 0,
    cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
    webSearchRequests: row.web_search_requests || 0,
    contextWindow: row.context_window || 200000,
    model: row.model,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Execute the branch operation: create a new conversation branching from an
 * existing one at a specific message, copying earlier messages and adding a
 * new prompt.
 *
 * @param {Object} repo - The ConversationRepository instance
 * @param {string} conversationId - The source conversation ID
 * @param {string} messageId - The message ID to branch from
 * @param {Object} options - Branch options
 * @param {string|null} [options.name] - Optional name for the new conversation
 * @param {string} options.initialPrompt - The new prompt that replaces the branch point message
 * @returns {Object} The created branch conversation
 */
export function executeBranch(repo, conversationId, messageId, options) {
  const { name = null, initialPrompt } = options;
  if (!initialPrompt || !initialPrompt.trim()) {
    throw new Error('A prompt is required when branching');
  }

  const sourceConv = repo.getById(conversationId);
  if (!sourceConv) {
    throw new Error('Source conversation not found');
  }

  const branchMessage = repo.db
    .prepare('SELECT * FROM conversation_messages WHERE id = ? AND conversation_id = ?')
    .get(messageId, conversationId);

  if (!branchMessage) {
    throw new Error('Branch point message not found in conversation');
  }

  const id = databaseManager.generateId();
  const now = Date.now();

  // Auto-generate name from the prompt (first 40 chars)
  const promptPreview = initialPrompt.length > 40
    ? `${initialPrompt.substring(0, 40)}...`
    : initialPrompt;
  const branchName = name || promptPreview;

  // Deactivate all other conversations
  repo.db
    .prepare('UPDATE conversations SET is_active = 0, updated_at = ? WHERE session_id = ?')
    .run(now, sourceConv.sessionId);

  // Create the new branch conversation
  repo.db
    .prepare(
      `INSERT INTO conversations (id, session_id, name, is_active, parent_conversation_id, branch_from_message_id, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
    )
    .run(id, sourceConv.sessionId, branchName, conversationId, messageId, now, now);

  // Copy all messages BEFORE the branch point (NOT including it)
  const messagesToCopy = repo.db
    .prepare(
      `SELECT * FROM conversation_messages
       WHERE conversation_id = ? AND timestamp < ?
       ORDER BY timestamp ASC`
    )
    .all(conversationId, branchMessage.timestamp);

  for (const msg of messagesToCopy) {
    const newMsgId = databaseManager.generateId();
    repo.db
      .prepare(
        `INSERT INTO conversation_messages (id, session_id, conversation_id, role, content, tool_use, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(newMsgId, sourceConv.sessionId, id, msg.role, msg.content, msg.tool_use, msg.timestamp);
  }

  // Add the new prompt as the replacement for the original user message
  const promptMsgId = databaseManager.generateId();
  repo.db
    .prepare(
      `INSERT INTO conversation_messages (id, session_id, conversation_id, role, content, timestamp)
       VALUES (?, ?, ?, 'user', ?, ?)`
    )
    .run(promptMsgId, sourceConv.sessionId, id, initialPrompt.trim(), now);

  return repo.getById(id);
}
