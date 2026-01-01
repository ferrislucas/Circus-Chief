<template>
  <span class="pr-indicators">
    <a
      v-if="prUrl"
      :href="prUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="pr-link"
      @click.stop
    >
      <svg class="pr-icon" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
      </svg>
      {{ extractPrNumber(prUrl) }}
    </a>
    <span v-if="summary?.prState" :class="['pr-state-badge', `pr-state-${summary.prState}`]">
      {{ formatPrState(summary.prState) }}
    </span>
    <span v-if="summary?.hasMergeConflicts" class="conflict-indicator" title="Merge conflicts detected">
      <svg viewBox="0 0 16 16" fill="currentColor" class="conflict-icon">
        <path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8z"/>
        <path d="M7.25 4.5a.75.75 0 011.5 0v3.25a.75.75 0 01-1.5 0V4.5zM8 10a1 1 0 100 2 1 1 0 000-2z"/>
      </svg>
    </span>
    <span v-if="summary?.ciStatus" :class="['ci-indicator', `ci-${summary.ciStatus}`]" :title="ciStatusTitle">
      {{ ciStatusIcon }}
    </span>
  </span>
</template>

<script setup>
import { computed } from 'vue';

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

const ciStatusIcon = computed(() => {
  const icons = {
    success: '✓',
    failure: '✗',
    pending: '○',
  };
  return icons[props.summary?.ciStatus] || '';
});

const ciStatusTitle = computed(() => {
  const titles = {
    success: 'CI passing',
    failure: 'CI failing',
    pending: 'CI pending',
  };
  return titles[props.summary?.ciStatus] || '';
});

function extractPrNumber(url) {
  if (!url) return 'PR';
  const match = url.match(/\/pull\/(\d+)/);
  return match ? `PR ${match[1]}` : 'PR';
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
  width: 12px;
  height: 12px;
}

/* CI Status Indicators */
.ci-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 0.6875rem;
  font-weight: 600;
  border-radius: 50%;
}

.ci-success {
  background: rgba(46, 160, 67, 0.15);
  color: #2ea043;
}

.ci-failure {
  background: rgba(207, 34, 46, 0.15);
  color: #cf222e;
}

.ci-pending {
  background: rgba(210, 153, 34, 0.15);
  color: #9a6700;
}
</style>
