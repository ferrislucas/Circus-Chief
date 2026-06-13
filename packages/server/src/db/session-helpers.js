/**
 * Shared helpers for SessionRepository: SQL fragments, row mappers,
 * config parsing, and update-clause builders.
 */

import { DEFAULT_RESCHEDULE_DELAY_MINUTES } from '@circuschief/shared';

/** Shared ORDER BY clause for session list queries (most-recent activity first). */
export const SESSION_ORDER_BY =
  ' ORDER BY COALESCE(last_activity_at, updated_at, created_at) DESC, ' +
  'updated_at DESC, created_at DESC, rowid DESC';

/**
 * Append optional archived/starred WHERE filters to a session query.
 * Pushes bound params onto `params` and returns the extended SQL string.
 */
export function applySessionFilters(sql, params, { archived = null, starred = null } = {}) {
  let clause = sql;
  if (archived !== null) {
    clause += ' AND archived = ?';
    params.push(archived ? 1 : 0);
  }
  if (starred !== null) {
    clause += ' AND starred = ?';
    params.push(starred ? 1 : 0);
  }
  return clause;
}

/** Reusable SQL fragment for computed activity fields on sessions */
export const ACTIVITY_FIELDS_SQL = `
  (
    SELECT MAX(activity_at)
    FROM (
      SELECT cm.timestamp AS activity_at
      FROM conversation_messages cm
      WHERE cm.session_id = s.id
      UNION ALL
      SELECT ss.generated_at AS activity_at
      FROM session_summaries ss
      WHERE ss.session_id = s.id
      UNION ALL
      SELECT ss.updated_at AS activity_at
      FROM session_summaries ss
      WHERE ss.session_id = s.id
      UNION ALL
      SELECT COALESCE(cr.completed_at, cr.started_at) AS activity_at
      FROM command_runs cr
      WHERE cr.session_id = s.id
    )
    WHERE activity_at IS NOT NULL
  ) AS last_activity_at,
  (
    SELECT MAX(cm.timestamp)
    FROM conversation_messages cm
    WHERE cm.session_id = s.id
  ) AS last_message_at,
  (CAST(
    CASE
      WHEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id) IS NOT NULL
      THEN (SELECT MAX(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
         - (SELECT MIN(cm2.timestamp) FROM conversation_messages cm2 WHERE cm2.session_id = s.id)
      ELSE 0
    END AS INTEGER)
  ) AS active_time_ms`;

/**
 * Map token-usage columns from a DB row to a JS object.
 * @param {Object} row - database row
 * @returns {Object}
 */
export function mapTokenUsage(row) {
  return {
    inputTokens: row.input_tokens || 0,
    outputTokens: row.output_tokens || 0,
    thinkingTokens: row.thinking_tokens || 0,
    cacheReadInputTokens: row.cache_read_input_tokens || 0,
    cacheCreationInputTokens: row.cache_creation_input_tokens || 0,
    webSearchRequests: row.web_search_requests || 0,
    contextWindow: row.context_window || 200000,
  };
}

/**
 * Map scheduling columns from a DB row to a JS object.
 * @param {Object} row - database row
 * @returns {Object}
 */
export function mapScheduling(row) {
  return {
    scheduledAt: row.scheduled_at || null,
    rescheduleDelayMinutes: row.reschedule_delay_minutes || DEFAULT_RESCHEDULE_DELAY_MINUTES,
    autoRescheduleEnabled: Boolean(row.auto_reschedule_enabled),
    rescheduleOnTokenLimit: Boolean(row.reschedule_on_token_limit),
    rescheduleOnServiceError: Boolean(row.reschedule_on_service_error),
    maxRescheduleCount: row.max_reschedule_count,
    maxTotalTokens: row.max_total_tokens,
    rescheduleCount: row.reschedule_count || 0,
    rescheduleAtTokenCount: row.reschedule_at_token_count,
  };
}

