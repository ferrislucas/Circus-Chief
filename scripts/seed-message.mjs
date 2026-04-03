#!/usr/bin/env node
/**
 * seed-message.mjs
 * Direct DB seeding script for E2E tests — inserts a message row into conversation_messages.
 *
 * Reads a JSON payload from stdin:
 * {
 *   dbPath: string,       // path to the SQLite database file
 *   sessionId: string,    // session ID
 *   role: string,         // 'user' | 'assistant'
 *   content: string,      // message content
 *   model?: string,       // optional model name (for assistant messages)
 *   toolUse?: object[],   // optional tool use array (for assistant messages)
 *   conversationId?: string // optional conversation ID (uses active if omitted)
 * }
 *
 * Outputs the created message row as JSON on stdout.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

let raw = '';
process.stdin.setEncoding('utf-8');
for await (const chunk of process.stdin) {
  raw += chunk;
}

const { dbPath, sessionId, role, content, model, toolUse, conversationId } = JSON.parse(raw);

const db = new Database(dbPath, { readonly: false });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

// Resolve conversation ID
let resolvedConvId = conversationId || null;
if (!resolvedConvId) {
  const conv = db
    .prepare('SELECT id FROM conversations WHERE session_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1')
    .get(sessionId);
  if (conv) resolvedConvId = conv.id;
}

const id = randomUUID();
const now = Date.now();
const toolUseStr = toolUse ? JSON.stringify(toolUse) : null;

db.prepare(
  `INSERT INTO conversation_messages (id, session_id, conversation_id, role, content, tool_use, model, timestamp)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
).run(id, sessionId, resolvedConvId, role, content, toolUseStr, model ?? null, now);

const row = db.prepare('SELECT * FROM conversation_messages WHERE id = ?').get(id);
db.close();

const message = {
  id: row.id,
  sessionId: row.session_id,
  conversationId: row.conversation_id,
  role: row.role,
  content: row.content,
  toolUse: row.tool_use ? JSON.parse(row.tool_use) : null,
  timestamp: row.timestamp,
  model: row.model,
};

process.stdout.write(JSON.stringify(message));
