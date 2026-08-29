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
</style>
