<template>
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
            @click="col.sortable ? $emit('sort', col.key) : null"
          >
            {{ col.label }}
            <span v-if="col.sortable && sortBy === col.key" class="sort-indicator">
              {{ sortOrder === 'ASC' ? '\u2191' : '\u2193' }}
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
          <td class="td">
            <span class="status-dot" :class="statusDotClass(log.status)"></span>
            <span class="status-text">{{ log.status }}</span>
          </td>
          <td class="td font-mono text-sm">{{ log.agentType || '\u2014' }}</td>
          <td class="td font-mono text-sm">{{ log.callType || '\u2014' }}</td>
          <td class="td model-cell">{{ log.model || '\u2014' }}</td>
          <td class="td">
            <router-link
              v-if="log.sessionId"
              :to="`/sessions/${log.sessionId}`"
              class="session-link"
            >
              {{ log.sessionName || log.sessionId }}
            </router-link>
            <span v-else>&#x2014;</span>
          </td>
          <td class="td">
            <span v-if="getEffortLevel(log)" :class="['effort-badge', `effort-${getEffortLevel(log)}`]">
              {{ getEffortLevelLabel(getEffortLevel(log)) }}
            </span>
            <span v-else>&#x2014;</span>
          </td>
          <td class="td text-right" :title="tokenTooltip(log)">
            {{ formatNumber(log.totalTokens) }}
          </td>
          <td class="td text-right">{{ formatDuration(log.durationMs) }}</td>
          <td class="td text-right" :title="log.startedAt ? new Date(log.startedAt).toLocaleString() : ''">
            {{ log.startedAt ? relativeTime(log.startedAt) : '\u2014' }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
defineProps({
  logs: { type: Array, required: true },
  loading: { type: Boolean, default: false },
  sortBy: { type: String, default: 'started_at' },
  sortOrder: { type: String, default: 'DESC' },
});

defineEmits(['sort']);

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
  if (ms == null) return '\u2014';
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
</script>

<style scoped>
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

.th.sortable { cursor: pointer; }
.th.sortable:hover { color: var(--color-text, #f3f4f6); }

.sort-indicator {
  margin-left: 0.25rem;
  color: var(--color-primary, #22d3ee);
}

.log-row { border-bottom: 1px solid var(--color-border, #374151); }
.log-row:nth-child(even) { background-color: rgba(31, 41, 55, 0.5); }
.log-row:last-child { border-bottom: none; }

.td {
  padding: 0.5rem 0.75rem;
  color: var(--color-text, #f3f4f6);
  vertical-align: middle;
  white-space: nowrap;
}

.text-right { text-align: right; }
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
.text-sm { font-size: 0.8125rem; }

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
.status-text { vertical-align: middle; }

.session-link {
  color: var(--color-primary, #22d3ee);
  text-decoration: none;
  font-size: 0.8125rem;
}

.session-link:hover { text-decoration: underline; }

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
