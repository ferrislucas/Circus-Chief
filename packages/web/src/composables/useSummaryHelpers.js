/**
 * Pure helper functions extracted from SummaryTab for formatting
 * and computing session duration/time.
 */

/**
 * Compute wall-clock work time for an active (running/starting) session.
 */
export function computeActiveSessionTime(session) {
  const start = session.createdAt;
  if (!start) return null;
  const end = session.lastActivityAt || session.updatedAt;
  return end ? end - start : Date.now() - start;
}

/**
 * Compute wall-clock work time for a completed/idle session.
 * Returns duration only if there's meaningful token usage or duration.
 */
export function computeIdleSessionTime(session, getBillableTokens) {
  const start = session.createdAt;
  if (!start) return null;
  const end = session.lastActivityAt || session.updatedAt;
  if (!end) return null;
  const duration = end - start;
  const hasTokenUsage = getBillableTokens(session.id) > 0;
  return (hasTokenUsage || duration >= 5000) ? duration : null;
}

/**
 * Format a duration in milliseconds to a human-readable string.
 * Returns null if the duration is not meaningful.
 */
export function formatDuration(ms) {
  if (!ms || ms < 0) return null;
  if (ms === 0) return null;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Format a timestamp into a relative time string (e.g. "5m ago", "2d ago").
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Format a PR state string to its display label.
 */
export function formatPrState(state) {
  const labels = {
    merged: 'Merged',
    open: 'Open',
    closed: 'Closed',
    draft: 'Draft',
  };
  return labels[state] || state;
}

/**
 * Extract the PR number from a GitHub PR URL.
 */
export function extractPrNumber(url) {
  if (!url) return 'PR';
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `PR #${match[1]}` : 'PR';
}
