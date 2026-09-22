/**
 * Rollout gates for provider allowance collection and presentation.
 *
 * The master gate (`PROVIDER_ALLOWANCES_ENABLED`) controls the feature as a
 * whole. Each acquisition source additionally ships behind its own sub-flag
 * so sources can be validated against real payloads and enabled one at a
 * time. Only the literal `1` is an opt-in. This keeps a typo from silently
 * exposing an unvalidated provider integration. Sub-flags are read only when
 * the master gate is on.
 */

// Keep this exported inventory in sync with every environment variable read
// below. Documentation tests use it as their single source of truth.
export const PROVIDER_ALLOWANCE_FLAGS = Object.freeze([
  'PROVIDER_ALLOWANCES_ENABLED',
  'PROVIDER_ALLOWANCES_CLAUDE',
  'PROVIDER_ALLOWANCES_CODEX',
  'PROVIDER_ALLOWANCES_CODEX_APPSERVER',
  'PROVIDER_ALLOWANCES_ZAI',
  'PROVIDER_ALLOWANCE_STREAM_STALE_MS',
]);

const [
  PROVIDER_ALLOWANCES_ENABLED,
  PROVIDER_ALLOWANCES_CLAUDE,
  PROVIDER_ALLOWANCES_CODEX,
  PROVIDER_ALLOWANCES_CODEX_APPSERVER,
  PROVIDER_ALLOWANCES_ZAI,
  PROVIDER_ALLOWANCE_STREAM_STALE_MS,
] = PROVIDER_ALLOWANCE_FLAGS;

export function isProviderAllowancesEnabled() {
  return process.env[PROVIDER_ALLOWANCES_ENABLED] === '1';
}

function isSourceEnabled(flag) {
  return isProviderAllowancesEnabled() && process.env[flag] === '1';
}

/** Claude subscription windows via in-stream SDK `rate_limit_event`s. */
export function isClaudeAllowanceSourceEnabled() {
  return isSourceEnabled(PROVIDER_ALLOWANCES_CLAUDE);
}

/** Codex ChatGPT-plan windows via rollout-file tailing. */
export function isCodexAllowanceSourceEnabled() {
  return isSourceEnabled(PROVIDER_ALLOWANCES_CODEX);
}

/** Codex ChatGPT-plan windows via the `codex app-server` JSON-RPC meter. */
export function isCodexAppServerAllowanceSourceEnabled() {
  return isSourceEnabled(PROVIDER_ALLOWANCES_CODEX_APPSERVER);
}

/** z.ai GLM Coding Plan windows via the provider quota endpoint poller. */
export function isZaiAllowanceSourceEnabled() {
  return isSourceEnabled(PROVIDER_ALLOWANCES_ZAI);
}

const DEFAULT_STREAM_STALE_MS = 15 * 60_000;

/**
 * Freshness window for in-stream subscription sources (Claude rate-limit
 * events, Codex rollout tails). Events arrive at least every turn while a
 * session runs, so silence beyond this window means the data has aged.
 */
export function getStreamStaleAfterMs() {
  const parsed = Number(process.env[PROVIDER_ALLOWANCE_STREAM_STALE_MS]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STREAM_STALE_MS;
}
