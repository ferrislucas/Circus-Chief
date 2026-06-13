import { randomUUID } from 'node:crypto';
import { DEFAULT_SESSION_TEMPLATES } from './defaultSessionTemplates.js';

const BOOTSTRAP_KEY = 'default_session_templates_bootstrapped';

/**
 * One-time first-run bootstrap for default global session templates.
 *
 * Rules:
 *  - If `default_session_templates_bootstrapped` is already `true` in app_settings,
 *    do nothing (fast path for all subsequent startups).
 *  - If the database is NOT a first-run (i.e. an existing database being upgraded),
 *    set the flag and return without inserting any templates.
 *  - If the database IS a first-run AND no global templates exist yet, insert the
 *    six default templates.
 *  - Always set the flag at the end so future startups skip this code entirely.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ isFirstRun: boolean }} options
 */
export function bootstrapDefaultSessionTemplates(db, { isFirstRun }) {
  // Fast path: already bootstrapped.
  const existing = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(BOOTSTRAP_KEY);
  if (existing?.value === 'true') return;

  const now = Date.now();

  if (!isFirstRun) {
    // Existing database being upgraded — do not insert defaults; just mark done.
    db.prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)"
    ).run(BOOTSTRAP_KEY, 'true', now);
    return;
  }

  // Fresh database: insert defaults only if there are no global templates yet.
  const count = db
    .prepare('SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NULL')
    .get().cnt;

  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO session_templates (
        id, project_id, name, prompt,
        next_template_id, thinking_enabled,
        git_branch, git_mode, model, mode, effort_level,
        show_in_quick_responses, quick_response_auto_submit,
        quick_response_sort_order,
        created_at, updated_at
      ) VALUES (?, NULL, ?, ?, NULL, 1, NULL, NULL, NULL, 'yolo', NULL, ?, ?, ?, ?, ?)
    `);

    for (const item of DEFAULT_SESSION_TEMPLATES) {
      insert.run(
        randomUUID(),
        item.name,
        item.prompt,
        item.showInQuickResponses ? 1 : 0,
        item.quickResponseAutoSubmit ? 1 : 0,
        item.quickResponseSortOrder,
        now,
        now
      );
    }
  }

  // Mark bootstrapped regardless of whether defaults were inserted.
  db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)"
  ).run(BOOTSTRAP_KEY, 'true', now);
}
