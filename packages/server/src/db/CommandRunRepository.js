import { BaseRepository } from './BaseRepository.js';

/**
 * Command run repository class for persisting command execution history
 */
export class CommandRunRepository extends BaseRepository {
  constructor() {
    super('command_runs', CommandRunRepository.#mapRun);
  }

  static #mapRun(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      buttonId: row.button_id,
      status: row.status,
      // Kept for legacy rows only. New runs write append-only chunks.
      output: row.output || '',
      hasOutput: Boolean(row.has_output) || Boolean(row.output),
      outputHighWater: row.output_high_water || 0,
      exitCode: row.exit_code,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  create({ id, sessionId, buttonId }) {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO command_runs (id, session_id, button_id, status, output, started_at)
         VALUES (?, ?, ?, 'running', '', ?)`
      )
      .run(id, sessionId, buttonId, now);
    return this.getById(id);
  }

  /**
   * Append text to run output (buffered for performance)
   */
  appendOutput(runId, text) {
    return this.appendBatch(runId, text ? [text] : []);
  }

  /** Persist bounded, append-only chunks and return their assigned cursors. */
  appendBatch(runId, chunks) {
    const items = chunks.filter(Boolean);
    if (!items.length) return [];
    const write = this.db.transaction(() => {
      const next = this.db.prepare(
        'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM command_run_output_chunks WHERE run_id = ?'
      ).get(runId).sequence;
      const insert = this.db.prepare(
        `INSERT INTO command_run_output_chunks (run_id, sequence, content, byte_length, created_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      return items.map((content, index) => {
        const sequence = next + index;
        insert.run(runId, sequence, content, Buffer.byteLength(content), Date.now());
        return { sequence, content };
      });
    });
    return write();
  }

  getHighWater(runId) {
    return this.db.prepare(
      'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM command_run_output_chunks WHERE run_id = ?'
    ).get(runId).sequence;
  }

  /** Read an ordered, bounded page without materializing the full transcript. */
  readAfter(runId, after = 0, limitBytes = 65536) {
    const limit = Math.max(1, Math.min(Number(limitBytes) || 65536, 1024 * 1024));
    const rows = this.db.prepare(
      `SELECT sequence, content, byte_length FROM command_run_output_chunks
       WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC`
    ).all(runId, Number(after) || 0);
    const chunks = [];
    let bytes = 0;
    for (const row of rows) {
      if (chunks.length && bytes + row.byte_length > limit) break;
      chunks.push({ sequence: row.sequence, content: row.content });
      bytes += row.byte_length;
      if (bytes >= limit) break;
    }
    // Legacy rows predate chunks and remain readable as one bounded chunk.
    if (!chunks.length && !after) {
      const legacy = this.db.prepare('SELECT output FROM command_runs WHERE id = ?').get(runId)?.output;
      if (legacy) return { chunks: [{ sequence: 1, content: legacy.slice(0, limit) }], highWater: 1, hasMore: Buffer.byteLength(legacy) > limit };
    }
    const highWater = this.getHighWater(runId);
    return { chunks, highWater, hasMore: chunks.length ? chunks[chunks.length - 1].sequence < highWater : false };
  }

