<template>
  <div class="card-header">
    <SessionRunningSpinner :active="isRunning" />
    <span
      v-if="!isRunning"
      class="card-status"
      :class="`status-${session.status}`"
    >{{ statusIndicator }}</span>
    <h4 class="card-title">
      {{ session.name }}
    </h4>
  </div>
  <div class="card-meta">
    <span
      v-if="sessions.some((item) => item.pendingAgentInput)"
      class="status-badge status-waiting"
      aria-label="Agent input required"
    >needs input</span>
    <span
      v-if="session.mode"
      class="card-mode"
    >{{ session.mode }}</span>
    <PrIndicators
      v-if="session.prUrl"
      :pr-url="session.prUrl"
    />
  </div>
  <div
    v-if="scheduledInfo?.showBadge"
    class="card-scheduled-info"
  >
    <span class="status-badge status-scheduled">
      <KanbanBoardIcon
        name="schedule"
        class="schedule-icon-inline"
      />
      scheduled
    </span>
    <span
      v-if="scheduledInfo.timeDisplay"
      class="scheduled-time"
      :title="scheduledInfo.absoluteTime"
    >{{ scheduledInfo.timeDisplay }}</span>
  </div>
  <details
    v-if="activeLaneRun"
    class="lane-run-status"
    :class="`lane-run-${activeLaneRun.status}`"
    @click.stop
  >
    <summary><span class="lane-run-dot" />{{ laneRunLabel(activeLaneRun) }}</summary>
    <div class="lane-run-details">
      <strong>{{ activeLaneRun.sourceLaneName || lane.name }} automation</strong>
      <span v-if="activeLaneRun.blockingReason">{{ activeLaneRun.blockingReason }}</span>
      <span v-if="activeLaneRun.openCount">{{ activeLaneRun.openCount }} blocking {{ activeLaneRun.openCount === 1 ? 'session' : 'sessions' }} remain</span>
      <time v-if="activeLaneRun.nextScheduledAt">Next: {{ formatLaneRunTime(activeLaneRun.nextScheduledAt) }}</time>
      <router-link
        v-if="activeLaneRun.status === 'failed' && activeLaneRun.failedSessionId"
        :to="`/sessions/${activeLaneRun.failedSessionId}`"
        class="lane-run-blocker-link"
      >
        Open failed session
      </router-link>
      <router-link
        v-else-if="activeLaneRun.blockingSessionId"
        :to="`/sessions/${activeLaneRun.blockingSessionId}`"
        :class="['lane-run-blocker-link', { 'lane-run-resume-link': isPausedLaneRun(activeLaneRun) }]"
      >
        {{ isPausedLaneRun(activeLaneRun) ? 'Resume' : 'View blocker' }}
      </router-link>
    </div>
  </details>
</template>

<script setup>
import PrIndicators from './PrIndicators.vue';
import SessionRunningSpinner from './SessionRunningSpinner.vue';
import KanbanBoardIcon from './KanbanBoardIcon.vue';
import { laneRunLabel, formatLaneRunTime, isPausedLaneRun } from '../composables/useLaneRunStatus.js';

defineProps({
  session: { type: Object, required: true },
  sessions: { type: Array, default: () => [] },
  lane: { type: Object, required: true },
  isRunning: Boolean,
  statusIndicator: { type: String, required: true },
  scheduledInfo: { type: Object, default: null },
  activeLaneRun: { type: Object, default: null },
});
</script>
