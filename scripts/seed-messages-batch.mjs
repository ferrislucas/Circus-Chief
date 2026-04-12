#!/usr/bin/env node
/**
 * seed-messages-batch.mjs
 * Direct DB seeding script for E2E tests — inserts multiple message rows in a single transaction.
 *
 * Reads a JSON payload from stdin:
 * {
 *   dbPath: string,
 *   messages: Array<{
 *     sessionId: string,
 *     role: string,
 *     content: string,
 *     model?: string,
 *     toolUse?: object[],
 *     conversationId?: string
 *   }>
 * }
 *
 * Outputs an array of created message rows as JSON on stdout.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

let raw = '';
process.stdin.setEncoding('utf-8');
for await (const chunk of process.stdin) {
  raw += chunk;
}

const { dbPath, messages } = JSON.parse(raw);

const db = new Database(dbPath, { readonly: false });
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 30000');
db.pragma('foreign_keys = OFF');

// Cache resolved conversation IDs by sessionId
const convCache = new Map();

function resolveConversationId(sessionId, conversationId) {
  if (conversationId) return conversationId;
  if (convCache.has(sessionId)) return convCache.get(sessionId);
  const conv = db
    .prepare('SELECT id FROM conversations WHERE session_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1')
    .get(sessionId);
  const resolved = conv ? conv.id : null;
  convCache.set(sessionId, resolved);
  return resolved;
}

const insertStmt = db.prepare(
  `INSERT INTO conversation_messages (id, session_id, conversation_id, role, content, tool_use, model, timestamp)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

const selectStmt = db.prepare('SELECT * FROM conversation_messages WHERE id = ?');

const results = [];

const insertAll = db.transaction(() => {
  let now = Date.now();
  for (const msg of messages) {
    const id = randomUUID();
    const resolvedConvId = resolveConversationId(msg.sessionId, msg.conversationId || null);
    const toolUseStr = msg.toolUse ? JSON.stringify(msg.toolUse) : null;

    insertStmt.run(id, msg.sessionId, resolvedConvId, msg.role, msg.content, toolUseStr, msg.model ?? null, now);

    const row = selectStmt.get(id);
    results.push({
      id: row.id,
      sessionId: row.session_id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      toolUse: row.tool_use ? JSON.parse(row.tool_use) : null,
      timestamp: row.timestamp,
      model: row.model,
    });

    // Increment timestamp so messages have distinct ordering
    now++;
  }
});

// Retry the transaction in case of transient SQLITE_BUSY errors
const MAX_RETRIES = 3;
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    insertAll();
    break;
  } catch (err) {
    if (err.code === 'SQLITE_BUSY' && attempt < MAX_RETRIES) {
      // Wait with exponential backoff before retrying
      const delay = 1000 * attempt;
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    throw err;
  }
}
db.close();

process.stdout.write(JSON.stringify(results));
