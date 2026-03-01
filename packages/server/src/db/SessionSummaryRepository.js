import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

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
      keyActions: row.key_actions ? JSON.parse(row.key_actions) : [],
      filesModified: row.files_modified ? JSON.parse(row.files_modified) : [],
      outcome: row.outcome,
      messageCount: row.message_count,
      lastSummarizedMessageId: row.last_summarized_message_id,
      prMerged: row.pr_merged !== null ? Boolean(row.pr_merged) : null,
      prState: row.pr_state,
      hasMergeConflicts: row.has_merge_conflicts !== null ? Boolean(row.has_merge_conflicts) : null,
      ciStatus: row.ci_status,
      ciFailures: row.ci_failures ? JSON.parse(row.ci_failures) : [],
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
         (id, session_id, short_summary, full_summary, key_actions, files_modified, outcome, message_count, last_summarized_message_id, pr_merged, pr_state, has_merge_conflicts, ci_status, ci_failures, generated_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        sessionId,
        data.shortSummary,
        data.fullSummary,
        data.keyActions ? JSON.stringify(data.keyActions) : null,
        data.filesModified ? JSON.stringify(data.filesModified) : null,
        data.outcome || 'ongoing',
        data.messageCount || 0,
        data.lastSummarizedMessageId || null,
        data.prMerged !== undefined ? (data.prMerged ? 1 : 0) : null,
        data.prState || null,
        data.hasMergeConflicts !== undefined ? (data.hasMergeConflicts ? 1 : 0) : null,
        data.ciStatus || null,
        data.ciFailures ? JSON.stringify(data.ciFailures) : null,
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

    if (data.shortSummary !== undefined) {
      updates.push('short_summary = ?');
      values.push(data.shortSummary);
    }
    if (data.fullSummary !== undefined) {
      updates.push('full_summary = ?');
      values.push(data.fullSummary);
    }
    if (data.keyActions !== undefined) {
      updates.push('key_actions = ?');
      values.push(JSON.stringify(data.keyActions));
    }
    if (data.filesModified !== undefined) {
      updates.push('files_modified = ?');
      values.push(JSON.stringify(data.filesModified));
    }
    if (data.outcome !== undefined) {
      updates.push('outcome = ?');
      values.push(data.outcome);
    }
    if (data.messageCount !== undefined) {
      updates.push('message_count = ?');
      values.push(data.messageCount);
    }
    if (data.lastSummarizedMessageId !== undefined) {
      updates.push('last_summarized_message_id = ?');
      values.push(data.lastSummarizedMessageId);
    }
    if (data.prMerged !== undefined) {
      updates.push('pr_merged = ?');
      values.push(data.prMerged ? 1 : 0);
    }
    if (data.prState !== undefined) {
      updates.push('pr_state = ?');
      values.push(data.prState);
    }
    if (data.hasMergeConflicts !== undefined) {
      updates.push('has_merge_conflicts = ?');
      values.push(data.hasMergeConflicts ? 1 : 0);
    }
    if (data.ciStatus !== undefined) {
      updates.push('ci_status = ?');
      values.push(data.ciStatus);
    }
    if (data.ciFailures !== undefined) {
      updates.push('ci_failures = ?');
      values.push(JSON.stringify(data.ciFailures));
    }

    if (updates.length === 0) return this.getById(id);

    // Always update generated_at and updated_at when updating
    updates.push('generated_at = ?');
    values.push(Date.now());
    updates.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

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
        keyActions: summary.keyActions,
        filesModified: summary.filesModified,
        outcome: summary.outcome,
        messageCount: summary.messageCount,
        // PR-related fields intentionally omitted - see note above
      });
    }
  }
}
