/**
 * Get the CSS color value for a given usage percentage.
 * - Below 60%: success (green)
 * - 60-79%: warning (amber)
 * - 80%+: error (red)
 *
 * @param {number} percent - Usage percentage (0-100)
 * @returns {string} CSS variable reference for the appropriate color
 */
export function getColorForPercent(percent) {
  if (percent >= 80) return 'var(--color-error)';
  if (percent >= 60) return 'var(--color-warning)';
  return 'var(--color-success)';
}
