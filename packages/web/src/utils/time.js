/**
 * Time formatting utilities for displaying run timestamps.
 *
 * All functions accept an epoch millisecond value and return `"—"` if the
 * input is null, undefined, or NaN.
 *
 * These helpers lean on the browser's `Intl.*` APIs so no new dependency
 * (e.g. `dayjs`, `date-fns`) is required.
 */

// Exported so consumers (CommandButtonsPanel, etc.) don't redeclare their own.
export const EM_DASH = '\u2014'; // "—"

// Pinned locale for absolute-clock formatting. `'en-GB'` gives colon-separated
// 24-hour output (`14:32:05` / `1 Jan 2026, 14:32:05`) deterministically
// across runtimes and CI locales — critical for the E2E timestamp regexes
// that match on `\d{1,2}:\d{2}(:\d{2})?`.
const ABSOLUTE_LOCALE = 'en-GB';

function isInvalid(ms) {
  return ms === null || ms === undefined || Number.isNaN(ms);
}

/**
 * Format an epoch timestamp as a 24-hour wall-clock time.
 *
 * Pinned to the `en-GB` locale so colon-separated digits render
 * identically across CI environments.
 *
 * @param {number|null|undefined} ms - Epoch milliseconds.
 * @returns {string} e.g. `"14:32:05"` or `"—"` when input is missing.
 */
export function formatTime(ms) {
  if (isInvalid(ms)) return EM_DASH;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat(ABSOLUTE_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Format an epoch timestamp as an absolute date-time string for
 * tooltips and `aria-label`s.
 *
 * Pinned to the `en-GB` locale for the same CI-determinism reasons as
 * `formatTime`.
 *
 * @param {number|null|undefined} ms - Epoch milliseconds.
 * @returns {string} e.g. `"1 Jan 2026, 14:32:05"` or `"—"` when missing.
 */
export function formatDateTime(ms) {
  if (isInvalid(ms)) return EM_DASH;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat(ABSOLUTE_LOCALE, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Format a timestamp as a relative phrase such as `"2 minutes ago"`.
 *
 * Returns `"just now"` for very small deltas (<5 s absolute) so the phrase
 * doesn't flicker between `"in 0 seconds"` / `"0 seconds ago"`.
 *
 * Uses symmetric rounding (`sign * Math.round(absMs / unitMs)`) to avoid
 * JS's built-in half-boundary asymmetry (`Math.round(-1.5) === -1` while
 * `Math.round(1.5) === 2`) which otherwise causes past deltas to
 * under-report magnitude at the half boundary.
 *
 * @param {number|null|undefined} ms - Epoch milliseconds.
 * @param {number} [nowMs] - Current time (injectable for tests).
 * @returns {string} e.g. `"just now"`, `"45 seconds ago"`, `"in 3 seconds"` or `"—"`.
 */
export function formatRelative(ms, nowMs = Date.now()) {
  if (isInvalid(ms)) return EM_DASH;

  const deltaMs = ms - nowMs;
  const absMs = Math.abs(deltaMs);
  const sign = deltaMs < 0 ? -1 : 1;

  // Very small deltas collapse to "just now" regardless of direction.
  if (absMs < 5000) return 'just now';

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  const units = [
    { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: 'day', ms: 24 * 60 * 60 * 1000 },
    { unit: 'hour', ms: 60 * 60 * 1000 },
    { unit: 'minute', ms: 60 * 1000 },
    { unit: 'second', ms: 1000 },
  ];

  for (const { unit, ms: unitMs } of units) {
    if (absMs >= unitMs) {
      // Symmetric rounding: work on the magnitude then re-apply sign.
      const value = sign * Math.round(absMs / unitMs);
      return rtf.format(value, unit);
    }
  }
  // Fallback (shouldn't occur given the <5s guard above)
  return rtf.format(sign * Math.round(absMs / 1000), 'second');
}

/**
 * Format a duration between two epoch timestamps as a compact string.
 *
 *  - `< 1s`  → `"0.4s"` (tenths of a second)
 *  - `< 60s` → `"42s"`
 *  - `< 60m` → `"2m 14s"`
 *  - `< 24h` → `"1h 5m"`
 *  - ≥ 24h  → `"1d 2h"`
 *
 * If `endMs` is null/undefined the current wall-clock is substituted, which
 * is how `RunTimestamps` displays live elapsed time for a running command.
 *
 * @param {number|null|undefined} startMs - Start epoch milliseconds.
 * @param {number|null|undefined} [endMs] - End epoch milliseconds; defaults to `Date.now()`.
 * @returns {string} Formatted duration or `"—"` when `startMs` is missing.
 */
export function formatDuration(startMs, endMs) {
  if (isInvalid(startMs)) return EM_DASH;
  const end = isInvalid(endMs) ? Date.now() : endMs;
  let deltaMs = end - startMs;
  if (deltaMs < 0) deltaMs = 0;

  if (deltaMs < 1000) {
    // Tenths of a second for very short runs
    const tenths = Math.round(deltaMs / 100) / 10;
    return `${tenths}s`;
  }

  const totalSeconds = Math.floor(deltaMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${seconds}s`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalHours < 24) {
    return `${totalHours}h ${minutes}m`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `${totalDays}d ${hours}h`;
}

/**
 * Format the elapsed time of a running command for the small counter
 * shown beside `Running…` in `RunTimestamps` and the footer
 * `.running-indicator` of `CommandButtonItem`.
 *
 *  - `< 1h`  → `"M:SS"`  (e.g. `"0:12"`, `"12:34"`)
 *  - `≥ 1h` → `"H:MM:SS"` (e.g. `"1:00:00"`, `"10:23:45"`)
 *
 * @param {number|null|undefined} startMs - Start epoch milliseconds.
 * @param {number} [nowMs] - Current time (injectable for tests).
 * @returns {string} Compact elapsed counter; `"0:00"` when `startMs` is missing.
 */
export function formatElapsedMMSS(startMs, nowMs = Date.now()) {
  if (isInvalid(startMs)) return '0:00';
  let deltaMs = nowMs - startMs;
  if (deltaMs < 0) deltaMs = 0;
  const totalSeconds = Math.floor(deltaMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${totalMinutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Convert an epoch timestamp to an ISO-8601 string, suitable for a
 * `<time datetime="…">` attribute.
 *
 * @param {number|null|undefined} ms - Epoch milliseconds.
 * @returns {string|undefined} ISO string, or `undefined` when input is missing/invalid.
 */
export function toIso(ms) {
  if (isInvalid(ms)) return undefined;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/**
 * Tooltip combiner: `"<absolute> (<relative>)"` — used for both mouse
 * `title` and keyboard / screen-reader `aria-label`.
 *
 * The optional `nowMs` parameter is forwarded to `formatRelative` so
 * consumers that own a ticking clock (e.g. `RunTimestamps` while a run
 * is live) can pass a reactive timestamp; that read is what registers
 * Vue's dependency tracking and makes the resulting binding refresh
 * while the interval ticks.
 *
 * @param {number|null|undefined} ms - Epoch milliseconds.
 * @param {number} [nowMs] - Current time for the relative half.
 * @returns {string} Tooltip string, or `""` when input is missing/invalid.
 */
export function absoluteTooltip(ms, nowMs) {
  if (isInvalid(ms)) return '';
  return `${formatDateTime(ms)} (${formatRelative(ms, nowMs)})`;
}
