export const ACTIVITY_TRIGGER_NAMES = [
  'trg_sessions_activity_on_message',
  'trg_sessions_activity_on_message_update',
  'trg_sessions_activity_on_command_run_insert',
  'trg_sessions_activity_on_command_run_complete',
  'trg_sessions_activity_on_summary_insert',
  'trg_sessions_activity_on_summary_update',
];

export const ACTIVITY_TRIGGER_DROP_DDL = ACTIVITY_TRIGGER_NAMES
  .map((name) => `DROP TRIGGER IF EXISTS ${name}`);

// Used by migrations and table recreation. schema.sql is the corresponding
// fresh-database definition and is verified against this source in tests.
export const ACTIVITY_TRIGGER_CREATE_DDL = [
  `CREATE TRIGGER IF NOT EXISTS trg_sessions_activity_on_message
   AFTER INSERT ON conversation_messages
   BEGIN
     UPDATE sessions SET last_activity_at = NEW.timestamp
     WHERE id = NEW.session_id
       AND (last_activity_at IS NULL OR last_activity_at < NEW.timestamp);
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_sessions_activity_on_message_update
   AFTER UPDATE OF timestamp ON conversation_messages
   BEGIN
     UPDATE sessions SET last_activity_at = NEW.timestamp
     WHERE id = NEW.session_id
       AND (last_activity_at IS NULL OR last_activity_at < NEW.timestamp);
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_sessions_activity_on_command_run_insert
   AFTER INSERT ON command_runs
   BEGIN
     UPDATE sessions SET last_activity_at = COALESCE(NEW.completed_at, NEW.started_at)
     WHERE id = NEW.session_id
       AND (last_activity_at IS NULL OR last_activity_at < COALESCE(NEW.completed_at, NEW.started_at));
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_sessions_activity_on_command_run_complete
   AFTER UPDATE OF completed_at ON command_runs
   WHEN NEW.completed_at IS NOT NULL
   BEGIN
     UPDATE sessions SET last_activity_at = NEW.completed_at
     WHERE id = NEW.session_id
       AND (last_activity_at IS NULL OR last_activity_at < NEW.completed_at);
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_sessions_activity_on_summary_insert
   AFTER INSERT ON session_summaries
   BEGIN
     UPDATE sessions SET last_activity_at = max(COALESCE(NEW.generated_at, 0), COALESCE(NEW.updated_at, 0))
     WHERE id = NEW.session_id
       AND (last_activity_at IS NULL OR last_activity_at < max(COALESCE(NEW.generated_at, 0), COALESCE(NEW.updated_at, 0)));
   END`,
  `CREATE TRIGGER IF NOT EXISTS trg_sessions_activity_on_summary_update
   AFTER UPDATE OF generated_at, updated_at ON session_summaries
   BEGIN
     UPDATE sessions SET last_activity_at = max(COALESCE(NEW.generated_at, 0), COALESCE(NEW.updated_at, 0))
     WHERE id = NEW.session_id
       AND (last_activity_at IS NULL OR last_activity_at < max(COALESCE(NEW.generated_at, 0), COALESCE(NEW.updated_at, 0)));
   END`,
];
