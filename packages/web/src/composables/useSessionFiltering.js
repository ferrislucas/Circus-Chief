import { computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';

/**
 * Composable for session filtering and sorting logic.
 * Extracts filter toggle handlers, tooltips, and the filtered grouped sessions
 * computed property from SessionListView.
 */
export function useSessionFiltering() {
  const sessionsStore = useSessionsStore();

  const toggleFilter = (status) => {
    // If the clicked filter is already active, clear all filters (show all)
    if (sessionsStore.statusFilter === status) {
      sessionsStore.setStatusFilter(null);
    } else {
      // Otherwise, set this filter as the only active one (exclusive)
      sessionsStore.setStatusFilter(status);
    }
  };

  const toggleStarredFilter = (filter) => {
    // If the clicked filter is already active, clear the filter (show all)
    if (sessionsStore.starredFilter === filter) {
      sessionsStore.setStarredFilter(null);
    } else {
      // Otherwise, set this filter as the only active one
      sessionsStore.setStarredFilter(filter);
    }
  };

  const toggleStarFilterIcon = () => {
    // Cycle through three states: null -> starred -> unstarred -> null
    if (sessionsStore.starredFilter === null) {
      sessionsStore.setStarredFilter('starred');
    } else if (sessionsStore.starredFilter === 'starred') {
      sessionsStore.setStarredFilter('unstarred');
    } else {
      sessionsStore.setStarredFilter(null);
    }
  };

  const starFilterTooltip = computed(() => {
    if (sessionsStore.starredFilter === 'starred') {
      return 'Showing starred sessions only. Click to filter unstarred.';
    } else if (sessionsStore.starredFilter === 'unstarred') {
      return 'Showing unstarred sessions only. Click to show all.';
    } else {
      return 'Showing all sessions. Click to filter by starred.';
    }
  });

  const toggleScheduledFilterIcon = () => {
    // Cycle through three states: null -> scheduled -> not-scheduled -> null
    if (sessionsStore.scheduledFilter === null) {
      sessionsStore.setScheduledFilter('scheduled');
    } else if (sessionsStore.scheduledFilter === 'scheduled') {
      sessionsStore.setScheduledFilter('not-scheduled');
    } else {
      sessionsStore.setScheduledFilter(null);
    }
  };

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

    // Apply workflow-aware status filter if set
    // This filters based on the aggregated status of the entire workflow tree
    if (sessionsStore.statusFilter) {
      groups = groups.filter(group => {
        // Get the workflow's effective status (aggregated across all descendants)
        const workflowStatus = sessionsStore.getWorkflowAggregatedStatus(group.parent.id);
        const effectiveStatus = workflowStatus.effectiveStatus;

        // "running" filter shows workflows where any session is running
        if (sessionsStore.statusFilter === 'running' && effectiveStatus === 'running') {
          return true;
        }
        // "idle" filter shows workflows where no session is running
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
    // This filters based on whether any session in the workflow is scheduled
    if (sessionsStore.scheduledFilter) {
      groups = groups.filter(group => {
        const workflowStatus = sessionsStore.getWorkflowAggregatedStatus(group.parent.id);
        const hasScheduled = workflowStatus.scheduledCount > 0;

        // "scheduled" filter shows workflows with at least one scheduled session
        if (sessionsStore.scheduledFilter === 'scheduled' && hasScheduled) {
          return true;
        }
        // "not-scheduled" filter shows workflows with no scheduled sessions
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
