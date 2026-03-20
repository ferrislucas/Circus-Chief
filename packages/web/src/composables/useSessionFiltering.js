import { computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';

/**
 * Apply status filter to groups based on workflow-aggregated status.
 * @param {Array} groups - Session groups
 * @param {Object} sessionsStore - Sessions store
 * @returns {Array} Filtered groups
 */
function applyStatusFilter(groups, sessionsStore) {
  if (!sessionsStore.statusFilter) return groups;

  return groups.filter(group => {
    const workflowStatus = sessionsStore.getWorkflowAggregatedStatus(group.parent.id);
    const effectiveStatus = workflowStatus.effectiveStatus;

    if (sessionsStore.statusFilter === 'running' && effectiveStatus === 'running') {
      return true;
    }
    if (sessionsStore.statusFilter === 'idle' && effectiveStatus === 'idle') {
      return true;
    }
    return false;
  });
}

/**
 * Apply starred filter to groups.
 * @param {Array} groups - Session groups
 * @param {Object} sessionsStore - Sessions store
 * @returns {Array} Filtered groups
 */
function applyStarredFilter(groups, sessionsStore) {
  if (sessionsStore.starredFilter === 'starred') {
    return groups.filter(group => group.parent.starred);
  } else if (sessionsStore.starredFilter === 'unstarred') {
    return groups.filter(group => !group.parent.starred);
  }
  return groups;
}

/**
 * Apply scheduled filter to groups based on workflow-aggregated status.
 * @param {Array} groups - Session groups
 * @param {Object} sessionsStore - Sessions store
 * @returns {Array} Filtered groups
 */
function applyScheduledFilter(groups, sessionsStore) {
  if (!sessionsStore.scheduledFilter) return groups;

  return groups.filter(group => {
    const workflowStatus = sessionsStore.getWorkflowAggregatedStatus(group.parent.id);
    const hasScheduled = workflowStatus.scheduledCount > 0;

    if (sessionsStore.scheduledFilter === 'scheduled' && hasScheduled) {
      return true;
    }
    if (sessionsStore.scheduledFilter === 'not-scheduled' && !hasScheduled) {
      return true;
    }
    return false;
  });
}

/**
 * Composable for managing session filter toggle cycling and tooltip computation.
 *
 * Handles:
 * - Status filter toggling (running / idle)
 * - Star filter three-state cycling (null -> starred -> unstarred -> null)
 * - Scheduled filter three-state cycling (null -> scheduled -> not-scheduled -> null)
 * - Tooltip text computation for star and scheduled filters
 * - Filtered grouped sessions computation with status, starred, and scheduled filters
 *
 * @returns {Object} Filter management utilities
 */
export function useSessionFiltering() {
  const sessionsStore = useSessionsStore();

  function toggleFilter(status) {
    if (sessionsStore.statusFilter === status) {
      sessionsStore.setStatusFilter(null);
    } else {
      sessionsStore.setStatusFilter(status);
    }
  }

  function toggleStarredFilter(filter) {
    if (sessionsStore.starredFilter === filter) {
      sessionsStore.setStarredFilter(null);
    } else {
      sessionsStore.setStarredFilter(filter);
    }
  }

  function toggleStarFilterIcon() {
    if (sessionsStore.starredFilter === null) {
      sessionsStore.setStarredFilter('starred');
    } else if (sessionsStore.starredFilter === 'starred') {
      sessionsStore.setStarredFilter('unstarred');
    } else {
      sessionsStore.setStarredFilter(null);
    }
  }

  const starFilterTooltip = computed(() => {
    if (sessionsStore.starredFilter === 'starred') {
      return 'Showing starred sessions only. Click to filter unstarred.';
    } else if (sessionsStore.starredFilter === 'unstarred') {
      return 'Showing unstarred sessions only. Click to show all.';
    } else {
      return 'Showing all sessions. Click to filter by starred.';
    }
  });

  function toggleScheduledFilterIcon() {
    if (sessionsStore.scheduledFilter === null) {
      sessionsStore.setScheduledFilter('scheduled');
    } else if (sessionsStore.scheduledFilter === 'scheduled') {
      sessionsStore.setScheduledFilter('not-scheduled');
    } else {
      sessionsStore.setScheduledFilter(null);
    }
  }

  const scheduledFilterTooltip = computed(() => {
    if (sessionsStore.scheduledFilter === 'scheduled') {
      return 'Showing workflows with scheduled sessions. Click to filter non-scheduled.';
    } else if (sessionsStore.scheduledFilter === 'not-scheduled') {
      return 'Showing workflows without scheduled sessions. Click to show all.';
    } else {
      return 'Showing all workflows. Click to filter by scheduled.';
    }
  });

  const filteredGroupedSessions = computed(() => {
    let groups = sessionsStore.groupedSessions;
    groups = applyStatusFilter(groups, sessionsStore);
    groups = applyStarredFilter(groups, sessionsStore);
    groups = applyScheduledFilter(groups, sessionsStore);
    return groups;
  });

  return {
    toggleFilter,
    toggleStarredFilter,
    toggleStarFilterIcon,
    starFilterTooltip,
    toggleScheduledFilterIcon,
    scheduledFilterTooltip,
    filteredGroupedSessions,
  };
}
