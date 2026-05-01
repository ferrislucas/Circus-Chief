#!/usr/bin/env node
/**
 * seed-session-tokens.mjs
 * Direct DB seeding script for E2E tests — updates token usage columns on a session row.
 *
 * Reads a JSON payload from stdin:
 * {
 *   dbPath: string,                   // path to the SQLite database file
 *   sessionId: string,                // session ID
 *   inputTokens?: number,             // input token count
 *   outputTokens?: number,            // output token count
 *   thinkingTokens?: number,          // thinking token count
 *   cacheReadInputTokens?: number,    // cache read input token count
 *   cacheCreationInputTokens?: number,// cache creation input token count
 * }
 *
 * Behavior:
 * - Opens the SQLite database
 * - Updates input_tokens, output_tokens, thinking_tokens, cache_read_input_tokens, cache_creation_input_tokens columns
 * - Outputs the updated session row as JSON on stdout
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
  inputTokens,
  outputTokens,
  thinkingTokens,
  cacheReadInputTokens,
  cacheCreationInputTokens,
} = JSON.parse(raw);

const db = new Database(dbPath, { readonly: false });
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const now = Date.now();
db.prepare(
  `UPDATE sessions SET
    input_tokens = ?,
    output_tokens = ?,
    thinking_tokens = ?,
    cache_read_input_tokens = ?,
    cache_creation_input_tokens = ?,
    updated_at = ?
   WHERE id = ?`
).run(
  inputTokens ?? 0,
  outputTokens ?? 0,
  thinkingTokens ?? 0,
  cacheReadInputTokens ?? 0,
  cacheCreationInputTokens ?? 0,
  now,
  sessionId
);

// Read back the updated session
const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
db.close();

// Map column names for snake_case
const session = {
  id: row.id,
  name: row.name,
  inputTokens: row.input_tokens || 0,
  outputTokens: row.output_tokens || 0,
  thinkingTokens: row.thinking_tokens || 0,
  cacheReadInputTokens: row.cache_read_input_tokens || 0,
  cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
};
process.stdout.write(JSON.stringify(session));
