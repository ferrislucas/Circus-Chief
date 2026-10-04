/* eslint-disable max-lines -- one ordered, append-only migration history is easier to audit together */
/**
 * Migrations for Kanban board feature: kanban_boards, kanban_lanes,
 * kanban_cards, kanban_card_sessions tables, and related columns on
 * projects, sessions, and session_templates.
 */
import { addColumnIfMissing, getColumns } from './migrationUtils.js';

export const kanbanMigrations = [
  {
    name: 'projects-add-kanban_enabled',
    up(db) {
      // Deprecated: Kanban is always available, but migration history is append-only.
      addColumnIfMissing(db, 'projects', 'kanban_enabled', 'INTEGER NOT NULL DEFAULT 1');
    },
  },
  {
    name: 'kanban-create-tables',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS kanban_boards (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );

        CREATE TABLE IF NOT EXISTS kanban_lanes (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          on_enter_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );

        CREATE TABLE IF NOT EXISTS kanban_cards (
          id TEXT PRIMARY KEY,
          lane_id TEXT NOT NULL REFERENCES kanban_lanes(id) ON DELETE CASCADE,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );

        CREATE TABLE IF NOT EXISTS kanban_card_sessions (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
          session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );

        CREATE INDEX IF NOT EXISTS idx_kanban_boards_project ON kanban_boards(project_id);
        CREATE INDEX IF NOT EXISTS idx_kanban_lanes_board ON kanban_lanes(board_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_kanban_cards_lane ON kanban_cards(lane_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_kanban_card_sessions_session ON kanban_card_sessions(session_id);
        CREATE INDEX IF NOT EXISTS idx_kanban_card_sessions_card ON kanban_card_sessions(card_id);
      `);
    },
  },
  {
    name: 'sessions-add-target_lane_id',
    up(db) {
      addColumnIfMissing(db, 'sessions', 'target_lane_id', 'TEXT REFERENCES kanban_lanes(id) ON DELETE SET NULL');
    },
  },
  {
    name: 'sessions-add-lane_trigger_depth',
    up(db) {
      addColumnIfMissing(db, 'sessions', 'lane_trigger_depth', 'INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    name: 'session_templates-add-target_lane_id',
    up(db) {
      addColumnIfMissing(db, 'session_templates', 'target_lane_id', 'TEXT REFERENCES kanban_lanes(id) ON DELETE SET NULL');
    },
  },
  {
    name: 'kanban_lanes-add-on_enter_prompt',
    up(db) {
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_prompt', 'TEXT');
    },
  },
  {
    name: 'kanban_lanes-add-agent-settings',
    up(db) {
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_mode', 'TEXT');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_model', 'TEXT');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_effort_level', 'TEXT');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_thinking_enabled', 'INTEGER');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_auto_reschedule_enabled', 'INTEGER DEFAULT 0');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_reschedule_delay_minutes', 'INTEGER DEFAULT 60'); // keep in sync with DEFAULT_RESCHEDULE_DELAY_MINUTES
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_reschedule_on_token_limit', 'INTEGER DEFAULT 1');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_reschedule_on_service_error', 'INTEGER DEFAULT 1');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_max_reschedule_count', 'INTEGER');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_max_total_tokens', 'INTEGER');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_reschedule_at_token_count', 'INTEGER');
    },
  },
  {
    name: 'kanban_lanes-add-completion_target_lane_id',
    up(db) {
      addColumnIfMissing(db, 'kanban_lanes', 'completion_target_lane_id', 'TEXT REFERENCES kanban_lanes(id) ON DELETE SET NULL');
    },
  },
  {
    // Drop the dormant per-session target_lane_id routing flag from sessions.
    // Uses ALTER TABLE DROP COLUMN (SQLite ≥ 3.35), dropping the column in
    // place so other columns and their ordering are preserved.
    // Idempotent: guarded by column-existence check.
    name: 'sessions-drop-target_lane_id',
    up(db) {
      const columns = getColumns(db, 'sessions');
      if (!columns.includes('target_lane_id')) {
        return; // Already dropped — idempotent guard
      }
      // Disable FK enforcement for the duration so the FK reference on
      // kanban_lanes doesn't block the drop.
      const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true });
      db.pragma('foreign_keys = OFF');
      try {
        db.exec('ALTER TABLE sessions DROP COLUMN target_lane_id');
      } finally {
        db.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
      }
    },
  },
  {
    // Drop the dormant per-template target_lane_id routing flag.
    // Uses ALTER TABLE DROP COLUMN (SQLite ≥ 3.35).
    // Idempotent: guarded by column-existence check.
    name: 'session_templates-drop-target_lane_id',
    up(db) {
      const columns = getColumns(db, 'session_templates');
      if (!columns.includes('target_lane_id')) {
        return; // Already dropped — idempotent guard
      }
      // Disable FK enforcement for the duration so the FK reference on
      // kanban_lanes doesn't block the drop.
      const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true });
      db.pragma('foreign_keys = OFF');
      try {
        db.exec('ALTER TABLE session_templates DROP COLUMN target_lane_id');
      } finally {
        db.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
      }
    },
  },
  {
    name: 'kanban-add-lane-run-workflow',
    up(db) {
      addColumnIfMissing(db, 'kanban_cards', 'active_lane_run_id', 'TEXT');
      addColumnIfMissing(db, 'kanban_cards', 'lane_entry_event_id', 'TEXT');
      // Note: this intentionally does NOT (re-)create workflow_turn_token,
      // completion_requested_turn_token, completion_request_key, or
      // completion_requested_at. Those belonged to the removed agent-driven
      // workflow-complete apparatus, never carried data, and are dropped by
      // kanban-drop-agent-workflow-completion-tokens below for any existing
      // database that still has them from before this cleanup.
      for (const [column, definition] of Object.entries({
        lane_run_id: 'TEXT', own_work_state: "TEXT NOT NULL DEFAULT 'open'",
        own_work_closed_at: 'INTEGER', workflow_updated_at: 'INTEGER', workflow_reason: 'TEXT',
      })) addColumnIfMissing(db, 'sessions', column, definition);
      db.exec(`
        CREATE TABLE IF NOT EXISTS kanban_lane_entry_events (
          id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL,
          workspace_id TEXT NOT NULL, card_id TEXT NOT NULL, lane_id TEXT NOT NULL, cause TEXT NOT NULL,
          caused_by_run_id TEXT, status TEXT NOT NULL DEFAULT 'pending', claim_token TEXT, claimed_at INTEGER,
          claim_expires_at INTEGER, next_attempt_at INTEGER, attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL, completed_at INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lane_entry_completion_cause ON kanban_lane_entry_events(caused_by_run_id) WHERE caused_by_run_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_lane_entry_recovery ON kanban_lane_entry_events(status, next_attempt_at, created_at);
        CREATE TABLE IF NOT EXISTS kanban_lane_runs (
          id TEXT PRIMARY KEY, lane_entry_event_id TEXT NOT NULL UNIQUE, prior_lane_run_id TEXT,
          project_id TEXT NOT NULL, workspace_id TEXT NOT NULL, card_id TEXT NOT NULL, source_lane_id TEXT NOT NULL,
          completion_target_lane_id TEXT, root_session_id TEXT UNIQUE,
          status TEXT NOT NULL DEFAULT 'open', failure_reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          succeeded_at INTEGER, failed_at INTEGER, cancelled_at INTEGER, superseded_at INTEGER, transition_applied_at INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_lane_runs_one_open_card ON kanban_lane_runs(card_id) WHERE status = 'open';
        CREATE INDEX IF NOT EXISTS idx_lane_runs_card_status ON kanban_lane_runs(card_id, status);
        CREATE INDEX IF NOT EXISTS idx_lane_runs_workspace ON kanban_lane_runs(workspace_id);
        CREATE INDEX IF NOT EXISTS idx_lane_runs_root ON kanban_lane_runs(root_session_id);
        CREATE TABLE IF NOT EXISTS kanban_lane_run_audit_events (
          id TEXT PRIMARY KEY, operation_key TEXT UNIQUE, lane_run_id TEXT NOT NULL, session_id TEXT,
          event_type TEXT NOT NULL, details_json TEXT, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_lane_run_audit_run ON kanban_lane_run_audit_events(lane_run_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_lane_run ON sessions(lane_run_id);
      `);
      addColumnIfMissing(db, 'kanban_lane_entry_events', 'claim_expires_at', 'INTEGER');
      addColumnIfMissing(db, 'kanban_lane_entry_events', 'next_attempt_at', 'INTEGER');
      db.exec('CREATE INDEX IF NOT EXISTS idx_lane_entry_recovery_due ON kanban_lane_entry_events(status, next_attempt_at, created_at)');
    },
  },
  {
    // FR-5: separate lifecycle dimensions. execution_state tracks what the
    // process is doing right now; subtree_outcome tracks the aggregate
    // outcome of this session's own work plus every blocking descendant.
    // Both are independent of own_work_state (which only tracks *this*
    // session's own obligation). Must run before sessions-immutable-parent_
    // session_id, whose table recreation copies the complete current shape.
    name: 'kanban-add-lane-run-execution-state',
    up(db) {
      addColumnIfMissing(db, 'sessions', 'execution_state', "TEXT NOT NULL DEFAULT 'idle'");
      addColumnIfMissing(db, 'sessions', 'subtree_outcome', "TEXT NOT NULL DEFAULT 'open'");
    },
  },
  {
    // Kept intentionally even though kanban-add-lane-run-workflow no longer
    // creates these columns (F2 cleanup): existing databases upgraded from
    // before that cleanup may still have them on disk. Guarded by the
    // column-existence check below, so it is a safe no-op on any database
    // (fresh or already-cleaned) that never had them.
    name: 'kanban-drop-agent-workflow-completion-tokens',
    up(db) {
      const columns = getColumns(db, 'sessions');
      for (const column of ['workflow_turn_token', 'completion_requested_turn_token', 'completion_request_key', 'completion_requested_at']) {
        if (columns.includes(column)) db.exec(`ALTER TABLE sessions DROP COLUMN ${column}`);
      }
    },
  },
  {
    // Hard cutover: lane configuration now determines execution ownership;
    // The retired mode column is neither read nor retained in the schema.
    name: 'kanban-drop-completion-mode-hard-cutover',
    up(db) {
      const laneColumns = getColumns(db, 'kanban_lanes');
      const runColumns = getColumns(db, 'kanban_lane_runs');
      // A table recreation, rather than DROP COLUMN, removes old CHECK
      // constraints and makes the persisted lane contract exactly match the
      // fresh-schema baseline. Existing rows are copied as configuration and
      // historical runs/events remain untouched diagnostic history.
      if (laneColumns.includes('completion_mode')) {
        const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true });
        db.pragma('foreign_keys = OFF');
        try {
          db.transaction(() => {
            db.exec(`CREATE TABLE kanban_lanes_cutover (
            id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
            name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
            on_enter_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
            on_enter_prompt TEXT, on_enter_mode TEXT, on_enter_model TEXT, on_enter_provider_id TEXT, on_enter_effort_level TEXT,
            on_enter_thinking_enabled INTEGER, on_enter_auto_reschedule_enabled INTEGER DEFAULT 0,
            on_enter_reschedule_delay_minutes INTEGER DEFAULT 60,
            on_enter_reschedule_on_token_limit INTEGER DEFAULT 1,
            on_enter_reschedule_on_service_error INTEGER DEFAULT 1,
            on_enter_max_reschedule_count INTEGER, on_enter_max_total_tokens INTEGER,
            on_enter_reschedule_at_token_count INTEGER,
            completion_target_lane_id TEXT REFERENCES kanban_lanes_cutover(id) ON DELETE SET NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
          );
          INSERT INTO kanban_lanes_cutover (id,board_id,name,sort_order,on_enter_template_id,on_enter_prompt,on_enter_mode,on_enter_model,on_enter_provider_id,on_enter_effort_level,on_enter_thinking_enabled,on_enter_auto_reschedule_enabled,on_enter_reschedule_delay_minutes,on_enter_reschedule_on_token_limit,on_enter_reschedule_on_service_error,on_enter_max_reschedule_count,on_enter_max_total_tokens,on_enter_reschedule_at_token_count,completion_target_lane_id,created_at,updated_at)
          SELECT id,board_id,name,sort_order,on_enter_template_id,on_enter_prompt,on_enter_mode,on_enter_model,on_enter_provider_id,on_enter_effort_level,on_enter_thinking_enabled,on_enter_auto_reschedule_enabled,on_enter_reschedule_delay_minutes,on_enter_reschedule_on_token_limit,on_enter_reschedule_on_service_error,on_enter_max_reschedule_count,on_enter_max_total_tokens,on_enter_reschedule_at_token_count,completion_target_lane_id,created_at,updated_at FROM kanban_lanes;
          DROP TABLE kanban_lanes;
          ALTER TABLE kanban_lanes_cutover RENAME TO kanban_lanes;
          CREATE INDEX IF NOT EXISTS idx_kanban_lanes_board ON kanban_lanes(board_id, sort_order);`);
            // Target-only lanes were valid before the hard cutover but cannot own
            // a durable run. Preserve their configuration verbatim: clearing the
            // target here would silently change a live workflow on upgrade.
            // Startup preflight reports this configuration as invalid until an
            // operator adds on-entry automation or deliberately removes the
            // completion target.
            const time = Date.now();
            db.exec(`CREATE TABLE IF NOT EXISTS kanban_migration_notes (
              lane_id TEXT PRIMARY KEY, note TEXT NOT NULL, created_at INTEGER NOT NULL
            )`);
            db.prepare(`INSERT OR IGNORE INTO kanban_migration_notes (lane_id, note, created_at)
              SELECT id, 'Legacy completion target requires on-entry automation before lane runs can be enabled', ?
              FROM kanban_lanes WHERE completion_target_lane_id IS NOT NULL
                AND (on_enter_prompt IS NULL OR trim(on_enter_prompt)='')
                AND on_enter_template_id IS NULL`).run(time);
            if (db.pragma('foreign_key_check').length) throw new Error('Foreign key check failed during Kanban hard cutover');
          })();
        } finally {
          db.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
        }
      }
      const foreignKeysEnabled = db.pragma('foreign_keys', { simple: true });
      db.pragma('foreign_keys = OFF');
      try {
        if (runColumns.includes('completion_mode')) db.exec('ALTER TABLE kanban_lane_runs DROP COLUMN completion_mode');
      } finally {
        db.pragma(`foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
      }
    },
  },
  {
    name: 'kanban-lane-entry-retry-schedule',
    up(db) {
      addColumnIfMissing(db, 'kanban_lane_entry_events', 'claim_expires_at', 'INTEGER');
      addColumnIfMissing(db, 'kanban_lane_entry_events', 'next_attempt_at', 'INTEGER');
      db.exec('CREATE INDEX IF NOT EXISTS idx_lane_entry_recovery_due ON kanban_lane_entry_events(status, next_attempt_at, created_at)');
    },
  },
  {
    name: 'kanban-durable-delivery-and-api-operations',
    up(db) {
      // These are additive so historical events remain conservative: an old
      // event without an acknowledgement is never silently called delivered.
      addColumnIfMissing(db, 'kanban_lane_entry_events', 'delivery_phase', "TEXT NOT NULL DEFAULT 'pending'");
      addColumnIfMissing(db, 'kanban_lane_entry_events', 'dispatch_key', 'TEXT');
      addColumnIfMissing(db, 'kanban_lane_entry_events', 'dispatch_acknowledged_at', 'INTEGER');
      db.exec(`CREATE TABLE IF NOT EXISTS kanban_api_operations (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, operation_key TEXT NOT NULL,
        endpoint TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'processing',
        result_json TEXT, lane_entry_event_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(project_id, endpoint, operation_key)
      );
      CREATE INDEX IF NOT EXISTS idx_kanban_api_operations_updated ON kanban_api_operations(updated_at);`);
    },
  },
  {
    name: 'kanban-delivery-health-status-index',
    up(db) {
      db.exec('CREATE INDEX IF NOT EXISTS idx_lane_entry_health_status_created ON kanban_lane_entry_events(status, created_at)');
    },
  },
  {
    name: 'kanban-api-operation-leases-and-canonical-responses',
    up(db) {
      addColumnIfMissing(db, 'kanban_api_operations', 'owner_token', 'TEXT');
      addColumnIfMissing(db, 'kanban_api_operations', 'lease_expires_at', 'INTEGER');
      addColumnIfMissing(db, 'kanban_api_operations', 'attempt_count', "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, 'kanban_api_operations', 'response_status', 'INTEGER');
      addColumnIfMissing(db, 'kanban_api_operations', 'terminal_error', 'TEXT');
      db.exec('CREATE INDEX IF NOT EXISTS idx_kanban_api_operations_lease ON kanban_api_operations(status, lease_expires_at)');
    },
  },
  {
    name: 'kanban-lane-run-declared-exit-lane',
    up(db) {
      addColumnIfMissing(db, 'kanban_lane_runs', 'chosen_exit_lane_id',
        'TEXT REFERENCES kanban_lanes(id) ON DELETE SET NULL');
      addColumnIfMissing(db, 'kanban_lane_runs', 'chosen_exit_declared_at', 'INTEGER');
    },
  },
  {
    name: 'kanban-drop-exit-lane-caller-attribution',
    up(db) {
      if (getColumns(db, 'kanban_lane_runs').includes('chosen_exit_declared_by')) {
        db.exec('ALTER TABLE kanban_lane_runs DROP COLUMN chosen_exit_declared_by');
      }
    },
  },
  {
    // A deferred card move belongs to one provider turn, not merely a reusable
    // workflow session. These fields fence late completions after restart or
    // supersession while retaining the existing shared exit-lane declaration.
    name: 'kanban-deferred-card-move-turn-fence',
    up(db) {
      addColumnIfMissing(db, 'sessions', 'execution_turn_token', 'TEXT');
      addColumnIfMissing(db, 'kanban_lane_runs', 'deferred_move_session_id', 'TEXT');
      addColumnIfMissing(db, 'kanban_lane_runs', 'deferred_move_turn_token', 'TEXT');
      addColumnIfMissing(db, 'kanban_lane_runs', 'deferred_move_sort_order', 'REAL');
      addColumnIfMissing(db, 'kanban_lane_runs', 'deferred_move_run_on_enter', 'INTEGER');
      db.exec('CREATE INDEX IF NOT EXISTS idx_lane_runs_deferred_move_session ON kanban_lane_runs(deferred_move_session_id, deferred_move_turn_token)');
    },
  },
  {
    // Drop the dormant lane_trigger_depth recursion counter from sessions.
    // MAX_LANE_TRIGGER_DEPTH (the cap it fed) was removed; nothing reads or
    // writes the column. Uses ALTER TABLE DROP COLUMN (SQLite ≥ 3.35).
    // Idempotent: guarded by column-existence check.
    name: 'sessions-drop-lane_trigger_depth',
    up(db) {
      const columns = getColumns(db, 'sessions');
      if (!columns.includes('lane_trigger_depth')) {
        return; // Already dropped — idempotent guard
      }
      db.exec('ALTER TABLE sessions DROP COLUMN lane_trigger_depth');
    },
  },
  {
    // Unified workspace routing owns a destination at the lane-run level;
    // provider-turn attribution is no longer part of card routing.
    name: 'kanban-drop-deferred-card-move-turn-fence',
    up(db) {
      db.exec('DROP INDEX IF EXISTS idx_lane_runs_deferred_move_session');
      const columns = getColumns(db, 'kanban_lane_runs');
      for (const column of [
        'deferred_move_session_id', 'deferred_move_turn_token',
        'deferred_move_sort_order', 'deferred_move_run_on_enter',
      ]) {
        if (columns.includes(column)) db.exec(`ALTER TABLE kanban_lane_runs DROP COLUMN ${column}`);
      }
    },
  },
  {
    name: 'kanban-routing-observability',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS kanban_routing_audit_events (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
        caller_session_id TEXT, source_lane_id TEXT NOT NULL, destination_lane_id TEXT NOT NULL,
        outcome TEXT NOT NULL, lane_run_id TEXT, request_at INTEGER NOT NULL, committed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kanban_routing_audit_workspace ON kanban_routing_audit_events(workspace_id, committed_at);`);
    },
  },
];
