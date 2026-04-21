<template>
  <div
    class="run-timestamps"
    data-testid="run-timestamps"
  >
    <!-- Never run -->
    <template v-if="!run">
      <span
        class="icon"
        aria-hidden="true"
      >⏱</span>
      <span class="muted">Not yet run</span>
    </template>

    <!-- Currently running -->
    <template v-else-if="run.status === 'running'">
      <span
        class="icon"
        aria-hidden="true"
      >⏱</span>
      <span>Started </span>
      <time
        :datetime="toIso(run.startedAt)"
        :title="tooltipFor(run.startedAt)"
        :aria-label="`Started ${tooltipFor(run.startedAt)}`"
        class="ts"
      >{{ formatTime(run.startedAt) }}</time>
      <span class="sep"> · </span>
      <span>Running…</span>
      <span class="sep"> · </span>
      <span
        class="ts elapsed"
        data-testid="run-timestamps-elapsed"
      >{{ elapsedTime }}</span>
    </template>

    <!-- Killed -->
    <template v-else-if="run.status === 'killed'">
      <span
        class="icon"
        aria-hidden="true"
      >⏱</span>
      <span>Started </span>
      <time
        :datetime="toIso(run.startedAt)"
        :title="tooltipFor(run.startedAt)"
        :aria-label="`Started ${tooltipFor(run.startedAt)}`"
        class="ts"
      >{{ formatTime(run.startedAt) }}</time>
      <span class="sep"> · </span>
      <span>Killed at </span>
      <time
        :datetime="toIso(run.completedAt)"
        :title="tooltipFor(run.completedAt)"
        :aria-label="`Killed at ${tooltipFor(run.completedAt)}`"
        class="ts"
      >{{ formatTime(run.completedAt) }}</time>
      <template v-if="run.completedAt">
        <span class="sep"> · </span>
        <span class="ts">{{ formatDuration(run.startedAt, run.completedAt) }}</span>
      </template>
    </template>

    <!-- Completed (success or error) -->
    <template v-else>
      <span
        class="icon"
        aria-hidden="true"
      >⏱</span>
      <span>Started </span>
      <time
        :datetime="toIso(run.startedAt)"
        :title="tooltipFor(run.startedAt)"
        :aria-label="`Started ${tooltipFor(run.startedAt)}`"
        class="ts"
      >{{ formatTime(run.startedAt) }}</time>
      <span class="sep"> · </span>
      <span>Ended </span>
      <time
        :datetime="toIso(run.completedAt)"
        :title="tooltipFor(run.completedAt)"
        :aria-label="`Ended ${tooltipFor(run.completedAt)}`"
        class="ts"
      >{{ formatTime(run.completedAt) }}</time>
      <template v-if="run.completedAt">
        <span class="sep"> · </span>
        <span class="ts">{{ formatDuration(run.startedAt, run.completedAt) }}</span>
      </template>
    </template>
  </div>
</template>

<script setup>
import { computed, defineProps, defineExpose, onBeforeUnmount, ref, watch } from 'vue';
import {
  formatTime,
  formatDuration,
  formatElapsedMMSS,
  toIso,
  absoluteTooltip,
} from '../utils/time.js';

/**
 * Presentational component that displays a command run's start time, end
 * time (or "Running…"), and duration.
 *
 * The single 1-second interval that drives the live elapsed counter lives
 * here (not in the parent `CommandButtonItem`), so that if both the
 * inline timestamps line and the footer `.running-indicator` need to show
 * the same ticking value they can share one source of truth via a template
 * ref (see `defineExpose` below).
 */
const props = defineProps({
  run: {
    type: Object,
    default: null,
  },
});

const elapsedTime = ref('0:00');

// Reactive "now" timestamp that the 1-second interval mutates on every tick
// while a run is live. `tooltipFor` reads `nowTick.value` in its body, so
// Vue's dependency tracker picks up the read and re-evaluates the `:title`
// and `:aria-label` bindings each tick — keeping the relative phrase
// (e.g. "2 minutes ago") fresh without adding another interval.
const nowTick = ref(Date.now());
let intervalId = null;

const isRunning = computed(() => props.run?.status === 'running');

function tick() {
  if (!props.run || props.run.status !== 'running') return;
  nowTick.value = Date.now();
  elapsedTime.value = formatElapsedMMSS(props.run.startedAt, nowTick.value);
}

function startTicking() {
  stopTicking();
  // Reset to a known value on every entry to running state so the counter
  // is deterministic regardless of what the previous (non-running) state
  // left behind.
  elapsedTime.value = '0:00';
  tick();
  intervalId = setInterval(tick, 1000);
}

function stopTicking() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
  // Intentionally do NOT reset `elapsedTime` here: transitioning from
  // running → completed should keep the last-observed counter value
  // (e.g. "0:12") visible to any parent that reads the exposed ref,
  // rather than flicking back to "0:00".
}

// Tooltip string combining absolute and relative time, used for both
// `title` (mouse) and `aria-label` (keyboard / screen reader).
function tooltipFor(ms) {
  // Reading nowTick.value here is what makes the binding reactive while
  // ticking; for idle rows the value is frozen at mount time, which is
  // fine because the tooltip is evaluated synchronously on hover.
  return absoluteTooltip(ms, nowTick.value);
}

// React to status transitions: start/stop the single interval as needed.
watch(
  isRunning,
  (running) => {
    if (running) startTicking();
    else stopTicking();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  stopTicking();
});

// Exposed so `CommandButtonItem` can share the ticking `elapsedTime` value
// with its own `.running-indicator` footer via a template ref.
defineExpose({ elapsedTime });
</script>

<style scoped>
.run-timestamps {
  color: var(--color-text-soft);
  font-size: 0.8rem;
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.15rem;
}

.icon {
  margin-right: 0.25rem;
}

.muted {
  font-style: italic;
  opacity: 0.85;
}

.ts {
  font-family: var(--font-mono);
  color: var(--color-text);
}

.ts.elapsed {
  /* Wider min-width accommodates H:MM:SS output for runs ≥ 1 h without
     causing layout shift when the counter crosses the 1 h boundary. */
  min-width: 3.5rem;
  display: inline-block;
}

.sep {
  opacity: 0.7;
}
</style>
