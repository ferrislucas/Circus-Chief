import { format } from 'date-fns';

export function laneRunLabel(run) {
  if (run.status === 'failed') return 'automation failed';
  if (run.status === 'cancelled') return 'automation cancelled';
  if (run.status === 'succeeded') return 'automation completed';
  if (run.retryingCount) return 'automation retrying';
  if (run.scheduledCount) return 'automation scheduled';
  if (run.openCount > 1) return 'waiting for descendants';
  return 'automation running';
}

export function formatLaneRunTime(timestamp) {
  return format(new Date(timestamp), 'MMM d, h:mm a');
}
