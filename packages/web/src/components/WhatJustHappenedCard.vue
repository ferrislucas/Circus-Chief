<template>
  <div
    v-if="shouldShowCard"
    class="what-just-happened-card card"
    data-testid="what-just-happened-card"
  >
    <div class="card-header">
      <h3>Activity Log</h3>
    </div>

    <!-- Chain Trail -->
    <div
      v-if="recentChain"
      class="chain-trail"
      data-testid="chain-trail"
    >
      <template
        v-for="(step, index) in displaySteps"
        :key="step.id"
      >
        <!-- Chain step -->
        <div
          class="chain-step"
          :data-testid="`chain-step-${index}`"
        >
          <div
            class="chain-step-number"
            :data-testid="`chain-step-number-${index}`"
          >
            {{ index + 1 }}
          </div>

          <div class="chain-step-content">
            <div
              class="chain-step-name"
              :data-testid="`chain-step-name-${index}`"
            >
              {{ step.name }}
            </div>
            <div
              v-if="getStepSummary(step.id)"
              class="chain-step-summary"
              :data-testid="`chain-step-summary-${index}`"
            >
              {{ getStepSummary(step.id) }}
            </div>
            <div
              v-else-if="step.status === 'error'"
              class="chain-step-error"
            >
              Errored: {{ step.errorMessage || 'An error occurred' }}
            </div>
            <div
              v-if="formatStepTimestamp(step)"
              class="chain-step-timestamp"
              :data-testid="`chain-step-timestamp-${index}`"
            >
              {{ formatStepTimestamp(step) }}
            </div>
          </div>
        </div>

        <!-- Connector line (not after last step) -->
        <div
          v-if="index < displaySteps.length - 1"
          class="chain-connector"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line
              x1="12"
              y1="5"
              x2="12"
              y2="19"
            />
            <polyline points="19 12 12 19 5 12" />
          </svg>
        </div>
      </template>

      <!-- Ellipsis for truncated steps -->
      <div
        v-if="isTruncated"
        class="chain-ellipsis"
        data-testid="chain-ellipsis"
      >
        ...and {{ truncatedCount }} more steps
      </div>
    </div>

    <!-- Workflow Tally -->
    <div
      v-if="workflowTally"
      class="workflow-tally"
      data-testid="workflow-tally"
    >
      {{ workflowTally }}
    </div>

    <!-- Last activity -->
    <div
      v-if="lastActivityTime"
      class="last-activity"
    >
      Last activity {{ lastActivityTime }}
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';

const props = defineProps({
  session: {
    type: Object,
    required: true,
  },
  summary: {
    type: Object,
    default: null,
  },
  descendantSummaries: {
    type: Object,
    default: () => ({}),
  },
});

const sessionsStore = useSessionsStore();

/**
 * Determine if we should show the card
 * Only show if there are completed descendants
 */
const shouldShowCard = computed(() => {
  const descendants = sessionsStore.getAllDescendants(props.session.id);
  return descendants.length > 0;
});

/**
 * Find the most recent completed chain of descendants
 * Returns the chain from child of root to the most recent leaf
 */
const recentChain = computed(() => {
  const descendants = sessionsStore.getAllDescendants(props.session.id);
  if (!descendants.length) return null;

  // Find leaf descendants (sessions that are NOT the parent of any other descendant)
  const idsWithChildren = new Set(
    descendants.map(d => d.parentSessionId).filter(Boolean)
  );
  const leaves = descendants.filter(d => !idsWithChildren.has(d.id));

  // Sort leaves by lastActivityAt descending, pick most recent
  const sortedLeaves = [...leaves].sort((a, b) => {
    const aTime = new Date(a.lastActivityAt || a.updatedAt);
    const bTime = new Date(b.lastActivityAt || b.updatedAt);
    return bTime - aTime;
  });
  const mostRecentLeaf = sortedLeaves[0];
  if (!mostRecentLeaf) return null;

  // Walk from leaf to root using getSessionPath, then EXCLUDE the root session
  const fullPath = sessionsStore.getSessionPath(mostRecentLeaf.id);
  // fullPath = [root, child1, child2, ..., leaf]
  // Remove the first element (root) since user is already looking at it
  const chain = fullPath.slice(1);

  return chain;
});

/**
 * Determine if chain should be truncated
 * Show first 2 and last 3 if more than 6 steps
 */
const isTruncated = computed(() => recentChain.value && recentChain.value.length > 6);

const truncatedCount = computed(() => {
  if (!recentChain.value) return 0;
  return recentChain.value.length - 5; // Total minus first 2 and last 3
});

/**
 * Get the steps to display (handles truncation)
 */
const displaySteps = computed(() => {
  if (!recentChain.value) return [];

  if (!isTruncated.value) {
    return recentChain.value;
  }

  // Return first 2 and last 3
  const firstTwo = recentChain.value.slice(0, 2);
  const lastThree = recentChain.value.slice(-3);
  return [...firstTwo, ...lastThree];
});

/**
 * Get the summary text for a step
 */
function getStepSummary(sessionId) {
  const summary = props.descendantSummaries[sessionId];
  return summary?.shortSummary || null;
}

/**
 * Format the timestamp for a step
 */
function formatStepTimestamp(step) {
  const timestamp = step.lastActivityAt || step.updatedAt;
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Generate workflow tally text
 */
const workflowTally = computed(() => {
  const status = sessionsStore.getWorkflowAggregatedStatus(props.session.id);
  const parts = [];

  if (status.completedCount > 0) {
    parts.push(`${status.completedCount} completed`);
  }
  if (status.runningCount > 0) {
    parts.push(`${status.runningCount} running`);
  }
  if (status.scheduledCount > 0) {
    parts.push(`${status.scheduledCount} scheduled`);
  }

  return parts.length > 0 ? `Workflow: ${parts.join(' / ')}` : null;
});

/**
 * Get human-readable last activity time
 */
const lastActivityTime = computed(() => {
  if (!recentChain.value || recentChain.value.length === 0) return null;

  // Get the most recent activity from any descendant
  const descendants = sessionsStore.getAllDescendants(props.session.id);
  const latestActivity = descendants.reduce((latest, session) => {
    const activityTime = new Date(session.lastActivityAt || session.updatedAt);
    return activityTime > latest ? activityTime : latest;
  }, new Date(0));

  if (latestActivity.getTime() === 0) return null;

  const now = new Date();
  const diffMs = now - latestActivity;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
});
</script>

<style scoped>
.what-just-happened-card {
  margin-bottom: 1.5rem;
}

.card-header {
  margin-bottom: 1rem;
}

.card-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary);
}

.chain-trail {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.chain-step {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.chain-step-number {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-bg-secondary);
  color: var(--color-text-secondary);
  font-weight: 500;
  font-size: 0.875rem;
}

.chain-step-content {
  flex: 1;
  min-width: 0;
}

.chain-step-name {
  font-weight: 500;
  color: var(--color-text-primary);
  margin-bottom: 0.25rem;
}

.chain-step-summary {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

.chain-step-error {
  font-size: 0.875rem;
  color: var(--color-error);
}

.chain-step-timestamp {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
  margin-top: 0.25rem;
}

.chain-connector {
  display: flex;
  justify-content: center;
  padding: 0.25rem 0;
  color: var(--color-text-secondary);
  margin-left: 0.75rem;
}

.chain-connector svg {
  transform: rotate(90deg);
}

.chain-ellipsis {
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  padding: 0.5rem 0;
  font-style: italic;
}

.workflow-tally {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.75rem;
  background: var(--color-bg-secondary);
  border-radius: 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
}

.last-activity {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}
</style>
