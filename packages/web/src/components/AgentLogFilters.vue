<template>
  <div class="filter-bar">
    <div class="filter-row">
      <div class="filter-group">
        <label class="filter-label">From</label>
        <input
          type="date"
          class="filter-input"
          :value="startDateValue"
          @change="$emit('date-change', 'startDate', $event)"
        >
      </div>
      <div class="filter-group">
        <label class="filter-label">To</label>
        <input
          type="date"
          class="filter-input"
          :value="endDateValue"
          @change="$emit('date-change', 'endDate', $event)"
        >
      </div>
      <div class="filter-group">
        <label class="filter-label">Agent Type</label>
        <select
          class="filter-select"
          :value="filters.agentType || ''"
          @change="$emit('filter-change', 'agentType', $event.target.value)"
        >
          <option value="">
            All
          </option>
          <option
            v-for="t in filterOptions.agentTypes"
            :key="t"
            :value="t"
          >
            {{ t }}
          </option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Call Type</label>
        <select
          class="filter-select"
          :value="filters.callType || ''"
          @change="$emit('filter-change', 'callType', $event.target.value)"
        >
          <option value="">
            All
          </option>
          <option
            v-for="t in filterOptions.callTypes"
            :key="t"
            :value="t"
          >
            {{ t }}
          </option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Status</label>
        <select
          class="filter-select"
          :value="filters.status || ''"
          @change="$emit('filter-change', 'status', $event.target.value)"
        >
          <option value="">
            All
          </option>
          <option
            v-for="s in filterOptions.statuses"
            :key="s"
            :value="s"
          >
            {{ s }}
          </option>
        </select>
      </div>
      <div class="filter-group">
        <label class="filter-label">Model</label>
        <select
          class="filter-select"
          :value="filters.model || ''"
          @change="$emit('filter-change', 'model', $event.target.value)"
        >
          <option value="">
            All
          </option>
          <option
            v-for="m in filterOptions.models"
            :key="m"
            :value="m"
          >
            {{ m }}
          </option>
        </select>
      </div>
      <button
        v-if="hasActiveFilters"
        class="btn-clear"
        @click="$emit('clear-filters')"
      >
        Clear Filters
      </button>
      <button
        class="btn-clear-all"
        :class="{ confirming }"
        @click="$emit('clear-all')"
      >
        {{ confirming ? 'Confirm Clear All?' : 'Clear All Logs' }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  filters: { type: Object, required: true },
  filterOptions: { type: Object, required: true },
  hasActiveFilters: { type: Boolean, default: false },
  confirming: { type: Boolean, default: false },
});

defineEmits(['filter-change', 'date-change', 'clear-filters', 'clear-all']);

function toDateInputValue(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

const startDateValue = computed(() =>
  props.filters.startDate ? toDateInputValue(props.filters.startDate) : ''
);
const endDateValue = computed(() =>
  props.filters.endDate ? toDateInputValue(props.filters.endDate) : ''
);
</script>

<style scoped>
.filter-bar {
  background-color: var(--color-surface, #1f2937);
  border: 1px solid var(--color-border, #374151);
  border-radius: 0.5rem;
  padding: 0.75rem 1rem;
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-end;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.filter-label {
  font-size: 0.75rem;
  color: var(--color-text-soft, #9ca3af);
  font-weight: 500;
}

.filter-input,
.filter-select {
  background-color: var(--color-background, #111827);
  border: 1px solid var(--color-border, #374151);
  border-radius: 0.375rem;
  color: var(--color-text, #f3f4f6);
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
  min-width: 8rem;
}

.filter-input:focus,
.filter-select:focus {
  outline: none;
  border-color: var(--color-primary, #22d3ee);
}

.btn-clear {
  background-color: transparent;
  border: 1px solid var(--color-border, #374151);
  border-radius: 0.375rem;
  color: var(--color-text-soft, #9ca3af);
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  cursor: pointer;
  align-self: flex-end;
  transition: border-color 0.2s, color 0.2s;
}

.btn-clear:hover {
  border-color: var(--color-text, #f3f4f6);
  color: var(--color-text, #f3f4f6);
}

.btn-clear-all {
  background-color: transparent;
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 0.375rem;
  color: #f87171;
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  cursor: pointer;
  align-self: flex-end;
  transition: all 0.2s;
}

.btn-clear-all:hover {
  border-color: rgba(239, 68, 68, 0.8);
  color: #fca5a5;
}

.btn-clear-all.confirming {
  background-color: rgba(239, 68, 68, 0.2);
  border-color: #f87171;
  color: #fca5a5;
  font-weight: 600;
}
</style>
