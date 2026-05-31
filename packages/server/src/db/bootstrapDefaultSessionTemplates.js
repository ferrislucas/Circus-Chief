import { randomUUID } from 'node:crypto';
import {
  BUILT_IN_SESSION_TEMPLATE_CATALOG_VERSION,
  DEFAULT_SESSION_TEMPLATES,
  findCatalogEntryByExactTemplate,
  promptFingerprint,
} from './sessionTemplateCatalog.js';

const BOOTSTRAP_KEY = 'default_session_templates_bootstrapped';
const RECONCILED_KEY = 'default_session_templates_reconciled';

function setAppSetting(db, key, value, now) {
  db.prepare(
    'INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)'
  ).run(key, value, now);
}

function backfillExactBuiltInMatches(db) {
  const rows = db.prepare(`
    SELECT id, name, prompt
    FROM session_templates
    WHERE project_id IS NULL
      AND built_in_key IS NULL
      AND source = 'user'
  `).all();

  const update = db.prepare(`
    UPDATE session_templates
    SET source = 'built_in',
        built_in_key = ?,
        source_version = ?,
        prompt_fingerprint = ?,
        updated_at = ?
    WHERE id = ?
      AND built_in_key IS NULL
  `);

  const now = Date.now();
  for (const row of rows) {
    const entry = findCatalogEntryByExactTemplate(row);
    if (!entry) continue;
    update.run(entry.key, BUILT_IN_SESSION_TEMPLATE_CATALOG_VERSION, entry.promptFingerprint, now, row.id);
  }
}

/**
 * Catalog-aware reconciliation for default global session templates.
 *
 * Rules:
 *  - If `default_session_templates_reconciled` matches the catalog version,
 *    do nothing (fast path for all subsequent startups).
 *  - If the database is NOT a first-run, backfill provenance only for exact
 *    current catalog matches, then mark reconciled without inserting templates.
 *  - If the database IS a first-run AND no global templates exist yet, insert the
 *    canonical catalog entries intended for new installs.
 *  - Always set the reconciliation marker at the end so future startups do not
 *    resurrect templates the user deleted.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{ isFirstRun: boolean }} options
 */
export function reconcileBuiltInSessionTemplates(db, { isFirstRun }) {
  const existing = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(RECONCILED_KEY);
  if (existing?.value === String(BUILT_IN_SESSION_TEMPLATE_CATALOG_VERSION)) return;

  const now = Date.now();

  if (!isFirstRun) {
    backfillExactBuiltInMatches(db);
    setAppSetting(db, RECONCILED_KEY, String(BUILT_IN_SESSION_TEMPLATE_CATALOG_VERSION), now);
    setAppSetting(db, BOOTSTRAP_KEY, 'true', now);
    return;
  }

  const count = db
    .prepare('SELECT COUNT(*) AS cnt FROM session_templates WHERE project_id IS NULL')
    .get().cnt;

  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO session_templates (
        id, project_id, name, prompt,
        next_template_id, thinking_enabled,
        git_branch, git_mode, model, mode, effort_level, target_lane_id,
        show_in_quick_responses, quick_response_auto_submit,
        quick_response_sort_order, legacy_quick_response_id,
        built_in_key, source, source_version, prompt_fingerprint,
        created_at, updated_at
      ) VALUES (?, NULL, ?, ?, NULL, 1, NULL, NULL, NULL, 'yolo', NULL, NULL, ?, ?, ?, NULL, ?, 'built_in', ?, ?, ?, ?)
    `);

    for (const item of DEFAULT_SESSION_TEMPLATES) {
      insert.run(
        randomUUID(),
        item.name,
        item.prompt,
        item.showInQuickResponses ? 1 : 0,
        item.quickResponseAutoSubmit ? 1 : 0,
        item.quickResponseSortOrder,
        item.key,
        BUILT_IN_SESSION_TEMPLATE_CATALOG_VERSION,
        item.promptFingerprint ?? promptFingerprint(item.prompt),
        now,
        now
      );
    }
  } else {
    backfillExactBuiltInMatches(db);
  }

  setAppSetting(db, RECONCILED_KEY, String(BUILT_IN_SESSION_TEMPLATE_CATALOG_VERSION), now);
  setAppSetting(db, BOOTSTRAP_KEY, 'true', now);
}

export function bootstrapDefaultSessionTemplates(db, options) {
  return reconcileBuiltInSessionTemplates(db, options);
}
