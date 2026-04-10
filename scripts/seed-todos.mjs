#!/usr/bin/env node
/**
 * seed-todos.mjs
 * Direct DB seeding script for E2E tests — inserts todo rows into session_todos.
 *
 * Reads a JSON payload from stdin:
 * {
 *   dbPath: string,        // path to the SQLite database file
 *   sessionId: string,     // session ID
 *   conversationId: string,// conversation ID
 *   todos: [               // array of todos to insert
 *     { content: string, status: 'pending' | 'in_progress' | 'completed' },
 *     ...
 *   ]
 * }
 *
 * Behavior:
 * - Deletes all existing todos for the given conversationId
 * - Inserts new todos with auto-generated IDs, sequential positions, and current timestamp
 * - Outputs the inserted rows as JSON array on stdout
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

let raw = '';
process.stdin.setEncoding('utf-8');
for await (const chunk of process.stdin) {
  raw += chunk;
}

const { dbPath, sessionId, conversationId, todos } = JSON.parse(raw);

const db = new Database(dbPath, { readonly: false });
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = OFF');

// Delete existing todos for this conversation
db.prepare('DELETE FROM session_todos WHERE conversation_id = ?').run(conversationId);

// Insert new todos with sequential positions
const now = Date.now();
const insertedTodos = [];

for (let i = 0; i < todos.length; i++) {
  const todo = todos[i];
  const id = randomUUID();

  db.prepare(
    `INSERT INTO session_todos (id, session_id, conversation_id, content, status, position, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, sessionId, conversationId, todo.content, todo.status, i, now);

  const row = db.prepare('SELECT * FROM session_todos WHERE id = ?').get(id);
  insertedTodos.push({
    id: row.id,
    sessionId: row.session_id,
    conversationId: row.conversation_id,
    content: row.content,
    status: row.status,
    position: row.position,
    updatedAt: row.updated_at,
  });
}

db.close();

process.stdout.write(JSON.stringify(insertedTodos));