/** Default values for session-create config fields */
const CONFIG_DEFAULTS = {
  mode: 'yolo',
  thinkingEnabled: true,
  gitBranch: null,
  parentSessionId: null,
  status: 'starting',
  model: null,
  providerId: null,
  effortLevel: null,
  // Agent runtime for the session: 'claude-code' (default) or 'codex'.
  // Defaults to null so SessionRepository.create() can resolve it from the model.
  // Explicit values from callers are preserved as-is.
  agentType: null,
};

function buildConfig(src) {
  return Object.fromEntries(
    Object.entries(CONFIG_DEFAULTS).map(([k, d]) => [k, src[k] ?? d])
  );
}

/**
 * Parse session-create options supporting both the modern object form
 * and the legacy positional-arguments form.
 * @param {Object|string} options
 * @param {Array} extraArgs - additional positional arguments (legacy)
 * @returns {Object} normalised config
 */
export function parseCreateConfig(options, extraArgs) {
  if (typeof options !== 'string') return buildConfig(options);

  const keys = ['mode', 'thinkingEnabled', 'gitBranch', 'parentSessionId', 'status', 'model'];
  const vals = { mode: options };
  keys.slice(1).forEach((k, i) => { vals[k] = extraArgs[i]; });
  vals.effortLevel = (extraArgs[5] || {}).effortLevel;
  return buildConfig(vals);
}

/** camelCase -> snake_case column mapping for direct (non-boolean) fields */
export const DIRECT_FIELD_MAP = {
  name: 'name',
  status: 'status',
  mode: 'mode',
  gitBranch: 'git_branch',
  gitWorktree: 'git_worktree',
  prUrl: 'pr_url',
  error: 'error',
  costUsd: 'cost_usd',
  claudeSessionId: 'claude_session_id',
  model: 'model',
  providerId: 'provider_id',
  nextTemplateId: 'next_template_id',
  parentSessionId: 'parent_session_id',
  scheduledAt: 'scheduled_at',
  rescheduleDelayMinutes: 'reschedule_delay_minutes',
  maxRescheduleCount: 'max_reschedule_count',
  maxTotalTokens: 'max_total_tokens',
  rescheduleCount: 'reschedule_count',
  rescheduleAtTokenCount: 'reschedule_at_token_count',
  pendingPrompt: 'pending_prompt',
  pendingModel: 'pending_model',
  effortLevel: 'effort_level',
  targetLaneId: 'target_lane_id',
  laneTriggerDepth: 'lane_trigger_depth',
  agentType: 'agent_type',
};

/** camelCase -> snake_case column mapping for boolean fields (converted to 1/0) */
export const BOOLEAN_FIELD_MAP = {
  thinkingEnabled: 'thinking_enabled',
  archived: 'archived',
  starred: 'starred',
  manuallyNamed: 'manually_named',
  prUrlAutoLinkDisabled: 'pr_url_auto_link_disabled',
  autoRescheduleEnabled: 'auto_reschedule_enabled',
  rescheduleOnTokenLimit: 'reschedule_on_token_limit',
  rescheduleOnServiceError: 'reschedule_on_service_error',
  autoSendPendingPrompt: 'auto_send_pending_prompt',
};

/**
 * Build SET clause entries and parameter values from update data.
 * @param {Object} data - camelCase update fields
 * @returns {{ updates: string[], values: any[] }}
 */
export function buildUpdateClauses(data) {
  const updates = [];
  const values = [];

  for (const [field, column] of Object.entries(DIRECT_FIELD_MAP)) {
    if (data[field] !== undefined) {
      updates.push(`${column} = ?`);
      values.push(data[field]);
    }
  }

  for (const [field, column] of Object.entries(BOOLEAN_FIELD_MAP)) {
    if (data[field] !== undefined) {
      updates.push(`${column} = ?`);
      values.push(data[field] ? 1 : 0);
    }
  }

  return { updates, values };
}
