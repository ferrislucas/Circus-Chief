import { format } from 'date-fns';

export function laneRunLabel(run) {
  if (run.status === 'failed') return 'automation failed';
  if (run.status === 'cancelled') return 'automation cancelled';
  if (run.status === 'succeeded') return 'automation completed';
  if (run.retryingCount) return 'automation retrying';
  if (run.scheduledCount) return 'automation scheduled';
  // A run exposes the root's own-work state so a single open child is not
  // mistaken for the root itself still running.
  if (run.rootOwnWorkState === 'closed_successfully' && run.openCount) return 'waiting for descendants';
  return 'automation running';
}

export function isPausedLaneRun(run) {
  return run?.status === 'open'
    && ['user_stop_pause', 'provider_limit_pause'].includes(run.blockerKind);
}

export function formatLaneRunTime(timestamp) {
  return format(new Date(timestamp), 'MMM d, h:mm a');
}
