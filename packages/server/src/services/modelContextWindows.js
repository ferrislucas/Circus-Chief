/**
 * Known context windows for third-party models the agent SDK does not report
 * a window for.
 *
 * The Claude Agent SDK populates `modelUsage` entries with a `contextWindow`
 * for first-party models, but models served over Anthropic-compatible
 * endpoints (e.g. z.ai GLM models used as `ANTHROPIC_BASE_URL` overrides)
 * arrive without one, and the usage pipeline falls back to 200000. The
 * GLM-5.2 generation raised the window to 1M tokens, so the fallback
 * understates those models' headroom 5x in the usage indicators.
 * Unknown models resolve to undefined so callers keep their existing default.
 */

// GLM generations with a 1M-token window (model ids match case-insensitively;
// provider model ids use `GLM-5.3-Flash` casing, the API uses `glm-5.3-flash`).
const GLM_1M_PREFIXES = ['glm-5.3', 'glm-5.2'];

export const GLM_DEFAULT_CONTEXT_WINDOW = 200_000;
export const GLM_LARGE_CONTEXT_WINDOW = 1_048_576;

/**
 * Resolve a z.ai GLM model's context window from its model id.
 * @param {string|null|undefined} model
 * @returns {number|undefined} Window in tokens, or undefined for non-GLM input.
 */
export function resolveGlmContextWindow(model) {
  if (typeof model !== 'string' || model.length === 0) return undefined;
  const normalized = model.toLowerCase();
  if (!normalized.startsWith('glm')) return undefined;
  return GLM_1M_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ? GLM_LARGE_CONTEXT_WINDOW
    : GLM_DEFAULT_CONTEXT_WINDOW;
}

/**
 * Resolve the effective context window for a turn: a reported window wins,
 * then model knowledge, then the caller's fallback.
 */
export function resolveContextWindow({ model = null, reported = undefined, fallback = 200_000 } = {}) {
  if (Number.isFinite(reported) && reported > 0) return reported;
  return resolveGlmContextWindow(model) ?? fallback;
}
