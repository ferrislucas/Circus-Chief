#!/usr/bin/env node
/**
 * seed-conversation-tokens.mjs
 * Direct DB seeding script for E2E tests — updates token usage columns on a conversation row.
 *
 * Reads a JSON payload from stdin:
 * {
 *   dbPath: string,                   // path to the SQLite database file
 *   sessionId: string,                // session ID
 *   conversationId?: string,          // conversation ID (uses active conversation if omitted)
 *   inputTokens?: number,             // input token count
 *   outputTokens?: number,            // output token count
 *   cacheReadInputTokens?: number,    // cache read input token count
 *   cacheCreationInputTokens?: number,// cache creation input token count
 *   contextWindow?: number,           // context window size
 * }
 *
 * Behavior:
 * - Opens the SQLite database
 * - If conversationId is not provided, resolves the active conversation for the session
 * - Updates input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, context_window columns
 * - Outputs the updated conversation row as JSON on stdout
 */

import Database from 'better-sqlite3';

let raw = '';
process.stdin.setEncoding('utf-8');
for await (const chunk of process.stdin) {
  raw += chunk;
}

const {
  dbPath,
  sessionId,
  conversationId,
  inputTokens,
  outputTokens,
  cacheReadInputTokens,
  cacheCreationInputTokens,
  contextWindow,
} = JSON.parse(raw);

const db = new Database(dbPath, { readonly: false });
db.pragma('journal_mode = WAL');

// Resolve conversation ID
let resolvedConvId = conversationId || null;
if (!resolvedConvId) {
  const conv = db
    .prepare('SELECT id FROM conversations WHERE session_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1')
    .get(sessionId);
  if (!conv) {
    process.stderr.write(`No active conversation found for session ${sessionId}\n`);
    process.exit(1);
  }
  resolvedConvId = conv.id;
}

const now = Date.now();

db.prepare(
  `UPDATE conversations SET
    input_tokens = ?,
    output_tokens = ?,
    cache_read_input_tokens = ?,
    cache_creation_input_tokens = ?,
    context_window = ?,
    updated_at = ?
   WHERE id = ?`
).run(
  inputTokens ?? 0,
  outputTokens ?? 0,
  cacheReadInputTokens ?? 0,
  cacheCreationInputTokens ?? 0,
  contextWindow ?? 200000,
  now,
  resolvedConvId
);

const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(resolvedConvId);
db.close();

const conversation = {
  id: row.id,
  sessionId: row.session_id,
  name: row.name,
  isActive: row.is_active === 1,
  inputTokens: row.input_tokens || 0,
  outputTokens: row.output_tokens || 0,
  cacheReadInputTokens: row.cache_read_input_tokens || 0,
  cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
  contextWindow: row.context_window || 200000,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
};

process.stdout.write(JSON.stringify(conversation));
