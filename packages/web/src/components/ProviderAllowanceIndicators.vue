<template>
  <div
    v-if="snapshots.length || error"
    class="provider-allowances"
    data-testid="provider-allowance-indicators"
  >
    <p
      v-if="error"
      data-testid="provider-allowance-fetch-error"
      class="fetch-error"
    >
      Unable to load provider usage. Showing the last available data when available.
    </p>
    <button
      type="button"
      class="allowance-trigger"
      data-testid="provider-allowance-trigger"
      :class="[`is-${triggerStatus}`, { 'is-stale': triggerStale }]"
      :aria-label="triggerAriaLabel"
      :title="triggerAriaLabel"
      @click="open()"
    >
      <svg
        class="battery-icon"
        aria-hidden="true"
        width="28"
        height="14"
        viewBox="0 0 28 14"
        fill="none"
        focusable="false"
      >
        <rect
          x="1"
          y="1"
          width="22"
          height="12"
          rx="3.5"
          class="battery-outline"
        />
        <rect
          v-if="batteryFillWidth !== null"
          x="3.5"
          y="3.5"
          :width="batteryFillWidth"
          height="7"
          rx="1.75"
          class="battery-fill"
        />
        <path
          d="M13.2 3.2 8.8 8.1h2.9l-1 2.7 4.5-5h-2.9l1-2.6Z"
          class="battery-bolt"
        />
        <rect
          x="24"
          y="4.5"
          width="3"
          height="5"
          rx="1.5"
          class="battery-nub"
        />
      </svg>
      <span
        v-if="attentionCount"
        class="attention-badge"
      >{{ attentionCount }}</span>
    </button>
    <p
      class="live-announcement"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ liveAnnouncement }}
    </p>

    <div
      v-if="isOpen"
      class="dialog-backdrop"
      @click.self="close"
    >
      <section
        ref="dialogRef"
        class="allowance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-allowance-title"
        tabindex="-1"
        @keydown="trapFocus"
      >
        <div class="dialog-heading">
          <h2 id="provider-allowance-title">
            Provider usage
          </h2>
          <button
            ref="closeRef"
            class="close-button"
            type="button"
            aria-label="Close provider usage"
            @click="close"
          >
            ×
          </button>
        </div>
        <article
          v-for="snapshot in snapshots"
          :key="snapshot.providerId"
          class="provider-detail"
          :class="{ focused: snapshot.providerId === focusedProviderId }"
        >
          <header>
            <strong>{{ snapshot.providerName }}</strong>
            <span :class="`status is-${snapshot.status}`">
              {{ statusText(snapshot.status) }}
            </span>
          </header>
          <p class="source">
            Source: {{ sourceLabel(snapshot.source) }}
          </p>
          <p
            v-if="!snapshot.allowances.length"
            class="unavailable"
          >
            {{ snapshot.unavailableReason || 'Usage data is unavailable.' }}
          </p>
          <ul v-else>
            <li
              v-for="allowance in snapshot.allowances"
              :key="allowance.key"
            >
              <strong>{{ allowance.label }}</strong>: {{ formatAllowance(allowance) }}
              <span v-if="allowance.resetsAt"> · resets {{ formatRelativeTime(allowance.resetsAt) }} (<time :datetime="formatDateTime(allowance.resetsAt)">{{ formatExactTime(allowance.resetsAt) }}</time>)</span>
              <div
                v-if="barPercent(allowance) !== null"
                class="allowance-bar"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="barPercent(allowance)"
                :aria-label="`${allowance.label}: ${barPercent(allowance)} percent remaining`"
              >
                <span
                  class="allowance-bar-fill"
                  :class="`fill-${snapshot.status}`"
                  :style="{ width: `${barPercent(allowance)}%` }"
                />
              </div>
            </li>
          </ul>
          <small v-if="snapshot.updatedAt">Last updated {{ formatRelativeTime(snapshot.updatedAt) }} (<time :datetime="formatDateTime(snapshot.updatedAt)">{{ formatExactTime(snapshot.updatedAt) }}</time>)</small>
          <small v-if="snapshot.stale">Last value may be out of date.</small>
        </article>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { ProviderAllowanceUpdatedPayload } from '@circuschief/shared/contracts/providers';
