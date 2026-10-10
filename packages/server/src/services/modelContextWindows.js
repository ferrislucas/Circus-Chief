/**
 * Known context windows for third-party models the agent SDK does not report
 * a window for.
 *
 * The Claude Agent SDK populates `modelUsage` entries with a `contextWindow`
 * for first-party models, but models served over Anthropic-compatible
 * endpoints (e.g. z.ai GLM models used as `ANTHROPIC_BASE_URL` overrides)
 * arrive without one, and the usage pipeline falls back to 200000.
 *
 * A 1M-token fallback applies only to GLM-5.2/5.3 models with explicit
 * long-context opt-in: z.ai enables 1M context in Claude Code solely for
 * `[1m]` model ids (e.g. `glm-5.3-flash[1m]`, configured via
 * `ANTHROPIC_DEFAULT_*_MODEL`). A bare `GLM-5.2`/`GLM-5.3` id runs without
 * long-context configuration, so it keeps the 200K default — reporting 1M
 * would display about five times the agent's configured headroom.
 * `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is a compaction trigger in tokens, not
 * model capacity, and is never consulted here.
 * Unknown models resolve to undefined so callers keep their existing default.
 */

// A GLM model id: `glm` followed by a separator or the end of the string,
// so lookalikes such as `glmfoo` are not recognized as GLM models.
const GLM_MODEL_PATTERN = /^glm(?![a-z0-9])/i;
// GLM generations with a 1M-token long-context variant. The boundary guard
// keeps longer version segments (e.g. `glm-5.20`) on the 200K default.
const GLM_1M_GENERATION_PATTERN = /^glm-5\.[23](?![\d.])/i;
// z.ai's long-context opt-in marker (e.g. `GLM-5.2[1m]`), case-insensitive.
const GLM_LONG_CONTEXT_OPT_IN_PATTERN = /\[1m\]/i;

export const GLM_DEFAULT_CONTEXT_WINDOW = 200_000;
export const GLM_LARGE_CONTEXT_WINDOW = 1_048_576;

/**
 * Resolve a z.ai GLM model's context window from its model id.
 * @param {string|null|undefined} model
 * @returns {number|undefined} Window in tokens, or undefined for non-GLM input.
 */
export function resolveGlmContextWindow(model) {
  if (typeof model !== 'string' || model.length === 0) return undefined;
  if (!GLM_MODEL_PATTERN.test(model)) return undefined;
  return GLM_1M_GENERATION_PATTERN.test(model) && GLM_LONG_CONTEXT_OPT_IN_PATTERN.test(model)
    ? GLM_LARGE_CONTEXT_WINDOW
    : GLM_DEFAULT_CONTEXT_WINDOW;
}

/**
 * Resolve the effective context window for a turn: a valid reported window
 * wins, then model knowledge, then the caller's fallback. Invalid reported
 * values (non-finite, zero, or negative) fall through to model knowledge.
 *
 * The runtime model id can lose the `[1m]` opt-in marker through SDK
 * normalization, so the session-configured id (which preserves what was
 * requested) is consulted as well before falling back.
 */
export function resolveContextWindow({ model = null, configuredModel = null, reported = undefined, fallback = 200_000 } = {}) {
  if (Number.isFinite(reported) && reported > 0) return reported;
  const runtimeWindow = resolveGlmContextWindow(model);
  if (runtimeWindow === GLM_LARGE_CONTEXT_WINDOW) return runtimeWindow;
  if (resolveGlmContextWindow(configuredModel) === GLM_LARGE_CONTEXT_WINDOW) return GLM_LARGE_CONTEXT_WINDOW;
  return runtimeWindow ?? resolveGlmContextWindow(configuredModel) ?? fallback;
}
