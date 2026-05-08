/**
 * Repair sessions whose parent link was lost during schema consolidation.
 *
 * Child sessions inherit their root session's worktree. When parent_session_id
 * is missing, the final UUID segment of git_worktree can identify the owning
 * root session. Only repair rows where that UUID belongs to another session in
 * the same project.
 */
export const repairMissingSessionParentsFromWorktree = {
  name: 'repair-missing-session-parents-from-worktree',
  up(db) {
    db.prepare(`
      UPDATE sessions
      SET parent_session_id = (
        SELECT parent.id
        FROM sessions AS parent
        WHERE parent.id = substr(sessions.git_worktree, length(sessions.git_worktree) - 35, 36)
          AND parent.project_id = sessions.project_id
          AND parent.id <> sessions.id
      )
      WHERE parent_session_id IS NULL
        AND git_worktree IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM sessions AS parent
          WHERE parent.id = substr(sessions.git_worktree, length(sessions.git_worktree) - 35, 36)
            AND parent.project_id = sessions.project_id
            AND parent.id <> sessions.id
        )
    `).run();
  },
};

/**
 * Post-baseline database migrations.
 *
 * Pre-release migration history was consolidated into schema.sql. Future
 * shipped schema changes should be added here as explicit migrations.
 *
 * @type {Array<{name: string, up: (db: import('better-sqlite3').Database) => void}>}
 */
export const allMigrations = [
  repairMissingSessionParentsFromWorktree,
];