import { useWebSocket } from '../composables/useWebSocket.js';
import { useProviderAllowancesStore, lowestAllowance } from '../stores/providerAllowances.js';
import { formatAllowance, formatDateTime, formatExactTime, formatRelativeTime, sourceLabel } from './providerAllowanceFormatting.js';

const DIALOG_FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const store = useProviderAllowancesStore();
const { on, off, onReconnect } = useWebSocket();
const isOpen = ref(false);
const focusedProviderId = ref(null);
const dialogRef = ref(null);
const snapshots = computed(() => store.snapshots);
const attentionCount = computed(() => store.attentionCount);
// Worst status wins for the single trigger: exhausted outranks critical,
// critical outranks warning, and everything outranks ok/unknown. Ties break
// toward the lowest remaining percentage.
const STATUS_SEVERITY = { exhausted: 0, critical: 1, warning: 2 };
const BATTERY_FILL_MAX_WIDTH = 17;
const worstSnapshot = computed(() => {
  let worst = null;
  let worstSeverity = Number.POSITIVE_INFINITY;
  let worstPercent = Number.POSITIVE_INFINITY;
  for (const snapshot of snapshots.value) {
    const severity = STATUS_SEVERITY[snapshot.status] ?? 3;
    const allowance = lowestAllowance(snapshot);
    const percent = allowance ? allowance.remainingPercent : Number.POSITIVE_INFINITY;
    if (severity < worstSeverity || (severity === worstSeverity && percent < worstPercent)) {
      worst = snapshot;
      worstSeverity = severity;
      worstPercent = percent;
    }
  }
  return worst;
});
const triggerStatus = computed(() => worstSnapshot.value?.status ?? 'unknown');
const triggerStale = computed(() => worstSnapshot.value?.stale ?? false);
const triggerPercent = computed(() => {
  let percent = null;
  for (const snapshot of snapshots.value) {
    const allowance = lowestAllowance(snapshot);
    if (allowance && (percent === null || allowance.remainingPercent < percent)) {
      percent = allowance.remainingPercent;
    }
  }
  if (percent === null || !Number.isFinite(Number(percent))) return null;
  return Math.min(100, Math.max(0, Math.round(Number(percent))));
});
const batteryFillWidth = computed(() => (
  triggerPercent.value === null
    ? null
    : Math.round((triggerPercent.value / 100) * BATTERY_FILL_MAX_WIDTH * 100) / 100
));
const worstAllowance = computed(() => {
  let worst = null;
  for (const snapshot of snapshots.value) {
    const allowance = lowestAllowance(snapshot);
    if (allowance && (!worst || allowance.remainingPercent < worst.remainingPercent)) {
      worst = allowance;
    }
  }
  return worst;
});
const triggerAriaLabel = computed(() => {
  const value = triggerPercent.value !== null
    ? `${triggerPercent.value}% remaining`
    : 'usage unknown';
  const reset = worstAllowance.value?.resetsAt
    ? `, resets ${new Date(worstAllowance.value.resetsAt).toLocaleString()}`
    : '';
  return `Provider usage: ${statusText(triggerStatus.value)}, ${value}${reset}`;
});
const error = computed(() => store.error);
const liveAnnouncement = ref('');
let removeReconnect = null;
let previousFocus = null;
let announcementTimer = null;
let hasObservedSnapshots = false;
let previousStatuses = new Map();
const PRIORITY_REFRESH_DEBOUNCE_MS = 75;
let priorityRefreshTimer = null;
let priorityRefreshInFlight = false;
let priorityRefreshPending = false;
// Last seen { status, providerId } per session id, so SESSION_UPDATED frames
// that cannot change allowance priority skip the refetch. FIFO-capped so a
// long-lived page cannot grow it without bound: an evicted session simply
// looks unknown again and falls back to a refetch, which is always safe.
const SESSION_PRIORITY_MEMO_MAX = 500;
const sessionPriorityMemo = new Map();

