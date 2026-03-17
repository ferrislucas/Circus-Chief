/**
 * Central registry of all database migrations in execution order.
 *
 * Each migration is idempotent (checks before acting), so the exact ordering
 * only matters where there are hard dependencies (e.g. a table must exist
 * before a column references it via FK).
 *
 * The ordering below mirrors the original #runMigrations() top-to-bottom flow
 * as closely as possible.
 */
import { sessionsMigrations } from './sessionsMigrations.js';
import { projectsMigrations } from './projectsMigrations.js';
import { conversationsMigrations } from './conversationsMigrations.js';
import { canvasItemsMigrations } from './canvasItemsMigrations.js';
import { miscMigrations } from './miscMigrations.js';
import { kanbanMigrations } from './kanbanMigrations.js';

/**
 * Build a lookup map from a migrations array keyed by migration name.
 * @param {Array<{name: string, up: Function}>} migrations
 * @returns {Map<string, {name: string, up: Function}>}
 */
function toLookup(migrations) {
  const map = new Map();
  for (const m of migrations) {
    map.set(m.name, m);
  }
  return map;
}

const s = toLookup(sessionsMigrations);
const p = toLookup(projectsMigrations);
const c = toLookup(conversationsMigrations);
const ci = toLookup(canvasItemsMigrations);
const m = toLookup(miscMigrations);
const k = toLookup(kanbanMigrations);

/**
 * Flat, ordered list of every migration, matching the original execution order
 * from DatabaseManager.#runMigrations().
 *
 * @type {Array<{name: string, up: (db: import('better-sqlite3').Database) => void}>}
 */
// Validate that all migrations are properly defined
function validateMigrations(migrationsArray) {
  for (const migration of migrationsArray) {
    if (!migration || typeof migration.up !== 'function') {
      const name = migration?.name || 'unknown';
      throw new Error(`Migration "${name}" is undefined or missing an up() function`);
    }
  }
  return migrationsArray;
}

export const allMigrations = validateMigrations([
  // --- Sessions initial columns ---
  s.get('sessions-add-cost_usd'),
  s.get('sessions-add-claude_session_id'),
  s.get('sessions-add-model'),
  s.get('sessions-add-provider_id-early'),
  s.get('sessions-add-effort_level'),

  // --- Projects columns ---
  p.get('projects-add-system_prompt'),
  p.get('projects-add-on_session_created'),
  p.get('projects-add-on_session_deleted'),
  p.get('projects-add-repo_url'),
  p.get('projects-drop-summary-columns'),

  // --- Sessions scheduling columns ---
  s.get('sessions-add-scheduled_at'),
  s.get('sessions-add-reschedule_delay_minutes'),
  s.get('sessions-add-auto_reschedule_enabled'),
  s.get('sessions-add-reschedule_on_token_limit'),
  s.get('sessions-add-reschedule_on_service_error'),
  s.get('sessions-add-max_reschedule_count'),
  s.get('sessions-add-max_total_tokens'),
  s.get('sessions-add-reschedule_count'),
  s.get('sessions-add-reschedule_at_token_count'),

  // --- Sessions status constraint migration (table recreation) ---
  s.get('sessions-migrate-status-constraint'),

  // --- Session summaries PR columns ---
  c.get('session_summaries-add-pr_merged'),
  c.get('session_summaries-add-pr_state'),
  c.get('session_summaries-add-has_merge_conflicts'),
  c.get('session_summaries-add-ci_status'),
  c.get('session_summaries-add-ci_failures'),
  c.get('session_summaries-add-last_summarized_message_id'),

  // --- Sessions template chaining ---
  s.get('sessions-add-next_template_id'),
  s.get('sessions-add-parent_session_id'),
  s.get('sessions-template-chaining-indexes'),

  // --- Message attachments ---
  c.get('message_attachments-add-file_path'),

  // --- Conversation messages: conversation_id ---
  c.get('conversation_messages-add-conversation_id'),

  // --- Migrate existing sessions to conversations ---
  c.get('conversations-migrate-existing-sessions'),

  // --- Canvas items ---
  ci.get('canvas_items-migrate-type-constraint'),
  ci.get('canvas_items-add-deleted_at'),
  ci.get('canvas_items-drop-label'),
  ci.get('canvas_items-add-updated_at'),

  // --- Conversations: claude_session_id + token usage ---
  c.get('conversations-add-claude_session_id'),
  c.get('conversations-add-input_tokens'),
  c.get('conversations-add-output_tokens'),
  c.get('conversations-add-cache_read_input_tokens'),
  c.get('conversations-add-cache_creation_input_tokens'),
  c.get('conversations-add-web_search_requests'),
  c.get('conversations-add-context_window'),
  c.get('conversations-add-model'),

  // --- Sessions token usage ---
  s.get('sessions-add-input_tokens'),
  s.get('sessions-add-output_tokens'),
  s.get('sessions-add-cache_read_input_tokens'),
  s.get('sessions-add-cache_creation_input_tokens'),
  s.get('sessions-add-web_search_requests'),
  s.get('sessions-add-context_window'),

  // --- Sessions archived / starred / manually_named ---
  s.get('sessions-add-archived'),
  s.get('sessions-add-starred'),
  s.get('sessions-add-manually_named'),

  // --- Project session defaults table ---
  p.get('project_session_defaults-create-table'),

  // --- Command buttons ---
  m.get('command_buttons-add-show_on_list'),

  // --- Session todos ---
  c.get('session_todos-add-conversation_id'),

  // --- Conversation branching ---
  c.get('conversations-add-parent_conversation_id'),
  c.get('conversations-add-branch_from_message_id'),

  // --- Sessions pending prompt / slash commands / pending model / auto send ---
  s.get('sessions-add-pending_prompt'),
  s.get('sessions-add-slash_commands'),
  s.get('sessions-add-pending_model'),
  s.get('sessions-add-auto_send_pending_prompt'),

  // --- Session templates ---
  m.get('session_templates-add-model'),
  m.get('session_templates-add-mode'),

  // --- Conversation messages model ---
  c.get('conversation_messages-add-model'),

  // --- App settings table ---
  m.get('app_settings-create-table'),

  // --- Legacy model_providers cleanup ---
  m.get('model_providers-cleanup-legacy'),

  // --- Providers + provider_models tables + seed ---
  m.get('providers-create-tables'),
  m.get('providers-seed-built-in'),

  // --- Sessions provider_id (from providers FK) ---
  s.get('sessions-add-provider_id-from-providers'),

  // --- Project session defaults provider_id / effort_level ---
  p.get('project_session_defaults-add-provider_id'),
  p.get('project_session_defaults-add-effort_level'),

  // --- Update built-in models ---
  m.get('providers-update-built-in-models'),

  // --- Sessions agent_type ---
  s.get('sessions-add-agent_type'),

  // --- Agent call logs table ---
  m.get('agent_call_logs-create-table'),

  // --- Kanban feature ---
  k.get('projects-add-kanban_enabled'),
  k.get('kanban-create-tables'),
  k.get('sessions-add-target_lane_id'),
  k.get('sessions-add-lane_trigger_depth'),
  k.get('session_templates-add-target_lane_id'),
  k.get('kanban_lanes-add-on_enter_prompt'),
]);
