/**
 * Migrations for the conversations, conversation_messages, and message_attachments tables.
 * Each export is an array of { name, up(db) } migration objects.
 */
import crypto from 'crypto';
import { addColumnIfMissing, getColumns } from './migrationUtils.js';

/**
 * Create default conversations for existing sessions that don't have any
 * and associate orphaned messages with the default conversation.
 */
function migrateExistingSessionsToConversations(db) {
  const sessionsWithoutConversations = db
    .prepare(
      `
      SELECT DISTINCT s.id FROM sessions s
      LEFT JOIN conversations c ON c.session_id = s.id
      WHERE c.id IS NULL
      AND EXISTS (SELECT 1 FROM conversation_messages m WHERE m.session_id = s.id)
    `
    )
    .all();

  for (const session of sessionsWithoutConversations) {
    const convId = crypto.randomUUID();
    const now = Date.now();

    db.prepare(
      `INSERT INTO conversations (id, session_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    ).run(convId, session.id, 'Initial', now, now);

    db.prepare(
      `UPDATE conversation_messages SET conversation_id = ? WHERE session_id = ? AND conversation_id IS NULL`
    ).run(convId, session.id);
  }
}

/** @type {Array<{name: string, up: (db: import('better-sqlite3').Database) => void}>} */
export const conversationsMigrations = [
  // --- Session summaries PR columns ---
  {
    name: 'session_summaries-add-pr_merged',
    up(db) { addColumnIfMissing(db, 'session_summaries', 'pr_merged', 'INTEGER'); },
  },
  {
    name: 'session_summaries-add-pr_state',
    up(db) { addColumnIfMissing(db, 'session_summaries', 'pr_state', 'TEXT'); },
  },
  {
    name: 'session_summaries-add-has_merge_conflicts',
    up(db) { addColumnIfMissing(db, 'session_summaries', 'has_merge_conflicts', 'INTEGER'); },
  },
  {
    name: 'session_summaries-add-ci_status',
    up(db) { addColumnIfMissing(db, 'session_summaries', 'ci_status', 'TEXT'); },
  },
  {
    name: 'session_summaries-add-ci_failures',
    up(db) { addColumnIfMissing(db, 'session_summaries', 'ci_failures', 'TEXT'); },
  },
  {
    name: 'session_summaries-add-last_summarized_message_id',
    up(db) { addColumnIfMissing(db, 'session_summaries', 'last_summarized_message_id', 'TEXT'); },
  },

  // --- Message attachments ---
  {
    name: 'message_attachments-add-file_path',
    up(db) { addColumnIfMissing(db, 'message_attachments', 'file_path', 'TEXT'); },
  },

  // --- Conversation messages: conversation_id ---
  {
    name: 'conversation_messages-add-conversation_id',
    up(db) {
      const columns = getColumns(db, 'conversation_messages');
      if (!columns.includes('conversation_id')) {
        db.exec(
          'ALTER TABLE conversation_messages ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE'
        );
        db.exec(
          'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id)'
        );
      }
    },
  },

  // --- Migrate existing sessions to conversations ---
  {
    name: 'conversations-migrate-existing-sessions',
    up(db) { migrateExistingSessionsToConversations(db); },
  },

  // --- Conversations: claude_session_id ---
  {
    name: 'conversations-add-claude_session_id',
    up(db) { addColumnIfMissing(db, 'conversations', 'claude_session_id', 'TEXT'); },
  },

  // --- Conversations token usage ---
  {
    name: 'conversations-add-input_tokens',
    up(db) { addColumnIfMissing(db, 'conversations', 'input_tokens', 'INTEGER DEFAULT 0'); },
  },
  {
    name: 'conversations-add-output_tokens',
    up(db) { addColumnIfMissing(db, 'conversations', 'output_tokens', 'INTEGER DEFAULT 0'); },
  },
  {
    name: 'conversations-add-cache_read_input_tokens',
    up(db) { addColumnIfMissing(db, 'conversations', 'cache_read_input_tokens', 'INTEGER DEFAULT 0'); },
  },
  {
    name: 'conversations-add-cache_creation_input_tokens',
    up(db) { addColumnIfMissing(db, 'conversations', 'cache_creation_input_tokens', 'INTEGER DEFAULT 0'); },
  },
  {
    name: 'conversations-add-web_search_requests',
    up(db) { addColumnIfMissing(db, 'conversations', 'web_search_requests', 'INTEGER DEFAULT 0'); },
  },
  {
    name: 'conversations-add-context_window',
    up(db) { addColumnIfMissing(db, 'conversations', 'context_window', 'INTEGER DEFAULT 200000'); },
  },
  {
    name: 'conversations-add-model',
    up(db) { addColumnIfMissing(db, 'conversations', 'model', 'TEXT'); },
  },

  // --- Conversation branching ---
  {
    name: 'conversations-add-parent_conversation_id',
    up(db) {
      const columns = getColumns(db, 'conversations');
      if (!columns.includes('parent_conversation_id')) {
        db.exec(
          'ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL'
        );
        db.exec(
          'CREATE INDEX IF NOT EXISTS idx_conversations_parent ON conversations(parent_conversation_id)'
        );
      }
    },
  },
  {
    name: 'conversations-add-branch_from_message_id',
    up(db) {
      addColumnIfMissing(
        db, 'conversations', 'branch_from_message_id',
        'TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL'
      );
    },
  },

  // --- Session todos: conversation_id ---
  {
    name: 'session_todos-add-conversation_id',
    up(db) {
      const columns = getColumns(db, 'session_todos');
      if (!columns.includes('conversation_id')) {
        db.exec(
          'ALTER TABLE session_todos ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE'
        );
        db.exec(
          'CREATE INDEX IF NOT EXISTS idx_todos_conversation ON session_todos(conversation_id)'
        );
      }
    },
  },

  // --- Conversation messages: model ---
  {
    name: 'conversation_messages-add-model',
    up(db) { addColumnIfMissing(db, 'conversation_messages', 'model', 'TEXT'); },
  },
];
