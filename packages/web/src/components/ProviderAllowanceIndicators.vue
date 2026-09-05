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
    <div
      ref="desktopItemsRef"
      class="desktop-items"
    >
      <button
        v-for="snapshot in visibleSnapshots"
        :key="snapshot.providerId"
        class="allowance-item"
        :class="`is-${snapshot.status}`"
        type="button"
        :aria-label="ariaLabel(snapshot)"
        :title="ariaLabel(snapshot)"
        @click="open(snapshot.providerId)"
      >
        <span class="provider-name">{{ snapshot.providerName }}</span>
        <span>{{ compactValue(snapshot) }}</span>
      </button>
      <button
        v-if="hiddenCount"
        type="button"
        class="overflow-button"
        :aria-label="`Show ${hiddenCount} more providers`"
        @click="open()"
      >
        +{{ hiddenCount }}
      </button>
    </div>
    <div
      class="measurement-items"
      aria-hidden="true"
    >
      <span
        v-for="snapshot in snapshots"
        :key="snapshot.providerId"
        ref="measurementItems"
        class="allowance-item"
      >
        <span class="provider-name">{{ snapshot.providerName }}</span>
        <span>{{ compactValue(snapshot) }}</span>
      </span>
      <span
        ref="overflowMeasureRef"
        class="overflow-button"
      >+{{ snapshots.length }}</span>
    </div>
    <button
      type="button"
      class="mobile-button"
      aria-label="Show provider usage"
      @click="open()"
    >
      <span aria-hidden="true">◌</span>
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
              <span v-if="allowance.resetsAt"> · resets {{ formatRelativeTime(allowance.resetsAt) }} (<time :datetime="allowance.resetsAt">{{ formatExactTime(allowance.resetsAt) }}</time>)</span>
            </li>
          </ul>
          <small v-if="snapshot.updatedAt">Last updated {{ formatRelativeTime(snapshot.updatedAt) }} (<time :datetime="snapshot.updatedAt">{{ formatExactTime(snapshot.updatedAt) }}</time>)</small>
          <small v-if="snapshot.status === 'stale'">Last value may be out of date.</small>
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
import { selectVisibleItems } from './providerAllowanceOverflow.js';
import { formatAllowance, formatExactTime, formatRelativeTime, sourceLabel } from './providerAllowanceFormatting.js';

const store = useProviderAllowancesStore();
const { on, off, onReconnect } = useWebSocket();
const isOpen = ref(false);
const focusedProviderId = ref(null);
const dialogRef = ref(null);
const desktopItemsRef = ref(null);
const measurementItems = ref([]);
const overflowMeasureRef = ref(null);
const snapshots = computed(() => store.snapshots);
const attentionCount = computed(() => store.attentionCount);
const visibleCount = ref(0);
const visibleSnapshots = computed(() => snapshots.value.slice(0, visibleCount.value));
const hiddenCount = computed(() => Math.max(0, snapshots.value.length - visibleSnapshots.value.length));
const error = computed(() => store.error);
const liveAnnouncement = ref('');
let removeReconnect = null;
let previousFocus = null;
let resizeObserver = null;
let announcementTimer = null;
let hasObservedSnapshots = false;
let previousStatuses = new Map();

function measureVisibleItems() {
  const availableWidth = desktopItemsRef.value?.getBoundingClientRect().width ?? 0;
  const itemWidths = measurementItems.value.map((item) => item.getBoundingClientRect().width);
  const overflowWidth = overflowMeasureRef.value?.getBoundingClientRect().width ?? 0;
  visibleCount.value = selectVisibleItems(itemWidths, availableWidth, overflowWidth);
}

watch(snapshots, () => nextTick(measureVisibleItems), { flush: 'post' });

function statusText(status) { return status[0].toUpperCase() + status.slice(1); }
function compactValue(snapshot) {
  const allowance = lowestAllowance(snapshot);
  return allowance ? `${Math.round(allowance.remainingPercent)}%` : '—';
}
function ariaLabel(snapshot) {
  const allowance = lowestAllowance(snapshot);
  const value = allowance ? `${Math.round(allowance.remainingPercent)}% remaining in ${allowance.label}` : 'usage unknown';
  const reset = allowance?.resetsAt ? `, resets ${formatReset(allowance.resetsAt)}` : '';
  return `${snapshot.providerName}: ${statusText(snapshot.status)}, ${value}${reset}`;
}
function formatReset(value) { return new Date(value).toLocaleString(); }
function open(providerId = null) {
  previousFocus = document.activeElement;
  focusedProviderId.value = providerId;
  isOpen.value = true;
  nextTick(() => dialogRef.value?.focus());
}
function close() {
  isOpen.value = false;
  focusedProviderId.value = null;
  previousFocus?.focus?.();
}
function focusableDialogElements() {
  return [...(dialogRef.value?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
}
function trapFocus(event) {
  if (event.key !== 'Tab') return;
  const elements = focusableDialogElements();
  if (!elements.length) return;
  const first = elements[0];
  const last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
function handleDocumentKeydown(event) {
  if (isOpen.value && event.key === 'Escape') {
    event.preventDefault();
    close();
  }
}
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
onMounted(() => {
  store.fetch();
  on(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED, onUpdate);
  removeReconnect = onReconnect(() => store.fetch());
  resizeObserver = new ResizeObserver(measureVisibleItems);
  resizeObserver.observe(desktopItemsRef.value);
  document.addEventListener('keydown', handleDocumentKeydown);
  nextTick(measureVisibleItems);
});
onUnmounted(() => {
  off(WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_UPDATED, onUpdate);
  removeReconnect?.();
  resizeObserver?.disconnect();
  clearTimeout(announcementTimer);
  document.removeEventListener('keydown', handleDocumentKeydown);
});
</script>

<style scoped>
.provider-allowances,
.desktop-items {
  display: flex;
  align-items: center;
  gap: .35rem;
  min-width: 0;
}

.allowance-item,
.overflow-button,
.mobile-button,
.close-button {
  border: 0;
  background: transparent;
  color: var(--color-text-soft);
  font: inherit;
  cursor: pointer;
}

.allowance-item {
  display: inline-flex;
  align-items: center;
  gap: .3rem;
  padding: .35rem;
  border-radius: 4px;
  white-space: nowrap;
}

.allowance-item:hover,
.overflow-button:hover {
  background: var(--color-background-mute);
  color: var(--color-text);
}

.provider-name { font-weight: 600; }
.is-warning,
.fetch-error { color: var(--color-warning); }
.is-critical,
.is-exhausted { color: var(--color-error); }
.is-stale { opacity: .68; }

.mobile-button {
  position: relative;
  display: none;
  font-size: 1.25rem;
}

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

.measurement-items {
  position: absolute;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
  white-space: nowrap;
}

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
  .desktop-items { display: none; }
  .mobile-button { display: block; }

  .allowance-dialog {
    align-self: end;
    max-height: 85vh;
    border-radius: 10px 10px 0 0;
  }
}
</style>
