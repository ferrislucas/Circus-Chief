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
    agentCallLogs.create({
      id: callId,
      sessionId: meta.sessionId,
      conversationId: meta.conversationId || null,
      agentType: meta.agentType || 'claude-code',
      model: meta.model || null,
      callType: meta.callType,
      promptLength: meta.promptLength || 0,
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
}

// Singleton
export const agentCallLogger = new AgentCallLogger();
