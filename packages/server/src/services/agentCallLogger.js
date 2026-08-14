import { nanoid } from 'nanoid';
import { agentCallLogs } from '../database.js';

/**
 * Service for logging agent calls with in-memory tracking for active calls.
 * Uses AgentCallLogRepository for persistence.
 */
export class AgentCallLogger {
  constructor() {
    /** @type {Map<string, Object>} Active (in-flight) calls */
    this.activeCalls = new Map();
  }

  /**
   * Start logging a new agent call.
   * @param {import('../agents/types.js').AgentCallMeta} meta
   * @returns {string} callId
   */
  startCall(meta) {
    const callId = nanoid();

    // Build metadata object - only include keys with defined values
    const metadata = { ...(meta.metadata || {}) };
    if (meta.effortLevel !== undefined && meta.effortLevel !== null) {
      metadata.effortLevel = meta.effortLevel;
    }
    if (meta.thinkingEnabled !== undefined && meta.thinkingEnabled !== null) {
      metadata.thinkingEnabled = meta.thinkingEnabled;
    }

    agentCallLogs.create({
      id: callId,
      sessionId: meta.sessionId,
      conversationId: meta.conversationId || null,
      agentType: meta.agentType || 'claude-code',
      model: meta.model || null,
      callType: meta.callType,
      promptLength: meta.promptLength || 0,
      metadata, // Pass the metadata object (may be empty {})
    });
    this.activeCalls.set(callId, { id: callId, ...meta });
    return callId;
  }

  /**
   * Update token counts during streaming (called from handleStreamEvent on result events)
   */
  updateUsage(callId, usage) {
    if (!this.activeCalls.has(callId)) return;
    agentCallLogs.updateUsage(callId, {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      thinkingTokens: usage.thinkingTokens,
      cacheReadTokens: usage.cacheReadInputTokens,
      cacheWriteTokens: usage.cacheCreationInputTokens,
    });
  }

  /**
   * Mark call as completed or errored.
   */
  completeCall(callId, { success, usage, error }) {
    agentCallLogs.complete(callId, {
      success,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      cacheReadTokens: usage?.cacheReadInputTokens,
      cacheWriteTokens: usage?.cacheCreationInputTokens,
      errorMessage: error?.message,
    });
    this.activeCalls.delete(callId);
  }

  /**
   * Get session stats (delegates to repository)
   */
  getSessionStats(sessionId) {
    return agentCallLogs.getSessionStats(sessionId);
  }

  /**
   * Get global stats (delegates to repository)
   */
  getGlobalStats(startDate, endDate) {
    return agentCallLogs.getGlobalStats(startDate, endDate);
  }

  /**
   * Get all call logs with optional filtering, sorting, and pagination.
   * @param {Object} filters - Filter/sort/pagination options
   * @returns {{ rows: Array, total: number }}
   */
  getAll(filters) {
    return agentCallLogs.getAll(filters);
  }

  /**
   * Get distinct filter option values.
   * @returns {{ agentTypes: string[], callTypes: string[], statuses: string[], models: string[] }}
   */
  getFilterOptions() {
    return agentCallLogs.getFilterOptions();
  }

  /**
   * Log a tier failover event as a completed agent-call entry (Fix 4 / F26).
   * Creates a single-row "tierFailover" call-type log entry that appears in
   * Settings → Logs alongside regular agent calls.
   *
   * The entry is logged with `success: true` (status `'completed'`) because a
   * failover that successfully advances to the next member is not a call
   * failure — it's a benign system event. `errorMessage` still carries the
   * triggering reason for context. Stats are grouped by `call_type`, so the
   * `tierFailover` bucket stays segregated from real runSession cost/failure
   * rollups regardless of this flag (Issue 4).
   *
   * @param {string} sessionId
   * @param {{ fromModel, fromProviderId, toModel, toProviderId, tierRef, tierName, reason, agentType }} opts
   *   `agentType` should reflect the *source* (failing) member's agent type —
   *   callers must pass it explicitly; it is not assumed to be 'claude-code'.
   */
  _logFailoverEvent(sessionId, { fromModel, fromProviderId, toModel, toProviderId, tierRef, tierName, reason, agentType }) {
    const callId = nanoid();
    const metadata = {
      fromModel: fromModel || null,
      fromProviderId: fromProviderId || null,
      toModel: toModel || null,
      toProviderId: toProviderId || null,
      tierRef: tierRef || null,
      tierName: tierName || null,
      reason: reason || null,
    };

    agentCallLogs.create({
      id: callId,
      sessionId,
      conversationId: null,
      agentType: agentType || 'claude-code',
      model: fromModel || null,
      callType: 'tierFailover',
      promptLength: 0,
      metadata,
    });

    // Immediately complete the log entry as a neutral system event (no streaming).
    // success: true → status 'completed' — a failover that advances is not a failure.
    agentCallLogs.complete(callId, {
      success: true,
      errorMessage: reason || 'Tier failover',
    });
  }

  /**
   * Delete all logs from both the database and the in-memory active calls map.
   * @returns {number} Number of deleted rows
   */
  deleteAllLogs() {
    this.activeCalls.clear();
    return agentCallLogs.deleteAll();
  }
}

// Singleton
export const agentCallLogger = new AgentCallLogger();
