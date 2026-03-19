/**
 * Migrations for Kanban board feature: kanban_boards, kanban_lanes,
 * kanban_cards, kanban_card_sessions tables, and related columns on
 * projects, sessions, and session_templates.
 */
import { addColumnIfMissing } from './migrationUtils.js';

export const kanbanMigrations = [
  {
    name: 'projects-add-kanban_enabled',
    up(db) {
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
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_reschedule_delay_minutes', 'INTEGER DEFAULT 15');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_reschedule_on_token_limit', 'INTEGER DEFAULT 1');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_reschedule_on_service_error', 'INTEGER DEFAULT 1');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_max_reschedule_count', 'INTEGER');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_max_total_tokens', 'INTEGER');
      addColumnIfMissing(db, 'kanban_lanes', 'on_enter_reschedule_at_token_count', 'INTEGER');
    },
  },
];
