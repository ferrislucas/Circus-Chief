import { computed } from 'vue';
import { formatDistanceToNow, format } from 'date-fns';
import { findNearestScheduledTime } from '../utils/scheduleInfo.js';

export function useScheduledCardInfo(board) {
  return computed(() => {
    const map = {};
    if (!board.value?.lanes) return map;
    for (const lane of board.value.lanes) for (const card of lane.cards || []) {
      const session = card.sessions?.[0];
      if (!session?.id) continue;
      const nearest = findNearestScheduledTime(session.id);
      if (nearest === null) {
        map[card.id] = { showBadge: false, timeDisplay: null, absoluteTime: null };
        continue;
      }
      const scheduledTime = new Date(nearest);
      map[card.id] = {
        showBadge: true,
        timeDisplay: formatDistanceToNow(scheduledTime, { addSuffix: true }),
        absoluteTime: format(scheduledTime, 'MMM d, h:mm a'),
      };
    }
    return map;
  });
}
