<template>
  <div
    v-if="rows.length > 1"
    class="lineage-graph"
    data-testid="session-lineage-graph"
  >
    <div class="lineage-legend">
      <h4 class="lineage-legend-title">
        Workspace lineage
      </h4>
      <span class="lineage-legend-item">
        <span class="lineage-dot lineage-dot--running" />
        running
      </span>
      <span class="lineage-legend-item">
        <span class="lineage-dot lineage-dot--stopped" />
        stopped
      </span>
      <span class="lineage-legend-item">
        <span class="lineage-dot lineage-dot--error" />
        error
      </span>
      <span class="lineage-legend-item">
        <span class="lineage-dot lineage-dot--scheduled" />
        scheduled
      </span>
    </div>

    <div class="lineage-rows">
      <button
        v-for="row in visibleRows"
        :key="row.session.id"
        type="button"
        class="lineage-row"
        :class="{
          'lineage-row--current': row.session.id === currentSessionId,
          'lineage-row--scheduled': row.isScheduled,
        }"
        :data-session-id="row.session.id"
        :aria-label="`Open session ${row.session.name}`"
        :title="rowTooltip(row)"
        @click="openRow(row.session.id)"
        @keydown.enter="openRow(row.session.id)"
      >
        <span
          class="lineage-gutter"
          :style="{ width: `${gutterWidth}px` }"
          aria-hidden="true"
        >
          <span
            v-for="lane in laneCount"
            :key="lane"
            class="lineage-lane-line"
            :class="{ 'lineage-lane-line--dashed': row.isScheduled }"
            :style="{ left: `${laneOffset(lane - 1)}px` }"
          />
          <span
            class="lineage-node"
            :class="[`lineage-node--${dotKind(row.session)}`, { 'lineage-node--hollow': row.isScheduled }]"
            :style="{ left: `${laneOffset(row.lane)}px` }"
          />
        </span>
        <span class="lineage-main">
          <span class="lineage-top">
            <span
              class="lineage-dot"
              :class="`lineage-dot--${dotKind(row.session)}`"
            />
            <span class="lineage-name">{{ row.session.name }}</span>
            <span
              v-if="row.session.id === currentSessionId"
              class="lineage-current-marker"
            >
              you are here
            </span>
          </span>
          <span class="lineage-meta">
            <span class="lineage-time">{{ rowTimeLabel(row) }}</span>
            <span
              v-if="row.session.model"
              class="lineage-model"
            >
              {{ row.session.model }}
            </span>
          </span>
          <span
            class="lineage-bar"
            aria-hidden="true"
          >
            <span
              class="lineage-bar-fill"
              :class="{ 'lineage-bar-fill--scheduled': row.isScheduled }"
              :style="{ left: `${row.barStartPct}%`, width: `${Math.max(0, row.barEndPct - row.barStartPct)}%` }"
            />
          </span>
        </span>
      </button>
    </div>

    <button
      v-if="rows.length > visibleLimit"
      type="button"
      class="lineage-expander"
      @click="expanded = !expanded"
    >
      {{ expanded ? 'Show fewer' : `Show all ${rows.length} sessions` }}
    </button>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { formatTokenCount } from '@circuschief/shared';

const props = defineProps({
  rows: {
    type: Array,
    default: () => [],
  },
  currentSessionId: {
    type: String,
    default: null,
  },
  tokenTotals: {
    type: Object,
    default: () => ({}),
  },
  visibleLimit: {
    type: Number,
    default: 8,
  },
});

const emit = defineEmits(['open-session']);

function openRow(sessionId) {
  emit('open-session', sessionId);
}

const LANE_PITCH_PX = 10;
const NODE_RADIUS_PX = 5;

const expanded = ref(false);

const laneCount = computed(() =>
  props.rows.reduce((max, row) => Math.max(max, (row.lane || 0) + 1), 1)
);

const gutterWidth = computed(() => (laneCount.value - 1) * LANE_PITCH_PX + NODE_RADIUS_PX * 2 + 2);

const visibleRows = computed(() =>
  expanded.value ? props.rows : props.rows.slice(0, props.visibleLimit)
);

function laneOffset(lane) {
  return NODE_RADIUS_PX + 1 + lane * LANE_PITCH_PX;
}

// emerald running (pulsing) / gray stopped / red error / amber scheduled+waiting+starting
function dotKind(session) {
  const status = session?.status;
  if (status === 'running') return 'running';
  if (status === 'error') return 'error';
  if (status === 'scheduled' || status === 'waiting' || status === 'starting') return 'scheduled';
  return 'stopped';
}

