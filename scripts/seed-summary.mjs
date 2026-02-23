#!/usr/bin/env node
/**
 * seed-summary.mjs
 * Direct DB seeding script for E2E tests — inserts a row into session_summaries.
 *
 * Reads a JSON payload from stdin:
 * {
 *   dbPath: string,           // path to the SQLite database file
 *   sessionId: string,        // session ID
 *   shortSummary: string,     // short summary text
 *   fullSummary: string,      // full summary text
 *   keyActions?: string[],    // optional key actions array
 *   filesModified?: string[], // optional files modified array
 *   outcome?: string          // optional outcome (completed|partial|failed|ongoing)
 * }
 *
 * Outputs the created summary row as JSON on stdout.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

let raw = '';
process.stdin.setEncoding('utf-8');
for await (const chunk of process.stdin) {
  raw += chunk;
}

const { dbPath, sessionId, shortSummary, fullSummary, keyActions, filesModified, outcome } = JSON.parse(raw);

const db = new Database(dbPath, { readonly: false });
db.pragma('journal_mode = WAL');

// Check if a summary already exists for this session
const existing = db.prepare('SELECT id FROM session_summaries WHERE session_id = ?').get(sessionId);

const id = existing ? existing.id : randomUUID();
const now = Date.now();

if (existing) {
  // Update existing summary
  db.prepare(
    `UPDATE session_summaries
     SET short_summary = ?, full_summary = ?, key_actions = ?, files_modified = ?, outcome = ?, generated_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    shortSummary,
    fullSummary,
    keyActions ? JSON.stringify(keyActions) : null,
    filesModified ? JSON.stringify(filesModified) : null,
    outcome || 'completed',
    now,
    now,
    id
  );
} else {
  // Insert new summary
  db.prepare(
    `INSERT INTO session_summaries (id, session_id, short_summary, full_summary, key_actions, files_modified, outcome, message_count, generated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    sessionId,
    shortSummary,
    fullSummary,
    keyActions ? JSON.stringify(keyActions) : null,
    filesModified ? JSON.stringify(filesModified) : null,
    outcome || 'completed',
    0,
    now,
    now,
    now
  );
}

const row = db.prepare('SELECT * FROM session_summaries WHERE id = ?').get(id);
db.close();

const summary = {
  id: row.id,
  sessionId: row.session_id,
  shortSummary: row.short_summary,
  fullSummary: row.full_summary,
  keyActions: row.key_actions ? JSON.parse(row.key_actions) : [],
  filesModified: row.files_modified ? JSON.parse(row.files_modified) : [],
  outcome: row.outcome,
  generatedAt: row.generated_at,
};

process.stdout.write(JSON.stringify(summary));