function statusText(status) {
  const text = status ?? 'unknown';
  return text[0].toUpperCase() + text.slice(1);
}
function barPercent(allowance) {
  const raw = allowance?.remainingPercent;
  if (raw === null || raw === undefined || raw === '') return null;
  const percent = Number(raw);
  if (!Number.isFinite(percent)) return null;
  return Math.min(100, Math.max(0, Math.round(percent)));
}
function open(providerId = null) {
  previousFocus = document.activeElement;
  focusedProviderId.value = providerId;
  isOpen.value = true;
  nextTick(() => dialogRef.value?.focus());
}
function close() {
  isOpen.value = false;
  focusedProviderId.value = null;
  if (previousFocus?.isConnected) previousFocus.focus();
  previousFocus = null;
}
function focusableDialogElements() {
  return [...(dialogRef.value?.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR) ?? [])];
}
function trapFocus(event) {
  if (event.key !== 'Tab') return;
  const dialog = dialogRef.value;
  const elements = focusableDialogElements();
  if (!elements.length) {
    event.preventDefault();
    dialog?.focus();
    return;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && (document.activeElement === dialog || document.activeElement === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    dialog?.focus();
  }
}
function handleDocumentKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}
function containFocus(event) {
  if (isOpen.value && !dialogRef.value?.contains(event.target)) dialogRef.value?.focus();
}
watch(isOpen, (dialogOpen) => {
  const action = dialogOpen ? 'addEventListener' : 'removeEventListener';
  document[action]('keydown', handleDocumentKeydown);
  document[action]('focusin', containFocus);
});
function queueAttentionAnnouncement(snapshot) {
  clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => {
    liveAnnouncement.value = `${snapshot.providerName} usage is ${statusText(snapshot.status).toLowerCase()}.`;
  });
}
watch(snapshots, (nextSnapshots) => {
  const nextStatuses = new Map(nextSnapshots.map((snapshot) => [snapshot.providerId, snapshot.status]));
  if (hasObservedSnapshots) {
    for (const snapshot of nextSnapshots) {
      if (['critical', 'exhausted'].includes(snapshot.status) && !['critical', 'exhausted'].includes(previousStatuses.get(snapshot.providerId))) {
        queueAttentionAnnouncement(snapshot);
      }
    }
  }
  previousStatuses = nextStatuses;
  hasObservedSnapshots = true;
}, { deep: true });
function onUpdate(message) {
  const parsed = ProviderAllowanceUpdatedPayload.safeParse(message);
  if (!parsed.success) {
    console.warn('Dropped invalid provider allowance websocket payload');
    return;
  }
  store.replace(parsed.data.snapshot);
}
function requestPriorityRefresh(immediate = false) {
  // The server owns the complete active-session ordering. Event payloads only
  // tell us that it may have changed, never enough to reconstruct it safely.
  if (immediate) {
    if (priorityRefreshTimer) {
      clearTimeout(priorityRefreshTimer);
      priorityRefreshTimer = null;
    }
    priorityRefreshPending = true;
    if (priorityRefreshInFlight) {
      return;
    }
    priorityRefreshInFlight = true;
    queueMicrotask(async () => {
      // Coalesce the current burst before the fetch begins. Events received
      // while it is in flight request exactly one trailing reconciliation.
      priorityRefreshPending = false;
      try { await store.fetch(); } finally {
        priorityRefreshInFlight = false;
        if (priorityRefreshPending) requestPriorityRefresh(true);
      }
    });
    return;
  }
  priorityRefreshPending = true;
  if (priorityRefreshTimer || priorityRefreshInFlight) return;
  priorityRefreshTimer = setTimeout(async () => {
    priorityRefreshTimer = null;
    if (!priorityRefreshPending) return;
    priorityRefreshPending = false;
    priorityRefreshInFlight = true;
    try { await store.fetch(); } finally {
      priorityRefreshInFlight = false;
      // Any event arriving during a request receives one trailing refresh.
      if (priorityRefreshPending) requestPriorityRefresh();
    }
  }, PRIORITY_REFRESH_DEBOUNCE_MS);
}
function rememberSessionPriority(session) {
  const priority = { status: session.status, providerId: session.providerId };
  const previous = sessionPriorityMemo.get(session.id);
  sessionPriorityMemo.set(session.id, priority);
  if (sessionPriorityMemo.size > SESSION_PRIORITY_MEMO_MAX) {
    sessionPriorityMemo.delete(sessionPriorityMemo.keys().next().value);
  }
  return previous;
}
function hasSessionPriorityShape(session) {
  return session && typeof session === 'object'
    && typeof session.id === 'string' && typeof session.providerId === 'string'
    && typeof session.status === 'string';
}
function isActiveSessionStatus(status) {
  return status === 'starting' || status === 'running';
}
function reconcileSessionPriority(message) {
  // The REST response has the complete, authoritative active-session order.
  // A single session event cannot safely reconstruct it client-side, so any
  // priority-relevant change refetches.
  const session = message?.session;
  if (!session || typeof session !== 'object') {
    // Unknown payload shape: fetch rather than silently skip.
    requestPriorityRefresh(true);
    return;
  }
  // Without a stable session identity nothing may be memoized: an id-less
  // payload refetches fail-safe and must never suppress a later
  // authoritative update via an `undefined`-keyed memo entry.
  if (!hasSessionPriorityShape(session)) {
    requestPriorityRefresh(true);
    return;
  }
  // Priority depends only on which providers have sessions in
  // starting/running — i.e. on status and providerId. Field-only changes
  // (title, model, summary, …) cannot reorder the indicators.
  const priority = { status: session.status, providerId: session.providerId };
  const previous = rememberSessionPriority(session);
  const priorityChanged = !previous
    || previous.status !== priority.status
    || previous.providerId !== priority.providerId;
  if (priorityChanged) requestPriorityRefresh(true);
}
function reconcileSessionCreated(message) {
  const session = message?.session;
  if (!hasSessionPriorityShape(session)) {
    requestPriorityRefresh(true);
    return;
  }
  rememberSessionPriority(session);
  // A newly created waiting session cannot be active yet, so it cannot
  // reorder the indicator. All active starts reconcile immediately.
  if (isActiveSessionStatus(session.status)) requestPriorityRefresh(true);
}
function reconcileSessionDeleted(message) {
  const sessionId = typeof message?.sessionId === 'string'
    ? message.sessionId
    : typeof message?.session?.id === 'string' ? message.session.id : null;
  if (!sessionId) {
    requestPriorityRefresh(true);
    return;
  }
  // A session id can be reused by later lifecycle traffic; never let its old
  // status/provider pairing suppress the next authoritative reconciliation.
  sessionPriorityMemo.delete(sessionId);
  requestPriorityRefresh(true);
}
const onPriorityInvalidated = () => requestPriorityRefresh();
const onListInvalidated = () => requestPriorityRefresh();
onMounted(() => {
  store.fetch();
  on(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED, onUpdate);
  on(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_PRIORITY_INVALIDATED, onPriorityInvalidated);
  on(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_LIST_INVALIDATED, onListInvalidated);
  on(WS_MESSAGE_TYPES.SESSION_UPDATED, reconcileSessionPriority);
  on(WS_MESSAGE_TYPES.SESSION_CREATED, reconcileSessionCreated);
  on(WS_MESSAGE_TYPES.SESSION_DELETED, reconcileSessionDeleted);
  removeReconnect = onReconnect(() => store.fetch());
});
onUnmounted(() => {
  off(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED, onUpdate);
  off(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_PRIORITY_INVALIDATED, onPriorityInvalidated);
  off(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_LIST_INVALIDATED, onListInvalidated);
  off(WS_MESSAGE_TYPES.SESSION_UPDATED, reconcileSessionPriority);
  off(WS_MESSAGE_TYPES.SESSION_CREATED, reconcileSessionCreated);
  off(WS_MESSAGE_TYPES.SESSION_DELETED, reconcileSessionDeleted);
  sessionPriorityMemo.clear();
  removeReconnect?.();
  clearTimeout(announcementTimer);
  clearTimeout(priorityRefreshTimer);
  priorityRefreshTimer = null;
  priorityRefreshPending = false;
  document.removeEventListener('keydown', handleDocumentKeydown);
  document.removeEventListener('focusin', containFocus);
});
</script>

