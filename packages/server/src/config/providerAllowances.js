/**
 * Tuning for provider allowance collection and presentation.
 *
 * Allowance collection is always on: there is no feature flag or rollout
 * gate. Every acquisition source below runs for eligible providers without
 * opt-in, so a source must be validated against real payloads before it is
 * merged. `PROVIDER_ALLOWANCE_STREAM_STALE_MS` remains as a freshness
 * tuning knob only — it never disables collection.
 */

const PROVIDER_ALLOWANCE_STREAM_STALE_MS = 'PROVIDER_ALLOWANCE_STREAM_STALE_MS';

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

const MAX_ACCOUNT_REFRESH_MS = 60_000;
const MIN_ACCOUNT_REFRESH_MS = 1_000;

/**
 * Refresh cadence for independent account snapshots (Codex app-server
 * meter). Derived from the configured freshness window so a short window
 * can never flap stale between reads: half the window, capped at 60s, with
 * a 1s floor so a zero window cannot become a hot loop.
 */
export function getAccountRefreshMs() {
  return Math.max(
    MIN_ACCOUNT_REFRESH_MS,
    Math.min(MAX_ACCOUNT_REFRESH_MS, Math.floor(getStreamStaleAfterMs() / 2)),
  );
}
