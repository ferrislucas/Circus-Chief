<template>
  <span
    v-if="isQueued"
    class="status-badge status-queued"
    data-testid="queued-badge"
    :title="causeTitle"
  >Queued<span v-if="queuePosition != null">&nbsp;#{{ queuePosition }}</span></span>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  /** Limited-lane queue derivation (`'running' | 'queued'`). */
  entryState: { type: String, default: null },
  /** Disabled-lane queue derivation (`'queued'` when parked by a paused lane). */
  entryStatus: { type: String, default: null },
  /** 1-based queue position, or null when unknown. */
  queuePosition: { type: Number, default: null },
  /** Queue cause override: 'paused' (lane automation off) or 'concurrency' (limit reached). */
  cause: { type: String, default: null },
  /** Archived workspaces never render a queued badge (archive clears queue state). */
  archived: { type: Boolean, default: false },
});

/**
 * Either server queue derivation counts as queued until the derivations are
 * unified (TODO(issue-25)). An explicit running entry state wins over a stale
 * disabled-lane marker; absence/unknown reads as not queued: no badge is
 * better than a stale badge.
 */
const isQueued = computed(() => {
  if (props.archived) return false;
  if (props.entryState === 'queued') return true;
  if (props.entryState != null) return false;
  return props.entryStatus === 'queued';
});

const resolvedCause = computed(() => {
  if (props.cause === 'paused' || props.cause === 'concurrency') return props.cause;
  // The disabled-lane marker alone means the lane is paused; the limited-lane
  // marker means the entry waits for a slot.
  if (props.entryStatus === 'queued') return 'paused';
  return 'concurrency';
});

const causeTitle = computed(() =>
  resolvedCause.value === 'paused'
    ? 'Automation for this lane is paused; the entry runs when the lane is re-enabled'
    : 'Queued behind the lane concurrency limit; the entry starts when a slot frees'
);
</script>
