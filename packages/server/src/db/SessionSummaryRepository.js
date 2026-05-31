import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

/**
 * Field definitions for session summary updates.
 * Each entry defines how to transform the value for SQL.
 */
const SUMMARY_FIELDS = {
  shortSummary: { column: 'short_summary', transform: (v) => v },
  fullSummary: { column: 'full_summary', transform: (v) => v },
  ownShortSummary: { column: 'own_short_summary', transform: (v) => v },
  ownFullSummary: { column: 'own_full_summary', transform: (v) => v },
  ownKeyActions: { column: 'own_key_actions', transform: (v) => (v == null ? null : JSON.stringify(v)) },
  ownFilesModified: { column: 'own_files_modified', transform: (v) => (v == null ? null : JSON.stringify(v)) },
  ownOutcome: { column: 'own_outcome', transform: (v) => v },
  keyActions: { column: 'key_actions', transform: (v) => JSON.stringify(v) },
  filesModified: { column: 'files_modified', transform: (v) => JSON.stringify(v) },
  outcome: { column: 'outcome', transform: (v) => v },
  messageCount: { column: 'message_count', transform: (v) => v },
  lastSummarizedMessageId: { column: 'last_summarized_message_id', transform: (v) => v },
  prMerged: { column: 'pr_merged', transform: (v) => (v ? 1 : 0) },
  prState: { column: 'pr_state', transform: (v) => v },
  hasMergeConflicts: { column: 'has_merge_conflicts', transform: (v) => (v ? 1 : 0) },
  ciStatus: { column: 'ci_status', transform: (v) => v },
  ciFailures: { column: 'ci_failures', transform: (v) => JSON.stringify(v) },
  workflowFingerprint: { column: 'workflow_fingerprint', transform: (v) => v },
};

/**
 * Convert an optional boolean to a DB-compatible value (null, 0, or 1).
 */
function optionalBoolToDb(value) {
  if (value === undefined) return null;
  return value ? 1 : 0;
}

function parseJsonArray(value, fallback = []) {
  if (value == null) return fallback;
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : fallback;
}

/**
 * Session summary repository class
 */
