const cumulativeTotals = new Map();

/**
 * Turn usage for Circus Chief's additive session counters.
 *
 * A breakdown (`inputTokens` / `outputTokens`) is this turn. A lone
 * `_meta.totalTokens` is a running snapshot: the first sighting is a
 * baseline and is not added, and later sights contribute only the increase.
 * Summing the raw snapshot inflates the session total.
 *
 * @param {Object} result - session/prompt result
 * @param {string|null} sessionKey - native Grok session id
 * @returns {{ input_tokens: number, output_tokens: number, cache_read_input_tokens?: number, thinking_tokens?: number }}
 */
export function usageFromGrokPrompt(result, sessionKey) {
  const meta = result?._meta && typeof result._meta === 'object' ? result._meta : {};
  const turn = perTurnUsage(meta);
  const total = finite(meta.totalTokens ?? meta.total_tokens);
  if (turn) {
    if (total !== null && sessionKey) cumulativeTotals.set(sessionKey, total);
    return turn;
  }
  if (total === null || !sessionKey) return { input_tokens: 0, output_tokens: 0 };
  const previous = cumulativeTotals.get(sessionKey);
  cumulativeTotals.set(sessionKey, total);
  if (previous === undefined) return { input_tokens: 0, output_tokens: 0 };
  return { input_tokens: Math.max(0, total - previous), output_tokens: 0 };
}

export function _resetGrokUsageTotalsForTests() {
  cumulativeTotals.clear();
}

function perTurnUsage(meta) {
  const input = finite(meta.inputTokens ?? meta.input_tokens);
  const output = finite(meta.outputTokens ?? meta.output_tokens);
  if (input === null && output === null) return null;
  const usage = {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
  };
  const cache = finite(meta.cachedReadTokens ?? meta.cached_read_tokens ?? meta.cache_read_input_tokens);
  const reasoning = finite(meta.reasoningTokens ?? meta.thinking_tokens);
  if (cache !== null) usage.cache_read_input_tokens = cache;
  if (reasoning !== null) usage.thinking_tokens = reasoning;
  return usage;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