function compactDuration(ms) {
  const abs = Math.abs(ms);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return `${Math.max(1, Math.round(abs / 1000))}s`;
  if (abs < hour) return `${Math.round(abs / minute)}m`;
  if (abs < day) return `${Math.round(abs / hour)}h`;
  return `${Math.round(abs / day)}d`;
}

function rowTimeLabel(row) {
  const session = row.session;
  if (row.isScheduled && session.scheduledAt) {
    return `in ${compactDuration(new Date(session.scheduledAt).getTime() - Date.now())}`;
  }
  const created = new Date(session.createdAt).getTime();
  if (!Number.isFinite(created)) return '';
  return compactDuration(Date.now() - created);
}

function rowEndMs(session) {
  if (session?.status === 'running' || session?.status === 'starting') return Date.now();
  const end = new Date(session?.lastActivityAt ?? session?.updatedAt ?? session?.createdAt).getTime();
  return Number.isFinite(end) ? end : Date.now();
}

function rowTooltip(row) {
  const session = row.session;
  const parts = [session.name];
  if (session.model) parts.push(session.model);
  const total = props.tokenTotals?.[session.id];
  if (typeof total === 'number' && total > 0) parts.push(`${formatTokenCount(total)} tokens`);
  const start = new Date(session.createdAt).getTime();
  const end = row.isScheduled && session.scheduledAt
    ? new Date(session.scheduledAt).getTime()
    : rowEndMs(session);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    parts.push(`span ${compactDuration(end - start)}`);
  }
  if (session.createdAt) parts.push(`created ${new Date(session.createdAt).toLocaleString()}`);
  return parts.join(' · ');
}
</script>

<style scoped>
.lineage-graph {
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}

.lineage-legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.lineage-legend-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-soft);
}

.lineage-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.lineage-rows {
  display: flex;
  flex-direction: column;
}

.lineage-row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
  width: 100%;
  padding: 0.375rem 0.5rem;
  border: none;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.lineage-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.lineage-row:focus-visible {
  outline: 2px solid var(--color-primary, #22c5ff);
  outline-offset: -2px;
}

.lineage-row--current {
  box-shadow: inset 0 0 0 1px var(--color-primary, #22c5ff);
}

.lineage-row--scheduled .lineage-name {
  color: var(--color-text-soft);
}

.lineage-gutter {
  position: relative;
  flex-shrink: 0;
  align-self: stretch;
  min-height: 2.5rem;
}

.lineage-lane-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--color-border);
}

.lineage-lane-line--dashed {
  background: repeating-linear-gradient(
    to bottom,
    var(--color-border) 0 3px,
    transparent 3px 6px
  );
}

.lineage-node {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  margin-top: -5px;
  margin-left: -5px;
  border-radius: 50%;
}

.lineage-node--running {
  background: var(--color-success, #2ea043);
}

.lineage-node--stopped {
  background: #6e7781;
}

.lineage-node--error {
  background: var(--color-error, #cf222e);
}

.lineage-node--scheduled {
  background: var(--color-warning, #d29922);
}

.lineage-node--hollow {
  background: transparent;
  border: 2px solid var(--color-warning, #d29922);
  transform: rotate(45deg);
  border-radius: 2px;
}

.lineage-main {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  flex: 1;
  min-width: 0;
}

.lineage-top {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.lineage-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.lineage-dot--running {
  background: var(--color-success, #2ea043);
  animation: lineage-pulse 2s ease-in-out infinite;
}

.lineage-dot--stopped {
  background: #6e7781;
}

.lineage-dot--error {
  background: var(--color-error, #cf222e);
}

.lineage-dot--scheduled {
  background: var(--color-warning, #d29922);
}

@keyframes lineage-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@media (prefers-reduced-motion: reduce) {
  .lineage-dot--running {
    animation: none;
  }
}

.lineage-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  color: var(--color-text);
}

.lineage-current-marker {
  flex-shrink: 0;
  font-size: 0.6875rem;
  color: var(--color-primary, #22c5ff);
}

.lineage-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.lineage-model {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lineage-bar {
  position: relative;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
}

.lineage-bar-fill {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 2px;
  background: var(--color-text-soft);
  opacity: 0.7;
}

.lineage-bar-fill--scheduled {
  background: transparent;
  border: 1px dashed var(--color-warning, #d29922);
  opacity: 1;
}

.lineage-expander {
  margin-top: 0.375rem;
  padding: 0.25rem 0;
  border: none;
  background: none;
  color: var(--color-primary, #22c5ff);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}

.lineage-expander:hover {
  text-decoration: underline;
}
</style>