  /**
   * Mark run as completed with exit code and final output
   */
  complete(runId, exitCode) {
    const status = exitCode === 0 ? 'success' : 'error';
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE command_runs SET status = ?, exit_code = ?, completed_at = ? WHERE id = ?`
      )
      .run(status, exitCode, now, runId);
  }

  /**
   * Mark run as killed
   */
  markKilled(runId) {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE command_runs SET status = 'killed', completed_at = ? WHERE id = ?`
      )
      .run(now, runId);
  }

  /**
   * Get all runs for a session (both running and recent completed)
   */
  getBySessionId(sessionId) {
    const rows = this.db
      .prepare(`SELECT cr.*, EXISTS(SELECT 1 FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS has_output,
        (SELECT COALESCE(MAX(sequence), 0) FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS output_high_water
        FROM command_runs cr WHERE session_id = ? ORDER BY started_at DESC`)
      .all(sessionId);
    return this.mapAll(rows);
  }

  /**
   * Get runs for a session from last X milliseconds (recent runs)
   * If includeRunning is true, also include running commands regardless of age
   */
  getRecentBySessionId(sessionId, windowMs = 3600000, includeRunning = true) {
    const cutoffTime = Date.now() - windowMs;
    let query = `SELECT cr.*, EXISTS(SELECT 1 FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS has_output,
      (SELECT COALESCE(MAX(sequence), 0) FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS output_high_water
      FROM command_runs cr WHERE session_id = ?`;

    if (includeRunning) {
      query += ` AND (started_at > ? OR status = 'running')`;
    } else {
      query += ` AND started_at > ?`;
    }

    query += ` ORDER BY started_at DESC`;

    const rows = this.db.prepare(query).all(sessionId, cutoffTime);
    return this.mapAll(rows);
  }

  /**
   * Get a single run by ID
   */
  getById(id) {
    const row = this.db.prepare(`SELECT cr.*, EXISTS(SELECT 1 FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS has_output,
      (SELECT COALESCE(MAX(sequence), 0) FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS output_high_water
      FROM command_runs cr WHERE id = ?`).get(id);
    return this.map(row);
  }

  /**
   * Get most recent run for a button
   */
  getLastRunForButton(buttonId) {
    const row = this.db
      .prepare(`SELECT cr.*, EXISTS(SELECT 1 FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS has_output,
        (SELECT COALESCE(MAX(sequence), 0) FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS output_high_water
        FROM command_runs cr WHERE button_id = ? ORDER BY started_at DESC LIMIT 1`)
      .get(buttonId);
    return this.map(row);
  }

  /**
   * Delete runs older than specified milliseconds
   */
  deleteOlderThan(ageMs) {
    const cutoffTime = Date.now() - ageMs;
    const result = this.db
      .prepare('DELETE FROM command_runs WHERE completed_at < ?')
      .run(cutoffTime);
    return result.changes;
  }

  /**
   * Delete a single run by ID
   * @param {string} id - Run ID
   * @returns {number} Number of rows deleted (0 or 1)
   */
  deleteById(id) {
    const result = this.db.prepare('DELETE FROM command_runs WHERE id = ?').run(id);
    return result.changes;
  }

  /**
   * Delete all non-running runs for a button within a session.
   * Returns info about deleted runs (needed for WebSocket broadcasting).
   * @param {string} buttonId - Button ID
   * @param {string} sessionId - Session ID
   * @returns {{ deletedCount: number, deletedRuns: Array<{ id: string, buttonId: string }> }}
   */
  deleteByButtonAndSession(buttonId, sessionId) {
    const deleteRuns = this.db.transaction(() => {
      // First get the IDs of runs we'll delete (for broadcasting)
      const runs = this.db
        .prepare('SELECT id, button_id FROM command_runs WHERE button_id = ? AND session_id = ? AND status != ?')
        .all(buttonId, sessionId, 'running');

      const result = this.db
        .prepare('DELETE FROM command_runs WHERE button_id = ? AND session_id = ? AND status != ?')
        .run(buttonId, sessionId, 'running');

      return {
        deletedCount: result.changes,
        deletedRuns: runs.map(r => ({ id: r.id, buttonId: r.button_id })),
      };
    });

    return deleteRuns();
  }

  /**
   * Delete all runs for a session (useful for testing or cleanup)
   */
  deleteBySessionId(sessionId) {
    const result = this.db
      .prepare('DELETE FROM command_runs WHERE session_id = ?')
      .run(sessionId);
    return result.changes;
  }

  /**
   * Get the latest run for each (session_id, button_id) combination within a project
   * Returns the most recent run per button per session regardless of age
   */
  getLatestRunsForProject(projectId) {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM (
           SELECT cr.id, cr.session_id, cr.button_id, cr.status, cr.exit_code, cr.started_at, cr.completed_at,
             EXISTS(SELECT 1 FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS has_output,
             (SELECT COALESCE(MAX(sequence), 0) FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS output_high_water,
             ROW_NUMBER() OVER (PARTITION BY cr.session_id, cr.button_id ORDER BY COALESCE(cr.completed_at, cr.started_at) DESC, cr.id DESC) as rn
           FROM command_runs cr
           INNER JOIN sessions s ON cr.session_id = s.id
           WHERE s.project_id = ?
         )
         WHERE rn = 1
         ORDER BY COALESCE(completed_at, started_at) DESC, id DESC`
      )
      .all(projectId);
    return this.mapAll(rows);
  }

  /**
   * Get the latest run for each button in a session (one per button)
   * @param {string} sessionId - Session ID
   * @returns {Array} Array of CommandRun objects
   */
  getLatestRunsForSession(sessionId) {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM (
           SELECT cr.id, cr.session_id, cr.button_id, cr.status, cr.exit_code, cr.output, cr.started_at, cr.completed_at,
             EXISTS(SELECT 1 FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS has_output,
             (SELECT COALESCE(MAX(sequence), 0) FROM command_run_output_chunks c WHERE c.run_id = cr.id) AS output_high_water,
             ROW_NUMBER() OVER (PARTITION BY cr.button_id ORDER BY COALESCE(cr.completed_at, cr.started_at) DESC, cr.id DESC) as rn
           FROM command_runs cr
           WHERE cr.session_id = ?
         )
         WHERE rn = 1
         ORDER BY COALESCE(completed_at, started_at) DESC, id DESC`
      )
      .all(sessionId);
    return this.mapAll(rows);
  }
}
