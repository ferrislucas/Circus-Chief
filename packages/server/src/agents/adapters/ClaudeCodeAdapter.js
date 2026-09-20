import { query } from '@anthropic-ai/claude-agent-sdk';
import { BaseAgent } from '../BaseAgent.js';
import { mapClaudeRateLimitEvent } from './claudeRateLimitEventMapper.js';
import { isClaudeAllowanceSourceEnabled, getStreamStaleAfterMs } from '../../config/providerAllowances.js';

/**
 * Adapter for Claude Code SDK. Wraps the SDK's `query()` function
 * which returns an async generator of events.
 *
 * The adapter does NOT transform events -- it passes through raw SDK events.
 * Event handling remains in sessionManager's handleStreamEvent().
 *
 * One exception: `rate_limit_event` messages are subscription-plan telemetry
 * for the provider allowance indicators. They are diverted to the allowance
 * observer and never forwarded to the conversation UI.
 */
export class ClaudeCodeAdapter extends BaseAgent {
  static capabilities = Object.freeze({
    streaming: true,
    thinking: true,
    reasoningEffort: true,
    toolUse: true,
    resume: true,
  });

  /**
   * @param {Object} [opts]
   * @param {Function} [opts.allowanceObserver] - Allowance candidate consumer
   *   (bound ProviderAllowanceService.observe). Null unless the rollout gate
   *   is enabled.
   * @param {Object} [opts.clock] - Clock DI ({ now }).
   * @param {Object} [opts.rest] - Passed to {@link BaseAgent}.
   */
  constructor({ allowanceObserver = null, clock = Date, ...rest } = {}) {
    super(rest);
    this._allowance = { allowanceObserver, clock };
    // An adapter instance is scoped to one session execution, so instance
    // state is the per-session window merge: `observe()` replaces per-provider
    // state, so every observation re-emits the full merged window set.
    this._observedWindows = new Map();
  }

  /**
   * Execute a query against the Claude Code SDK.
   * @param {import('../types.js').AgentQueryParams} queryParams - { prompt, options? }
   * @yields {Object} Raw SDK events (system, assistant, tool_result, stream_event, result)
   */
  async *execute(queryParams, _meta) {
    const allowanceEnabled = isClaudeAllowanceSourceEnabled();
    this._observedWindows.clear();

    for await (const message of query(queryParams)) {
      if (message?.type === 'rate_limit_event') {
        if (allowanceEnabled) this.#observeRateLimit(message.rate_limit_info, queryParams);
        continue; // never forwarded to the conversation UI
      }
      yield message;
    }
  }

  #observeRateLimit(info, queryParams) {
    const observer = this._allowance.allowanceObserver;
    const providerId = queryParams?.options?.providerId;
    if (!observer || !providerId) return;
    try {
      const candidate = mapClaudeRateLimitEvent(info, {
        observedAt: this._allowance.clock.now(),
        streamStaleMs: getStreamStaleAfterMs(),
      });
      if (!candidate) return;
      const merged = this.#mergeWindows(candidate.allowances, this._allowance.clock.now());
      if (merged.length > 0) observer({ ...candidate, allowances: merged, providerId });
    } catch {
      // Allowance telemetry is non-critical; a broken observation must never
      // disrupt the conversation stream (FR-7).
    }
  }

  /**
   * Merge the incoming event's window rows with the windows already seen in
   * this execution: same-key rows are replaced, rows whose reset time has
   * passed are dropped. Windows not present in the current event keep their
   * last value; snapshot staleness handles expiry of aging windows.
   */
  #mergeWindows(allowances, now) {
    for (const allowance of allowances) this._observedWindows.set(allowance.key, allowance);
    for (const [key, allowance] of this._observedWindows) {
      if (allowance.resetsAt !== null && allowance.resetsAt <= now) this._observedWindows.delete(key);
    }
    return [...this._observedWindows.values()];
  }

  supportsResume() {
    return true;
  }

  getCapabilities() {
    return { ...ClaudeCodeAdapter.capabilities };
  }
}
