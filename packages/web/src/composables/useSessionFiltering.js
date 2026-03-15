import { computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';

/**
 * Composable for managing session filter toggle cycling and tooltip computation.
 *
 * Handles:
 * - Status filter toggling (running / idle)
 * - Star filter three-state cycling (null → starred → unstarred → null)
 * - Scheduled filter three-state cycling (null → scheduled → not-scheduled → null)
 * - Tooltip text computation for star and scheduled filters
 * - Filtered grouped sessions computation with status, starred, and scheduled filters
 *
 * @returns {Object} Filter management utilities
 */
export function useSessionFiltering() {
  const sessionsStore = useSessionsStore();

  /**
   * Toggle a status filter. If already active, clears it; otherwise sets it as exclusive.
   * @param {string} status - 'running' or 'idle'
   */
  function toggleFilter(status) {
    if (sessionsStore.statusFilter === status) {
      sessionsStore.setStatusFilter(null);
    } else {
      sessionsStore.setStatusFilter(status);
    }
  }

  /**
   * Toggle a starred filter. If already active, clears it; otherwise sets it.
   * @param {string} filter - 'starred' or 'unstarred'
   */
  function toggleStarredFilter(filter) {
    if (sessionsStore.starredFilter === filter) {
      sessionsStore.setStarredFilter(null);
    } else {
      sessionsStore.setStarredFilter(filter);
    }
  }

  /**
   * Cycle the star filter through three states: null → starred → unstarred → null
   */
  function toggleStarFilterIcon() {
    if (sessionsStore.starredFilter === null) {
      sessionsStore.setStarredFilter('starred');
    } else if (sessionsStore.starredFilter === 'starred') {
      sessionsStore.setStarredFilter('unstarred');
    } else {
      sessionsStore.setStarredFilter(null);
    }
  }

  /**
   * Computed tooltip text for the star filter button.
   */
  const starFilterTooltip = computed(() => {
    if (sessionsStore.starredFilter === 'starred') {
      return 'Showing starred sessions only. Click to filter unstarred.';
    } else if (sessionsStore.starredFilter === 'unstarred') {
      return 'Showing unstarred sessions only. Click to show all.';
    } else {
      return 'Showing all sessions. Click to filter by starred.';
    }
  });

  /**
   * Cycle the scheduled filter through three states: null → scheduled → not-scheduled → null
   */
  function toggleScheduledFilterIcon() {
    if (sessionsStore.scheduledFilter === null) {
      sessionsStore.setScheduledFilter('scheduled');
    } else if (sessionsStore.scheduledFilter === 'scheduled') {
      sessionsStore.setScheduledFilter('not-scheduled');
    } else {
      sessionsStore.setScheduledFilter(null);
    }
  }

  /**
   * Computed tooltip text for the scheduled filter button.
   */
  const scheduledFilterTooltip = computed(() => {
    if (sessionsStore.scheduledFilter === 'scheduled') {
      return 'Showing workflows with scheduled sessions. Click to filter non-scheduled.';
    } else if (sessionsStore.scheduledFilter === 'not-scheduled') {
      return 'Showing workflows without scheduled sessions. Click to show all.';
    } else {
      return 'Showing all workflows. Click to filter by scheduled.';
    }
  });

  /**
   * Computed filtered grouped sessions, applying status, starred, and scheduled filters.
   */
  const filteredGroupedSessions = computed(() => {
    let groups = sessionsStore.groupedSessions;

    // Apply workflow-aware status filter if set
    if (sessionsStore.statusFilter) {
      groups = groups.filter(group => {
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

    // Apply starred filter if set (only considers root session's starred status)
    if (sessionsStore.starredFilter === 'starred') {
      groups = groups.filter(group => group.parent.starred);
    } else if (sessionsStore.starredFilter === 'unstarred') {
      groups = groups.filter(group => !group.parent.starred);
    }

    // Apply workflow-aware scheduled filter if set
    if (sessionsStore.scheduledFilter) {
      groups = groups.filter(group => {
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
