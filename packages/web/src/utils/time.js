/**
 * Time formatting utilities for displaying run timestamps.
 *
 * All functions accept an epoch millisecond value and return `"—"` if the
 * input is null, undefined, or NaN.
 *
 * These helpers lean on the browser's `Intl.*` APIs so no new dependency
 * (e.g. `dayjs`, `date-fns`) is required.
 */

const EM_DASH = '\u2014'; // "—"

function isInvalid(ms) {
  return ms === null || ms === undefined || Number.isNaN(ms);
}

/**
 * Format an epoch timestamp as a local 24-hour wall-clock time.
 *
 * @param {number|null|undefined} ms - Epoch milliseconds.
 * @returns {string} e.g. `"14:32:05"` or `"—"` when input is missing.
 */
export function formatTime(ms) {
  if (isInvalid(ms)) return EM_DASH;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * Format an epoch timestamp as a localized absolute date-time string for
 * tooltips and `aria-label`s.
 *
 * @param {number|null|undefined} ms - Epoch milliseconds.
 * @returns {string} e.g. `"Nov 14, 2026 14:32:05"` or `"—"` when missing.
 */
export function formatDateTime(ms) {
  if (isInvalid(ms)) return EM_DASH;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return new Intl.DateTimeFormat(undefined, {
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
 * @param {number|null|undefined} ms - Epoch milliseconds.
 * @param {number} [nowMs] - Current time (injectable for tests).
 * @returns {string} e.g. `"just now"`, `"45 seconds ago"`, `"in 3 seconds"` or `"—"`.
 */
export function formatRelative(ms, nowMs = Date.now()) {
  if (isInvalid(ms)) return EM_DASH;

  const deltaMs = ms - nowMs;
  const absMs = Math.abs(deltaMs);

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
      const value = Math.round(deltaMs / unitMs);
      return rtf.format(value, unit);
    }
  }
  // Fallback (shouldn't occur given the <5s guard above)
  return rtf.format(Math.round(deltaMs / 1000), 'second');
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
 * Format the elapsed time of a running command as `M:SS` (for the small
 * counter shown beside `Running…` in `RunTimestamps` and the footer
 * `.running-indicator` of `CommandButtonItem`).
 *
 * @param {number|null|undefined} startMs - Start epoch milliseconds.
 * @param {number} [nowMs] - Current time (injectable for tests).
 * @returns {string} e.g. `"0:12"`, `"12:34"`; `"0:00"` when `startMs` is missing.
 */
export function formatElapsedMMSS(startMs, nowMs = Date.now()) {
  if (isInvalid(startMs)) return '0:00';
  let deltaMs = nowMs - startMs;
  if (deltaMs < 0) deltaMs = 0;
  const seconds = Math.floor(deltaMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
