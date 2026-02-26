<template>
  <span class="pr-indicators">
    <a
      v-if="prUrl"
      :href="prUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="pr-link"
      data-testid="pr-link"
      :title="getPrTooltip()"
      @click.stop
    >
      <svg class="pr-icon" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
      </svg>
      {{ displayPrText() }}
    </a>
    <span v-if="summary?.prState" :class="['pr-state-badge', `pr-state-${summary.prState}`]" data-testid="pr-state-badge">
      {{ formatPrState(summary.prState) }}
    </span>
    <span v-if="summary?.hasMergeConflicts" class="conflict-indicator" data-testid="pr-conflict-indicator" title="Merge conflicts detected">
      <!-- Git merge conflict icon - two branches with alert -->
      <svg viewBox="0 0 16 16" fill="currentColor" class="conflict-icon">
        <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z"/>
        <path d="M10.5 1.5l2 2-2 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12.5 3.5H10" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      </svg>
    </span>
    <!-- CI Status with SVG icons -->
    <span v-if="summary?.ciStatus === 'success'" class="ci-indicator ci-success" data-testid="pr-ci-status" title="CI passing">
      <svg viewBox="0 0 16 16" fill="currentColor" class="ci-icon">
        <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.751.751 0 0 0-.018-1.042.751.751 0 0 0-1.042-.018L6.75 9.19 5.28 7.72a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z"/>
      </svg>
    </span>
    <span v-else-if="summary?.ciStatus === 'failure'" class="ci-indicator ci-failure" data-testid="pr-ci-status" title="CI failing">
      <svg viewBox="0 0 16 16" fill="currentColor" class="ci-icon">
        <path d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8 4.97 9.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94 6.03 4.97Z"/>
      </svg>
    </span>
    <span v-else-if="summary?.ciStatus === 'pending'" class="ci-indicator ci-pending" data-testid="pr-ci-status" title="CI pending">
      <svg viewBox="0 0 16 16" fill="currentColor" class="ci-icon">
        <path d="M8 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"/>
      </svg>
    </span>
  </span>
</template>

<script setup>
const props = defineProps({
  prUrl: {
    type: String,
    default: null,
  },
  summary: {
    type: Object,
    default: null,
  },
});

/**
 * Extract PR number and repo from URL for display
 */
function extractPrDisplay() {
  if (!props.prUrl) return { number: null, repo: null };

  const match = props.prUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
  if (!match) return { number: null, repo: null };

  return {
    number: match[3],
    owner: match[1],
    repo: match[2],
  };
}

/**
 * Display PR text - just show the number
 */
function displayPrText() {
  if (!props.prUrl) return 'PR';

  const pr = extractPrDisplay();
  if (!pr.number) return 'PR';

  return `PR ${pr.number}`;
}

/**
 * Get tooltip with PR repository information
 */
function getPrTooltip() {
  if (!props.prUrl) return '';

  const pr = extractPrDisplay();
  const parts = [];

  if (pr.number) {
    parts.push(`PR #${pr.number}`);
  }

  if (pr.owner && pr.repo) {
    parts.push(`Repository: ${pr.owner}/${pr.repo}`);
  }

  if (props.summary?.prState) {
    parts.push(`State: ${formatPrState(props.summary.prState)}`);
  }

  return parts.join(' • ');
}

function formatPrState(state) {
  const labels = {
    merged: 'Merged',
    open: 'Open',
    closed: 'Closed',
    draft: 'Draft',
  };
  return labels[state] || state;
}
</script>

<style scoped>
.pr-indicators {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.pr-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  font-size: 0.6875rem;
  font-weight: 500;
  color: white;
  background: var(--color-primary);
  border-radius: 3px;
  text-decoration: none;
  transition: background-color 0.2s, color 0.2s;
}

.pr-link:hover {
  background: var(--color-primary-hover, var(--color-primary));
  filter: brightness(1.1);
  color: white;
}

.pr-icon {
  width: 12px;
  height: 12px;
}

/* PR State Badges */
.pr-state-badge {
  display: inline-block;
  padding: 0.125rem 0.375rem;
  font-size: 0.625rem;
  font-weight: 500;
  border-radius: 3px;
  text-transform: capitalize;
}

.pr-state-merged {
  background: rgba(130, 80, 223, 0.15);
  color: #8250df;
}

.pr-state-open {
  background: rgba(46, 160, 67, 0.15);
  color: #2ea043;
}

.pr-state-closed {
  background: rgba(110, 119, 129, 0.15);
  color: #6e7781;
}

.pr-state-draft {
  background: rgba(210, 153, 34, 0.15);
  color: #9a6700;
}

/* Merge Conflict Indicator */
.conflict-indicator {
  display: inline-flex;
  align-items: center;
  color: #cf222e;
}

.conflict-icon {
  width: 14px;
  height: 14px;
}

/* CI Status Indicators */
.ci-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ci-icon {
  width: 14px;
  height: 14px;
}

.ci-success {
  color: #2ea043;
}

.ci-failure {
  color: #cf222e;
}

.ci-pending {
  color: #9a6700;
}
</style>