<style scoped>
.provider-allowances {
  display: flex;
  align-items: center;
  min-width: 0;
}

.allowance-trigger,
.close-button {
  border: 0;
  background: transparent;
  color: var(--color-text-soft);
  font: inherit;
  cursor: pointer;
}

.allowance-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: .35rem;
  border-radius: 4px;
  line-height: 0;
}

.allowance-trigger:hover {
  background: var(--color-background-mute);
  color: var(--color-text);
}

.battery-icon { display: block; }

.battery-outline,
.battery-nub {
  stroke: currentColor;
  stroke-width: 1.5;
}

.battery-outline { fill: none; }
.battery-nub { fill: currentColor; }

.battery-fill { fill: var(--color-success); }
.battery-bolt { fill: var(--color-background-soft); }

.is-warning .battery-fill { fill: var(--color-warning); }
.is-critical .battery-fill,
.is-exhausted .battery-fill { fill: var(--color-error); }

.is-warning,
.fetch-error { color: var(--color-warning); }
.is-critical,
.is-exhausted { color: var(--color-error); }
.is-stale { opacity: .68; }

.attention-badge {
  position: absolute;
  top: -.35rem;
  right: -.5rem;
  min-width: 1rem;
  height: 1rem;
  border-radius: 99px;
  background: var(--color-error);
  color: var(--color-text);
  font-size: .65rem;
  line-height: 1rem;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(0, 0, 0, .42);
}

