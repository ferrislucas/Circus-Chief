<template>
  <div class="filters-container">
    <div class="project-status-filters">
      <button
        v-for="status in statuses"
        :key="status"
        :class="[
          'filter-btn',
          {
            active: projectFilters.statusFilter === status,
            'filter-btn-empty': statusFacets[status] === 0,
          },
        ]"
        :aria-label="`${status} (${statusFacets[status]})`"
        @click="toggleFilter(status)"
      >
        <span class="filter-label">{{ status }}</span>
        <span class="filter-count">{{ statusFacets[status] }}</span>
      </button>
      <button
        :class="['filter-btn', 'pinned-filter-btn', { active: projectFilters.pinnedOnly, 'filter-btn-empty': pinnedCount === 0 }]"
        type="button"
        :aria-label="`Pinned projects (${pinnedCount})`"
        :aria-pressed="projectFilters.pinnedOnly"
        @click="projectFilters.togglePinnedOnly()"
      >
        <svg class="pin-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 3h8l-1 6 3 3v2H6v-2l3-3-1-6Zm4 11v7" />
        </svg>
        <span class="filter-count">{{ pinnedCount }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { useProjectFiltersStore } from '../stores/projectFilters.js';

const statuses = ['running', 'waiting', 'idle'];

const props = defineProps({
  /** Running-session total and project counts for the remaining statuses. */
  statusFacets: {
    type: Object,
    default: () => ({ running: 0, waiting: 0, idle: 0 }),
  },
  pinnedCount: {
    type: Number,
    default: 0,
  },
});

const projectFilters = useProjectFiltersStore();

function toggleFilter(status) {
  if (projectFilters.statusFilter === status) {
    projectFilters.setStatusFilter(null);
  } else {
    projectFilters.setStatusFilter(status);
  }
}
</script>

<style scoped>
/* Filter pill styles duplicated from SessionFiltersPanel (its styles are
   scoped and cannot be imported). Kept in sync manually. */
.project-status-filters {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: 1px solid var(--color-border);
  padding: 0.375rem 0.75rem;
  font-size: 0.8rem;
  color: var(--color-text-soft);
  cursor: pointer;
  border-radius: var(--border-radius);
  transition: all 0.15s;
  text-transform: capitalize;
}

.filter-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  padding: 0 0.375rem;
  border-radius: 999px;
  background: var(--color-background-mute);
  color: var(--color-text-soft);
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1.25rem;
  text-transform: none;
}

.filter-btn.active .filter-count {
  background: var(--color-background);
  color: var(--color-primary);
}

.filter-btn-empty {
  opacity: 0.55;
}

.filter-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

.filter-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

.filter-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.pinned-filter-btn {
  min-width: 2.5rem;
  justify-content: center;
  padding-inline: 0.5rem;
}

.pin-icon {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.pinned-filter-btn.active .pin-icon {
  fill: currentColor;
}
</style>
