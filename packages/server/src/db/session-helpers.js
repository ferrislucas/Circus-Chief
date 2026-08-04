/**
 * Shared helpers for SessionRepository: SQL fragments, row mappers,
 * config parsing, and update-clause builders.
 */

import { DEFAULT_RESCHEDULE_DELAY_MINUTES, isTierRef, parseTierRef } from '@circuschief/shared';
// Imported only to resolve agent type from a model at call time (runtime), so the
// ES-module cycle (index → SessionRepository → session-helpers → index) is safe.
import { modelProviders, modelTiers } from './index.js';

/** Fallback agent runtime when none can be derived from the model/provider. */
export const DEFAULT_AGENT_TYPE = 'claude-code';

/**
 * Find the first enabled tier member (by position) for a tier id — a minimal,
 * cooldown-unaware lookup used only to derive an initial `agentType` at
 * session-create time (Work Item 2). Deliberately duplicates a slice of
 * `tierResolutionService.getTierMembersResolved` rather than importing that
 * module: `services/tierResolutionService.js` imports `../database.js`,
 * which would re-introduce the exact
 * `index → SessionRepository → session-helpers → index` cycle this file was
 * already structured to avoid (see the module-level comment above). The
 * authoritative, cooldown-aware resolution still happens at actual session
 * start via `reconcileAgentTypeForRun` / the tier-failover loop — this is
 * defense-in-depth so a freshly-created session's persisted `agentType`
 * isn't wrong in the window before that.
 * @param {string} tierId
 * @returns {{ providerId: string, modelId: string }|null}
 */
function findFirstEnabledTierMember(tierId) {
  const tier = modelTiers.getByIdWithMembers?.(tierId);
  if (!tier) return null;
  const enabled = (tier.members || []).filter((m) => {
    const provider = modelProviders.getById(m.providerId);
    if (!provider || provider.enabled === false) return false;
    return provider.models?.some((model) => model.modelId === m.modelId);
  });
  if (enabled.length === 0) return null;
  enabled.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
  return enabled[0];
}

/**
 * Resolve the INITIAL agent type ('claude-code', 'codex', or 'gemini') for a
 * newly-created session from its model field, by looking up which provider
 * owns the model. Inlined here (rather than in sessionProvider) to avoid a
 * circular dependency: database.js (index) → SessionRepository →
 * session-helpers → database.js.
 *
 * Name note (Work Item 4 / nit): `services/sessionProvider.js` exports a
 * DIFFERENT, provider-aware `resolveAgentTypeFromModel(modelId, providerId)`
 * used everywhere agent type is re-derived at run time (failover logger,
 * agent guard, draft/session provider paths) — that one disambiguates tier
 * members that share a `modelId` across different providers. This variant is
 * narrower and cooldown-unaware: it is a create-time-only, first-enabled-member
 * lookup used solely to seed a freshly-created session's persisted `agentType`
 * column (see `SessionRepository.create`). Always prefer
 * `sessionProvider.resolveAgentTypeFromModel` outside of session creation.
 *
 * Tier-aware (Work Item 2): `modelId` may be a `tier::<id>` reference. It is
 * resolved to its first enabled member before the provider lookup, so a
 * Codex/Gemini-first tier correctly derives that kind at session-create time
 * instead of silently defaulting to 'claude-code'.
 * @param {string|null} modelId
 * @returns {'claude-code'|'codex'|'gemini'}
 */
export function resolveInitialAgentTypeFromModel(modelId) {
  if (!modelId) return DEFAULT_AGENT_TYPE;

  if (isTierRef(modelId)) {
    const tierId = parseTierRef(modelId);
    const member = tierId ? findFirstEnabledTierMember(tierId) : null;
    if (!member) return DEFAULT_AGENT_TYPE;
    const agentType = modelProviders.getAgentTypeForProvider(member.providerId);
    return agentType || DEFAULT_AGENT_TYPE;
  }

  const provider = modelProviders.getProviderByModelId(modelId);
  if (!provider) return DEFAULT_AGENT_TYPE;
  // ProviderRepository.getAgentTypeForProvider maps kind → agent adapter
  const agentType = modelProviders.getAgentTypeForProvider(provider.id);
  return agentType || DEFAULT_AGENT_TYPE;
}

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
    pendingConversationId: row.pending_conversation_id || null,
  };
}

/** Map inert-by-default structured workflow fields. */
export function mapWorkflow(row) {
  return { laneRunId: row.lane_run_id || null, ownWorkState: row.own_work_state || 'open', ownWorkClosedAt: row.own_work_closed_at || null,
    workflowUpdatedAt: row.workflow_updated_at || null, workflowReason: row.workflow_reason || null,
    // FR-5: independent lifecycle dimensions (see kanban-add-lane-run-execution-state).
    executionState: row.execution_state || 'idle', subtreeOutcome: row.subtree_outcome || 'open' };
}

/**
 * Resolve the lane run a new child session inherits from its parent.
 *
 * A child always preserves its requested parent, but only inherits workflow
 * membership while both the parent's own work and its lane run remain open.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string|null} parentSessionId
 * @returns {string|null} the inherited lane_run_id, or null when detached
 */
export function resolveInheritedLaneRunId(db, parentSessionId) {
  if (!parentSessionId) return null;
  const parent = db.prepare('SELECT lane_run_id, own_work_state FROM sessions WHERE id = ?').get(parentSessionId);
  if (!parent?.lane_run_id) return null;
  const runStatus = db.prepare('SELECT status FROM kanban_lane_runs WHERE id = ?').get(parent.lane_run_id)?.status;
  return parent.own_work_state === 'open' && runStatus === 'open' ? parent.lane_run_id : null;
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
  // parentSessionId is intentionally NOT mapped here: parentage is set once at
  // create() time (see the direct INSERT in SessionRepository.create()) and is
  // immutable thereafter. A DB-level trigger (see sessionTableRecreate.js)
  // enforces this even against direct SQL, so no application-layer path should
  // attempt to reparent an existing session via update().
  scheduledAt: 'scheduled_at',
  rescheduleDelayMinutes: 'reschedule_delay_minutes',
  maxRescheduleCount: 'max_reschedule_count',
  maxTotalTokens: 'max_total_tokens',
  rescheduleCount: 'reschedule_count',
  rescheduleAtTokenCount: 'reschedule_at_token_count',
  pendingPrompt: 'pending_prompt',
  pendingModel: 'pending_model',
  pendingConversationId: 'pending_conversation_id',
  effortLevel: 'effort_level',
  laneTriggerDepth: 'lane_trigger_depth',
  laneRunId: 'lane_run_id',
  ownWorkState: 'own_work_state',
  ownWorkClosedAt: 'own_work_closed_at',
  workflowUpdatedAt: 'workflow_updated_at',
  workflowReason: 'workflow_reason',
  executionState: 'execution_state',
  subtreeOutcome: 'subtree_outcome',
  agentType: 'agent_type',
  resolvedModel: 'resolved_model',
  resolvedProviderId: 'resolved_provider_id',
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
