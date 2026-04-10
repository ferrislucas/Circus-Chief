/**
 * Shared helpers for SessionRepository: SQL fragments, row mappers,
 * config parsing, and update-clause builders.
 */

/** Reusable SQL fragment for computed activity fields on sessions */
export const ACTIVITY_FIELDS_SQL = `
  (SELECT MAX(cm.timestamp) FROM conversation_messages cm WHERE cm.session_id = s.id) AS last_activity_at,
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
    rescheduleDelayMinutes: row.reschedule_delay_minutes || 15,
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
  mode: 'standard',
  thinkingEnabled: false,
  gitBranch: null,
  parentSessionId: null,
  status: 'starting',
  model: null,
  effortLevel: null,
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
};

/** camelCase -> snake_case column mapping for boolean fields (converted to 1/0) */
export const BOOLEAN_FIELD_MAP = {
  thinkingEnabled: 'thinking_enabled',
  archived: 'archived',
  starred: 'starred',
  manuallyNamed: 'manually_named',
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
