import { commandRuns } from '../database.js';
import { removeCommandRunOutputResource } from './commandRunOutputResource.js';

export const MAX_COMMAND_RUN_OUTPUT_CLEANUP_ATTEMPTS = 8;

/** The initial cleanup execution is attempt one; a task executes at most this many times. */
function cleanupRetryOutcome({ attempts, error, now }) {
  const exhausted = attempts >= MAX_COMMAND_RUN_OUTPUT_CLEANUP_ATTEMPTS;
  return {
    attempts,
    exhausted,
    lastError: error?.code || error?.name || 'UNKNOWN',
    nextAttemptAt: now + Math.min(60_000, 250 * (2 ** Math.min(attempts, 8))),
  };
}

/** Process durable cleanup work. Deletion authorization never depends on this succeeding. */
export async function processCommandRunOutputCleanup({ repository = commandRuns, limit = 25 } = {}) {
  const now = Date.now();
  const tasks = repository.db.prepare(
    `SELECT run_id, working_directory, attempts FROM command_run_output_cleanup
     WHERE next_attempt_at <= ? AND exhausted_at IS NULL AND attempts < ?
     ORDER BY created_at LIMIT ?`
  ).all(now, MAX_COMMAND_RUN_OUTPUT_CLEANUP_ATTEMPTS, limit);
  for (const task of tasks) {
    try {
      await removeCommandRunOutputResource({ workingDirectory: task.working_directory, runId: task.run_id });
      repository.db.prepare('DELETE FROM command_run_output_cleanup WHERE run_id = ?').run(task.run_id);
    } catch (error) {
      const outcome = cleanupRetryOutcome({ attempts: task.attempts + 1, error, now });
      repository.db.prepare(`UPDATE command_run_output_cleanup
        SET attempts = ?, next_attempt_at = ?, last_error = ?, exhausted_at = ?
        WHERE run_id = ?`).run(
        outcome.attempts,
        outcome.nextAttemptAt,
        outcome.lastError,
        outcome.exhausted ? now : null,
        task.run_id
      );
      if (outcome.exhausted) {
        console.error('[Command output cleanup] exhausted', {
          runId: task.run_id,
          attempts: outcome.attempts,
          lastError: outcome.lastError,
        });
      }
    }
  }
  return tasks.length;
}
