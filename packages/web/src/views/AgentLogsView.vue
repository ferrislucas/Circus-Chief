<template>
  <div class="agent-logs">
    <!-- Filter Bar -->
    <AgentLogFilters
      :filters="filters"
      :filter-options="filterOptions"
      :has-active-filters="hasActiveFilters"
      :confirming="confirming"
      @filter-change="(key, val) => store.setFilter(key, val)"
      @date-change="onDateChange"
      @clear-filters="store.clearFilters()"
      @clear-all="onClearAll"
    />

    <!-- Error Banner -->
    <div
      v-if="error"
      class="error-banner"
    >
      <span>{{ error }}</span>
      <button
        class="btn-retry"
        @click="store.fetchLogs()"
      >
        Retry
      </button>
    </div>

    <!-- Table -->
    <AgentLogTable
      :logs="logs"
      :loading="loading"
      :sort-by="sortBy"
      :sort-order="sortOrder"
      @sort="onSort"
    />

    <!-- Pagination Bar -->
    <div
      v-if="pagination.total > 0"
      class="pagination-bar"
    >
      <div class="per-page-control">
        <label class="filter-label">Per page</label>
        <select
          class="filter-select per-page-select"
          :value="perPage"
          @change="store.setPerPage(parseInt($event.target.value))"
        >
          <option
            v-for="n in [10, 25, 50, 100]"
            :key="n"
            :value="n"
          >
            {{ n }}
          </option>
        </select>
      </div>

      <div class="page-info">
        Showing {{ showingFrom }}–{{ showingTo }} of {{ pagination.total }} logs
      </div>

      <div class="page-buttons">
        <button
          class="page-btn"
          :disabled="currentPage === 1"
          @click="store.setPage(1)"
        >
          &laquo;
        </button>
        <button
          class="page-btn"
          :disabled="currentPage === 1"
          @click="store.setPage(currentPage - 1)"
        >
          &lsaquo;
        </button>
        <template
          v-for="p in pageNumbers"
          :key="p"
        >
          <span
            v-if="p === '...'"
            class="page-ellipsis"
          >&hellip;</span>
          <button
            v-else
            class="page-btn"
            :class="{ 'page-btn-active': p === currentPage }"
            @click="store.setPage(p)"
          >
            {{ p }}
          </button>
        </template>
        <button
          class="page-btn"
          :disabled="currentPage === totalPages"
          @click="store.setPage(currentPage + 1)"
        >
          &rsaquo;
        </button>
        <button
          class="page-btn"
          :disabled="currentPage === totalPages"
          @click="store.setPage(totalPages)"
        >
          &raquo;
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, onUnmounted } from 'vue';
import { useAgentLogsStore } from '../stores/agentLogs.js';
import AgentLogFilters from '../components/AgentLogFilters.vue';
import AgentLogTable from '../components/AgentLogTable.vue';

const store = useAgentLogsStore();
const confirming = ref(false);
const confirmTimer = ref(null);

const logs = computed(() => store.logs);
const pagination = computed(() => store.pagination);
const filters = computed(() => store.filters);
const filterOptions = computed(() => store.filterOptions);
const perPage = computed(() => store.perPage);
const currentPage = computed(() => store.currentPage);
const totalPages = computed(() => store.totalPages);
const sortBy = computed(() => store.sortBy);
const sortOrder = computed(() => store.sortOrder);
const loading = computed(() => store.loading);
const error = computed(() => store.error);

const hasActiveFilters = computed(() => Object.values(store.filters).some((v) => v != null));

const showingFrom = computed(() => {
  if (pagination.value.total === 0) return 0;
  return pagination.value.offset + 1;
});
const showingTo = computed(() =>
  Math.min(pagination.value.offset + perPage.value, pagination.value.total)
);

const pageNumbers = computed(() => {
  const total = totalPages.value;
  const current = currentPage.value;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = [];
  if (current <= 4) {
    pages.push(1, 2, 3, 4, 5, '...', total);
  } else if (current >= total - 3) {
    pages.push(1, '...', total - 4, total - 3, total - 2, total - 1, total);
  } else {
    pages.push(1, '...', current - 1, current, current + 1, '...', total);
  }
  return pages;
});

function onSort(colKey) {
  if (sortBy.value === colKey) {
    store.setSort(colKey, sortOrder.value === 'ASC' ? 'DESC' : 'ASC');
  } else {
    store.setSort(colKey, 'DESC');
  }
}

function onDateChange(key, event) {
  const val = event.target.value;
  if (!val) {
    store.setFilter(key, null);
    return;
  }
  const ts = new Date(`${val  }T00:00:00Z`).getTime();
  store.filters[key] = ts;
  store.currentPage = 1;
  store.fetchLogs();
}

function onClearAll() {
  if (!confirming.value) {
    confirming.value = true;
    confirmTimer.value = setTimeout(() => {
      confirming.value = false;
      confirmTimer.value = null;
    }, 3000);
  } else {
    if (confirmTimer.value) {
      clearTimeout(confirmTimer.value);
      confirmTimer.value = null;
    }
    confirming.value = false;
    store.clearAllLogs();
  }
}

onMounted(() => {
  store.fetchLogs();
  store.fetchFilterOptions();
});

onUnmounted(() => {
  if (confirmTimer.value) {
    clearTimeout(confirmTimer.value);
  }
});
</script>

<style scoped>
.agent-logs {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 1rem;
  background-color: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 0.375rem;
  padding: 0.75rem 1rem;
  color: #f87171;
  font-size: 0.875rem;
}

.btn-retry {
  background-color: transparent;
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 0.25rem;
  color: #f87171;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.btn-retry:hover {
  border-color: #f87171;
}

.filter-label {
  font-size: 0.75rem;
  color: var(--color-text-soft, #9ca3af);
  font-weight: 500;
}

.filter-select {
  background-color: var(--color-background, #111827);
  border: 1px solid var(--color-border, #374151);
  border-radius: 0.375rem;
  color: var(--color-text, #f3f4f6);
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
  min-width: 8rem;
}

.pagination-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.5rem 0;
}

.per-page-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.per-page-select {
  min-width: 4rem;
  padding: 0.25rem 0.375rem;
}

.page-info {
  color: var(--color-text-soft, #9ca3af);
  font-size: 0.875rem;
  flex: 1;
  text-align: center;
}

.page-buttons {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.page-btn {
  background-color: var(--color-surface, #1f2937);
  border: 1px solid var(--color-border, #374151);
  border-radius: 0.25rem;
  color: var(--color-text, #f3f4f6);
  padding: 0.25rem 0.625rem;
  font-size: 0.875rem;
  cursor: pointer;
  min-width: 2rem;
  transition: background-color 0.15s, border-color 0.15s;
}

.page-btn:hover:not(:disabled) {
  background-color: var(--color-border, #374151);
  border-color: var(--color-text-soft, #9ca3af);
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-btn-active {
  background-color: var(--color-primary, #22d3ee);
  border-color: var(--color-primary, #22d3ee);
  color: #111827;
  font-weight: 600;
}

.page-ellipsis {
  color: var(--color-text-soft, #9ca3af);
  padding: 0 0.25rem;
}
</style>
