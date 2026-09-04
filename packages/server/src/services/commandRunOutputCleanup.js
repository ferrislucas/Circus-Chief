import { commandRuns } from '../database.js';
import { removeCommandRunOutputResource } from './commandRunOutputResource.js';

const MAX_ATTEMPTS = 8;

/** Process durable cleanup work. Deletion authorization never depends on this succeeding. */
export async function processCommandRunOutputCleanup({ repository = commandRuns, limit = 25 } = {}) {
  const now = Date.now();
  const tasks = repository.db.prepare(
    'SELECT run_id, working_directory, attempts FROM command_run_output_cleanup WHERE next_attempt_at <= ? ORDER BY created_at LIMIT ?'
  ).all(now, limit);
  for (const task of tasks) {
    try {
      await removeCommandRunOutputResource({ workingDirectory: task.working_directory, runId: task.run_id });
      repository.db.prepare('DELETE FROM command_run_output_cleanup WHERE run_id = ?').run(task.run_id);
    } catch (error) {
      const attempts = task.attempts + 1;
      const delay = Math.min(60_000, 250 * (2 ** Math.min(attempts, 8)));
      repository.db.prepare(`UPDATE command_run_output_cleanup SET attempts = ?, next_attempt_at = ?, last_error = ?
        WHERE run_id = ?`).run(attempts, now + delay, error?.code || error?.name || 'UNKNOWN', task.run_id);
      console.error('[Command output cleanup] retry scheduled', { runId: task.run_id, attempts, exhausted: attempts >= MAX_ATTEMPTS });
    }
  }
  return tasks.length;
}
