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
      output: row.output || '',
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
    if (!text) return;
    this.db
      .prepare(`UPDATE command_runs SET output = output || ? WHERE id = ?`)
      .run(text, runId);
  }

  /**
   * Mark run as completed with exit code and final output
   */
  complete(runId, exitCode, finalOutput) {
    const status = exitCode === 0 ? 'success' : 'error';
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE command_runs SET status = ?, output = ?, exit_code = ?, completed_at = ? WHERE id = ?`
      )
      .run(status, finalOutput, exitCode, now, runId);
  }

  /**
   * Mark run as killed
   */
  markKilled(runId, finalOutput) {
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE command_runs SET status = 'killed', output = ?, completed_at = ? WHERE id = ?`
      )
      .run(finalOutput, now, runId);
  }

  /**
   * Get all runs for a session (both running and recent completed)
   */
  getBySessionId(sessionId) {
    const rows = this.db
      .prepare('SELECT * FROM command_runs WHERE session_id = ? ORDER BY started_at DESC')
      .all(sessionId);
    return this.mapAll(rows);
  }

  /**
   * Get runs for a session from last X milliseconds (recent runs)
   * If includeRunning is true, also include running commands regardless of age
   */
  getRecentBySessionId(sessionId, windowMs = 3600000, includeRunning = true) {
    const cutoffTime = Date.now() - windowMs;
    let query = `SELECT * FROM command_runs WHERE session_id = ?`;

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
    const row = this.db.prepare('SELECT * FROM command_runs WHERE id = ?').get(id);
    return this.map(row);
  }

  /**
   * Get most recent run for a button
   */
  getLastRunForButton(buttonId) {
    const row = this.db
      .prepare('SELECT * FROM command_runs WHERE button_id = ? ORDER BY started_at DESC LIMIT 1')
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
