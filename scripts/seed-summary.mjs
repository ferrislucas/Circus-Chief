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

const { dbPath, sessionId, shortSummary, fullSummary, keyActions, filesModified, outcome, prMerged, prState, hasMergeConflicts, ciStatus, ciFailures } = JSON.parse(raw);

// Convert PR fields for SQLite storage
const prMergedInt = prMerged != null ? (prMerged ? 1 : 0) : null;
const hasMergeConflictsInt = hasMergeConflicts != null ? (hasMergeConflicts ? 1 : 0) : null;
const ciFailuresJson = ciFailures != null ? JSON.stringify(ciFailures) : null;

const db = new Database(dbPath, { readonly: false });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

// Ensure session exists before creating summary (fixes foreign key constraint error)
const existingSession = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
if (!existingSession) {
  // First ensure project exists (sessions have a foreign key to projects)
  const dummyProjectId = '00000000-0000-0000-0000-000000000000';
  const existingProject = db.prepare('SELECT id FROM projects WHERE id = ?').get(dummyProjectId);
  if (!existingProject) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO projects (id, name, working_directory, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(dummyProjectId, 'Test Project', '/tmp/test', now, now);
    console.error(`⚠️ Created placeholder project ${dummyProjectId} - this should have been created via API first`);
  }

  // Create a minimal session row for testing
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions (id, project_id, name, status, mode, thinking_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, dummyProjectId, 'Test Session', 'waiting', 'standard', 0, now, now);
  console.error(`⚠️ Created placeholder session ${sessionId} - this should have been created via API first`);
}

// Check if a summary already exists for this session
const existing = db.prepare('SELECT id FROM session_summaries WHERE session_id = ?').get(sessionId);

const id = existing ? existing.id : randomUUID();
const now = Date.now();

if (existing) {
  // Update existing summary
  db.prepare(
    `UPDATE session_summaries
     SET short_summary = ?, full_summary = ?, key_actions = ?, files_modified = ?, outcome = ?, generated_at = ?, updated_at = ?,
         pr_merged = ?, pr_state = ?, has_merge_conflicts = ?, ci_status = ?, ci_failures = ?
     WHERE id = ?`
  ).run(
    shortSummary,
    fullSummary,
    keyActions ? JSON.stringify(keyActions) : null,
    filesModified ? JSON.stringify(filesModified) : null,
    outcome || 'completed',
    now,
    now,
    prMergedInt ?? null,
    prState ?? null,
    hasMergeConflictsInt ?? null,
    ciStatus ?? null,
    ciFailuresJson ?? null,
    id
  );
} else {
  // Insert new summary
  db.prepare(
    `INSERT INTO session_summaries (id, session_id, short_summary, full_summary, key_actions, files_modified, outcome, message_count, generated_at, created_at, updated_at, pr_merged, pr_state, has_merge_conflicts, ci_status, ci_failures)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    now,
    prMergedInt ?? null,
    prState ?? null,
    hasMergeConflictsInt ?? null,
    ciStatus ?? null,
    ciFailuresJson ?? null
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
  prMerged: row.pr_merged != null ? Boolean(row.pr_merged) : null,
  prState: row.pr_state ?? null,
  hasMergeConflicts: row.has_merge_conflicts != null ? Boolean(row.has_merge_conflicts) : null,
  ciStatus: row.ci_status ?? null,
  ciFailures: row.ci_failures ? JSON.parse(row.ci_failures) : null,
};

process.stdout.write(JSON.stringify(summary));
