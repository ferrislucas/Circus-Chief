#!/usr/bin/env node
/**
 * kanban-entry-event.mjs
 * Direct DB inspection/adjustment script for E2E tests — reads or fast-forwards
 * a kanban_lane_entry_events row.
 *
 * Reads a JSON payload from stdin:
 * {
 *   dbPath: string,             // path to the SQLite database file
 *   action: 'get' | 'advance',  // 'get' reads the row; 'advance' zeroes
 *                                // next_attempt_at (only while status='pending')
 *                                // so the 1s retry worker picks it up on its
 *                                // next tick instead of waiting out the real
 *                                // exponential backoff.
 *   eventId: string,            // kanban_lane_entry_events.id
 * }
 *
 * Outputs the (possibly updated) row as JSON on stdout. Outputs `null` if the
 * event does not exist.
 */

import Database from 'better-sqlite3';

let raw = '';
process.stdin.setEncoding('utf-8');
for await (const chunk of process.stdin) {
  raw += chunk;
}

const { dbPath, action, eventId } = JSON.parse(raw);

const db = new Database(dbPath, { readonly: false });
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const SELECT_ROW = `SELECT id, status, attempt_count, delivery_phase, dispatch_key,
  dispatch_acknowledged_at, next_attempt_at, last_error, created_at, updated_at, completed_at
  FROM kanban_lane_entry_events WHERE id = ?`;

if (action === 'advance') {
  db.prepare(
    `UPDATE kanban_lane_entry_events SET next_attempt_at = 0, updated_at = ?
     WHERE id = ? AND status = 'pending'`
  ).run(Date.now(), eventId);
}

const row = db.prepare(SELECT_ROW).get(eventId) ?? null;
db.close();

process.stdout.write(JSON.stringify(row));
