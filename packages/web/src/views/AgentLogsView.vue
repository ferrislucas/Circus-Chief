<template>
  <div class="agent-logs">
    <!-- Filter Bar -->
    <div class="filter-bar">
      <div class="filter-row">
        <div class="filter-group">
          <label class="filter-label">From</label>
          <input
            type="date"
            class="filter-input"
            :value="filters.startDate ? toDateInputValue(filters.startDate) : ''"
            @change="onDateChange('startDate', $event)"
          />
        </div>
        <div class="filter-group">
          <label class="filter-label">To</label>
          <input
            type="date"
            class="filter-input"
            :value="filters.endDate ? toDateInputValue(filters.endDate) : ''"
            @change="onDateChange('endDate', $event)"
          />
        </div>
        <div class="filter-group">
          <label class="filter-label">Agent Type</label>
          <select
            class="filter-select"
            :value="filters.agentType || ''"
            @change="store.setFilter('agentType', $event.target.value)"
          >
            <option value="">All</option>
            <option v-for="t in filterOptions.agentTypes" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="filter-label">Call Type</label>
          <select
            class="filter-select"
            :value="filters.callType || ''"
            @change="store.setFilter('callType', $event.target.value)"
          >
            <option value="">All</option>
            <option v-for="t in filterOptions.callTypes" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="filter-label">Status</label>
          <select
            class="filter-select"
            :value="filters.status || ''"
            @change="store.setFilter('status', $event.target.value)"
          >
            <option value="">All</option>
            <option v-for="s in filterOptions.statuses" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="filter-group">
          <label class="filter-label">Model</label>
          <select
            class="filter-select"
            :value="filters.model || ''"
            @change="store.setFilter('model', $event.target.value)"
          >
            <option value="">All</option>
            <option v-for="m in filterOptions.models" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>
        <button
          v-if="hasActiveFilters"
          class="btn-clear"
          @click="store.clearFilters()"
        >
          Clear Filters
        </button>
        <button
          class="btn-clear-all"
          :class="{ confirming }"
          @click="onClearAll"
        >
          {{ confirming ? 'Confirm Clear All?' : 'Clear All Logs' }}
        </button>
      </div>
    </div>

    <!-- Error Banner -->
    <div v-if="error" class="error-banner">
      <span>{{ error }}</span>
      <button class="btn-retry" @click="store.fetchLogs()">Retry</button>
    </div>

    <!-- Table -->
    <div class="table-wrapper">
      <div v-if="loading" class="loading-overlay">
        <div class="spinner"></div>
      </div>

      <table class="log-table">
        <thead>
          <tr>
            <th
              v-for="col in columns"
              :key="col.key"
              :class="['th', col.sortable ? 'sortable' : '']"
              @click="col.sortable ? onSort(col.key) : null"
            >
              {{ col.label }}
              <span v-if="col.sortable && sortBy === col.key" class="sort-indicator">
                {{ sortOrder === 'ASC' ? '↑' : '↓' }}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="!loading && logs.length === 0">
            <td :colspan="columns.length" class="empty-cell">No agent call logs found.</td>
          </tr>
          <tr
            v-for="log in logs"
            :key="log.id"
            class="log-row"
          >
            <!-- Status -->
            <td class="td">
              <span class="status-dot" :class="statusDotClass(log.status)"></span>
              <span class="status-text">{{ log.status }}</span>
            </td>
            <!-- Agent Type -->
            <td class="td font-mono text-sm">{{ log.agentType || '—' }}</td>
            <!-- Call Type -->
            <td class="td font-mono text-sm">{{ log.callType || '—' }}</td>
            <!-- Model -->
            <td class="td model-cell">{{ log.model || '—' }}</td>
            <!-- Session -->
            <td class="td">
              <router-link
                v-if="log.sessionId"
                :to="`/sessions/${log.sessionId}`"
                class="session-link"
              >
                {{ log.sessionName || log.sessionId }}
              </router-link>
              <span v-else>—</span>
            </td>
            <!-- Effort Level -->
            <td class="td">
              <span v-if="getEffortLevel(log)" :class="['effort-badge', `effort-${getEffortLevel(log)}`]">
                {{ getEffortLevelLabel(getEffortLevel(log)) }}
              </span>
              <span v-else>—</span>
            </td>
            <!-- Tokens -->
            <td class="td text-right" :title="tokenTooltip(log)">
              {{ formatNumber(log.totalTokens) }}
            </td>
            <!-- Duration -->
            <td class="td text-right">{{ formatDuration(log.durationMs) }}</td>
            <!-- Started -->
            <td class="td text-right" :title="log.startedAt ? new Date(log.startedAt).toLocaleString() : ''">
              {{ log.startedAt ? relativeTime(log.startedAt) : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination Bar -->
    <div v-if="pagination.total > 0" class="pagination-bar">
      <div class="per-page-control">
        <label class="filter-label">Per page</label>
        <select
          class="filter-select per-page-select"
          :value="perPage"
          @change="store.setPerPage(parseInt($event.target.value))"
        >
          <option v-for="n in [10, 25, 50, 100]" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>

      <div class="page-info">
        Showing {{ showingFrom }}–{{ showingTo }} of {{ pagination.total }} logs
      </div>

      <div class="page-buttons">
        <button class="page-btn" :disabled="currentPage === 1" @click="store.setPage(1)">
          «
        </button>
        <button class="page-btn" :disabled="currentPage === 1" @click="store.setPage(currentPage - 1)">
          ‹
        </button>
        <template v-for="p in pageNumbers" :key="p">
          <span v-if="p === '...'" class="page-ellipsis">…</span>
          <button
            v-else
            class="page-btn"
            :class="{ 'page-btn-active': p === currentPage }"
            @click="store.setPage(p)"
          >
            {{ p }}
          </button>
        </template>
        <button class="page-btn" :disabled="currentPage === totalPages" @click="store.setPage(currentPage + 1)">
          ›
        </button>
        <button class="page-btn" :disabled="currentPage === totalPages" @click="store.setPage(totalPages)">
          »
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, onUnmounted } from 'vue';
import { useAgentLogsStore } from '../stores/agentLogs.js';

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

const columns = [
  { key: 'status', label: 'Status', sortable: true },
  { key: 'agent_type', label: 'Agent Type', sortable: true },
  { key: 'call_type', label: 'Call Type', sortable: true },
  { key: 'model', label: 'Model', sortable: true },
  { key: 'session', label: 'Session', sortable: false },
  { key: 'effort', label: 'Effort', sortable: false },
  { key: 'total_tokens', label: 'Tokens', sortable: true },
  { key: 'duration_ms', label: 'Duration', sortable: true },
  { key: 'started_at', label: 'Started', sortable: true },
];

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
  // Convert date string to timestamp (start of day UTC)
  const ts = new Date(val + 'T00:00:00Z').getTime();
  store.filters[key] = ts;
  store.currentPage = 1;
  store.fetchLogs();
}