.allowance-dialog {
  width: min(36rem, 100%);
  max-height: 80vh;
  padding: 1rem;
  overflow: auto;
  outline: none;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-background-soft);
  color: var(--color-text);
  box-shadow: 0 20px 50px rgba(0, 0, 0, .3);
}

.dialog-heading,
.provider-detail header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dialog-heading h2 { margin: 0; }
.close-button { font-size: 1.6rem; }

.provider-detail {
  padding: .8rem 0;
  border-top: 1px solid var(--color-border);
}

.provider-detail.focused {
  background: color-mix(in srgb, var(--color-warning) 8%, transparent);
}

.provider-detail p,
.provider-detail ul { margin: .45rem 0; }

.provider-detail small {
  display: block;
  margin-top: .3rem;
  color: var(--color-text-soft);
}

.status { font-size: .8rem; }

.allowance-bar {
  height: .5rem;
  margin-top: .4rem;
  overflow: hidden;
  border-radius: 99px;
  background: var(--color-background-mute);
}

.allowance-bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--color-success);
}

.allowance-bar-fill.fill-warning { background: var(--color-warning); }
.allowance-bar-fill.fill-critical,
.allowance-bar-fill.fill-exhausted { background: var(--color-error); }

.live-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
  white-space: nowrap;
}

@media (max-width: 480px) {
  .allowance-dialog {
    align-self: end;
    max-height: 85vh;
    border-radius: 10px 10px 0 0;
  }
}
</style>