export class SessionSummaryRepository extends BaseRepository {
  constructor() {
    super('session_summaries', SessionSummaryRepository.#mapSummary);
  }

  static #mapSummary(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      shortSummary: row.short_summary,
      fullSummary: row.full_summary,
      ownShortSummary: row.own_short_summary || null,
      ownFullSummary: row.own_full_summary || null,
      ownKeyActions: parseJsonArray(row.own_key_actions, null),
      ownFilesModified: parseJsonArray(row.own_files_modified, null),
      ownOutcome: row.own_outcome || null,
      keyActions: parseJsonArray(row.key_actions),
      filesModified: parseJsonArray(row.files_modified),
      outcome: row.outcome,
      messageCount: row.message_count,
      lastSummarizedMessageId: row.last_summarized_message_id,
      prMerged: row.pr_merged !== null ? Boolean(row.pr_merged) : null,
      prState: row.pr_state,
      hasMergeConflicts: row.has_merge_conflicts !== null ? Boolean(row.has_merge_conflicts) : null,
      ciStatus: row.ci_status,
      ciFailures: row.ci_failures ? JSON.parse(row.ci_failures) : [],
      workflowFingerprint: row.workflow_fingerprint || null,
      generatedAt: row.generated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get summary by session ID
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getBySessionId(sessionId) {
    const row = this.db
      .prepare('SELECT * FROM session_summaries WHERE session_id = ?')
      .get(sessionId);
    return this.map(row);
  }

  /**
   * Create a new session summary
   * @param {string} sessionId
   * @param {Object} data
   * @returns {Object}
   */
  create(sessionId, data) {
    const id = databaseManager.generateId();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO session_summaries
         (id, session_id, short_summary, full_summary, own_short_summary, own_full_summary, own_key_actions, own_files_modified, own_outcome, key_actions, files_modified, outcome, message_count, last_summarized_message_id, pr_merged, pr_state, has_merge_conflicts, ci_status, ci_failures, workflow_fingerprint, generated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        sessionId,
        data.shortSummary ?? '',
        data.fullSummary ?? '',
        data.ownShortSummary || null,
        data.ownFullSummary || null,
        data.ownKeyActions == null ? null : JSON.stringify(data.ownKeyActions),
        data.ownFilesModified == null ? null : JSON.stringify(data.ownFilesModified),
        data.ownOutcome || null,
        data.keyActions ? JSON.stringify(data.keyActions) : null,
        data.filesModified ? JSON.stringify(data.filesModified) : null,
        data.outcome || 'ongoing',
        data.messageCount || 0,
        data.lastSummarizedMessageId || null,
        optionalBoolToDb(data.prMerged),
        data.prState || null,
        optionalBoolToDb(data.hasMergeConflicts),
        data.ciStatus || null,
        data.ciFailures ? JSON.stringify(data.ciFailures) : null,
        data.workflowFingerprint || null,
        now,
        now,
        now
      );
    return this.getById(id);
  }

  /**
   * Update an existing session summary
   * @param {string} id
   * @param {Object} data
   * @returns {Object}
   */
  update(id, data) {
    const updates = [];
    const values = [];

    // Build update clauses from field definitions
    for (const [key, def] of Object.entries(SUMMARY_FIELDS)) {
      if (data[key] !== undefined) {
        updates.push(`${def.column} = ?`);
        values.push(def.transform(data[key]));
      }
    }

    if (updates.length === 0) return this.getById(id);

    // Always update generated_at and updated_at when updating
    const now = Date.now();
    updates.push('generated_at = ?', 'updated_at = ?');
    values.push(now, now, id);

    this.db.prepare(`UPDATE session_summaries SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getById(id);
  }

  /**
   * Create or update a session summary (upsert)
   * @param {string} sessionId
   * @param {Object} data
   * @returns {Object}
   */
  upsert(sessionId, data) {
    const existing = this.getBySessionId(sessionId);
    if (existing) {
      return this.update(existing.id, data);
    }
    return this.create(sessionId, data);
  }

  /**
   * Get summaries for multiple session IDs in a single query
   * @param {string[]} sessionIds
   * @returns {Object[]}
   */
  getBySessionIds(sessionIds) {
    if (!sessionIds || sessionIds.length === 0) return [];
    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT * FROM session_summaries WHERE session_id IN (${placeholders})`)
      .all(...sessionIds);
    return this.mapAll(rows);
  }

  /**
   * Delete summary by session ID
   * @param {string} sessionId
   */
  deleteBySessionId(sessionId) {
    this.db.prepare('DELETE FROM session_summaries WHERE session_id = ?').run(sessionId);
  }

  /**
   * Duplicates the session summary from one session to another.
   * Note: PR-related fields (prMerged, prState, hasMergeConflicts, ciStatus, ciFailures)
   * are NOT copied because the duplicated session is a fresh start and may create
   * its own PR. Copying prMerged=true would prevent the summary from ever being
   * regenerated (see summaryService.generateSummary skip logic).
   * @param {string} sourceSessionId - Source session ID
   * @param {string} targetSessionId - Target session ID
   */
  duplicateForSession(sourceSessionId, targetSessionId) {
    const summary = this.getBySessionId(sourceSessionId);

    if (summary) {
      this.create(targetSessionId, {
        shortSummary: summary.shortSummary,
        fullSummary: summary.fullSummary,
        ownShortSummary: summary.ownShortSummary,
        ownFullSummary: summary.ownFullSummary,
        ownKeyActions: summary.ownKeyActions,
        ownFilesModified: summary.ownFilesModified,
        ownOutcome: summary.ownOutcome,
        keyActions: summary.keyActions,
        filesModified: summary.filesModified,
        outcome: summary.outcome,
        messageCount: summary.messageCount,
        // PR-related fields intentionally omitted - see note above
      });
    }
  }
}