function toDateInputValue(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function statusDotClass(status) {
  switch (status) {
    case 'completed':
      return 'dot-completed';
    case 'error':
      return 'dot-error';
    case 'streaming':
    case 'pending':
      return 'dot-pending';
    default:
      return 'dot-default';
  }
}

function tokenTooltip(log) {
  const parts = [];
  if (log.inputTokens) parts.push(`Input: ${formatNumber(log.inputTokens)}`);
  if (log.outputTokens) parts.push(`Output: ${formatNumber(log.outputTokens)}`);
  if (log.thinkingTokens) parts.push(`Thinking: ${formatNumber(log.thinkingTokens)}`);
  if (log.cacheReadTokens) parts.push(`Cache Read: ${formatNumber(log.cacheReadTokens)}`);
  if (log.cacheWriteTokens) parts.push(`Cache Write: ${formatNumber(log.cacheWriteTokens)}`);
  return parts.join('\n') || 'No token data';
}

function formatNumber(n) {
  if (n == null || n === 0) return '0';
  return n.toLocaleString();
}

function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function getEffortLevel(log) {
  try {
    if (log.metadata) {
      const metadata = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
      return metadata.effortLevel || null;
    }
  } catch (e) {
    // Invalid JSON, return null
  }
  return null;
}

function getEffortLevelLabel(level) {
  const labels = {
    'auto': 'Auto',
    'low': 'Low',
    'medium': 'Med',
    'high': 'High',
    'max': 'Max',
  };
  return labels[level] || level;
}

function onClearAll() {
  if (!confirming.value) {
    // First click: start confirmation
    confirming.value = true;
    confirmTimer.value = setTimeout(() => {
      confirming.value = false;
      confirmTimer.value = null;
    }, 3000);
  } else {
    // Second click: confirm and clear
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

.table-wrapper {
  position: relative;
  overflow-x: auto;
  border: 1px solid var(--color-border, #374151);
  border-radius: 0.5rem;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  background-color: rgba(17, 24, 39, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: 0.5rem;
}

.spinner {
  width: 2rem;
  height: 2rem;
  border: 3px solid var(--color-border, #374151);
  border-top-color: var(--color-primary, #22d3ee);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.th {
  text-align: left;
  padding: 0.625rem 0.75rem;
  color: var(--color-text-soft, #9ca3af);
  font-weight: 600;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background-color: var(--color-surface, #1f2937);
  border-bottom: 1px solid var(--color-border, #374151);
  white-space: nowrap;
  user-select: none;
}

.th.sortable {
  cursor: pointer;
}

.th.sortable:hover {
  color: var(--color-text, #f3f4f6);
}

.sort-indicator {
  margin-left: 0.25rem;
  color: var(--color-primary, #22d3ee);
}

.log-row {
  border-bottom: 1px solid var(--color-border, #374151);
}

.log-row:nth-child(even) {
  background-color: rgba(31, 41, 55, 0.5);
}

.log-row:last-child {
  border-bottom: none;
}

.td {
  padding: 0.5rem 0.75rem;
  color: var(--color-text, #f3f4f6);
  vertical-align: middle;
  white-space: nowrap;
}

.text-right {
  text-align: right;
}

.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.text-sm {
  font-size: 0.8125rem;
}

.model-cell {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8125rem;
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-cell {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-soft, #9ca3af);
}

.status-dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  margin-right: 0.375rem;
  vertical-align: middle;
}

.dot-completed { background-color: #34d399; }
.dot-error { background-color: #f87171; }
.dot-pending { background-color: #fbbf24; }
.dot-default { background-color: #6b7280; }

.status-text {
  vertical-align: middle;
}

.session-link {
  color: var(--color-primary, #22d3ee);
  text-decoration: none;
  font-size: 0.8125rem;
}

.session-link:hover {
  text-decoration: underline;
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

.effort-badge {
  display: inline-block;
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.effort-auto {
  background-color: rgba(107, 114, 128, 0.2);
  color: #9ca3af;
  border: 1px solid rgba(107, 114, 128, 0.4);
}

.effort-low {
  background-color: rgba(52, 211, 153, 0.2);
  color: #34d399;
  border: 1px solid rgba(52, 211, 153, 0.4);
}

.effort-medium {
  background-color: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.4);
}

.effort-high {
  background-color: rgba(251, 146, 60, 0.2);
  color: #fb923c;
  border: 1px solid rgba(251, 146, 60, 0.4);
}

.effort-max {
  background-color: rgba(239, 68, 68, 0.2);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.4);
}
</style>
