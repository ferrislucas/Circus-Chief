<template>
  <!-- Status Filters -->
  <div v-if="activeTab === 'sessions'" class="filters-container">
    <div class="status-filters">
      <button
        v-for="status in ['running', 'idle']"
        :key="status"
        :class="['filter-btn', { active: sessionsStore.statusFilter === status }]"
        @click="toggleFilter(status)"
      >
        {{ status }}
      </button>
      <button
        :class="[
          'filter-btn star-btn',
          {
            'star-filter-active': sessionsStore.starredFilter === 'starred',
            'star-filter-unstarred': sessionsStore.starredFilter === 'unstarred',
            'star-filter-all': sessionsStore.starredFilter === null
          }
        ]"
        :title="starFilterTooltip"
        @click="toggleStarFilterIcon"
      >
        <span class="star-icon" v-if="sessionsStore.starredFilter === 'starred'">&#x2B50;</span>
        <span class="star-icon star-crossed" v-else-if="sessionsStore.starredFilter === 'unstarred'">&#x2B50;</span>
        <span class="star-icon" v-else>&#x2606;</span>
      </button>
      <button
        :class="[
          'filter-btn schedule-btn',
          {
            'schedule-filter-active': sessionsStore.scheduledFilter === 'scheduled',
            'schedule-filter-not-scheduled': sessionsStore.scheduledFilter === 'not-scheduled',
            'schedule-filter-all': sessionsStore.scheduledFilter === null
          }
        ]"
        :title="scheduledFilterTooltip"
        @click="toggleScheduledFilterIcon"
      >
        <span class="schedule-icon" v-if="sessionsStore.scheduledFilter === 'scheduled'">&#x23F0;</span>
        <span class="schedule-icon schedule-crossed" v-else-if="sessionsStore.scheduledFilter === 'not-scheduled'">&#x23F0;</span>
        <span class="schedule-icon" v-else>&#x23F0;</span>
      </button>
    </div>
  </div>

  <!-- Status/Starred Filters for Archived Tab -->
  <div v-else-if="activeTab === 'archived'" class="filters-container">
    <div class="status-filters">
      <button
        :class="[
          'filter-btn star-btn',
          {
            'star-filter-active': sessionsStore.starredFilter === 'starred',
            'star-filter-unstarred': sessionsStore.starredFilter === 'unstarred',
            'star-filter-all': sessionsStore.starredFilter === null
          }
        ]"
        :title="starFilterTooltip"
        @click="toggleStarFilterIcon"
      >
        <span class="star-icon" v-if="sessionsStore.starredFilter === 'starred'">&#x2B50;</span>
        <span class="star-icon star-crossed" v-else-if="sessionsStore.starredFilter === 'unstarred'">&#x2B50;</span>
        <span class="star-icon" v-else>&#x2606;</span>
      </button>
    </div>
  </div>

  <!-- Spacer for other tabs to match structure -->
  <div v-else class="tab-spacer"></div>
</template>

<script setup>
import { useSessionsStore } from '../stores/sessions.js';
import { useSessionFiltering } from '../composables/useSessionFiltering.js';

defineProps({
  activeTab: {
    type: String,
    required: true,
  },
});

const sessionsStore = useSessionsStore();
const {
  toggleFilter,
  toggleStarFilterIcon,
  starFilterTooltip,
  toggleScheduledFilterIcon,
  scheduledFilterTooltip,
} = useSessionFiltering();
</script>

<style scoped>
.status-filters {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.tab-spacer {
  height: 1rem;
}

.filter-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.filter-btn {
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

.filter-btn:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

/* Star icon wrapper - enables positioning for the slash */
.star-icon {
  position: relative;
  display: inline-block;
}

/* Default state - no filter (show all) */
.filter-btn.star-filter-all {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text-soft);
}

.filter-btn.star-filter-all:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

/* Active state - filter by starred */
.filter-btn.star-filter-active,
.filter-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

/* Unstarred state - filter by not starred (EXCLUDE starred) */
.filter-btn.star-filter-unstarred {
  background: transparent;
  border-color: #f97316; /* Orange for "exclude/negative" action */
  color: #f97316; /* Orange star */
}

/* Add diagonal line through the star */
.star-crossed::after {
  content: '';
  position: absolute;
  top: 50%;
  left: -10%;
  right: -10%;
  height: 2px;
  background: currentColor; /* Inherits orange color */
  transform: translateY(-50%) rotate(-45deg);
  pointer-events: none;
}

/* Schedule filter styles */
.schedule-icon {
  position: relative;
  display: inline-block;
}

/* Default state - no filter (show all) */
.filter-btn.schedule-filter-all {
  background: transparent;
  border-color: var(--color-border);
  color: var(--color-text-soft);
}

.filter-btn.schedule-filter-all:hover {
  border-color: var(--color-primary);
  color: var(--color-text);
}

/* Active state - filter by scheduled */
.filter-btn.schedule-filter-active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: white;
}

/* Not-scheduled state - filter by not scheduled (EXCLUDE scheduled) */
.filter-btn.schedule-filter-not-scheduled {
  background: transparent;
  border-color: #f97316; /* Orange for "exclude/negative" action */
  color: #f97316;
}

/* Add diagonal line through the schedule icon */
.schedule-crossed::after {
  content: '';
  position: absolute;
  top: 50%;
  left: -10%;
  right: -10%;
  height: 2px;
  background: currentColor;
  transform: translateY(-50%) rotate(-45deg);
  pointer-events: none;
}
</style>
