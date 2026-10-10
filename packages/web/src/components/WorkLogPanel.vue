<template>
  <div
    v-if="workLogs?.length"
    class="work-log-panel"
  >
    <details
      :open="isExpanded"
      data-work-log-details
      @toggle="handleToggle"
    >
      <summary class="work-log-header">
        <span class="work-log-icon">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
          </svg>
        </span>
        <span class="work-log-title">Work Log</span>
        <span class="work-log-count">({{ totalCount }})</span>
        <span
          class="work-log-chevron"
          :class="{ expanded: isExpanded }"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </summary>
      <div
        ref="contentRef"
        class="work-log-content"
        @scroll.passive="handleScroll"
      >
        <!-- Naturally sizing inner content for content-growth observation. -->
        <div
          ref="contentInnerRef"
          class="work-log-content-inner"
        >
          <div
            v-for="log in workLogs"
            :key="log.id"
            class="work-log-item"
          >
            <ThinkingBlock
              v-if="log.type === 'thinking'"
              :content="log.content"
              :timestamp="log.timestamp"
            />
            <CommandBlock
              v-else
              :log="log"
            />
          </div>
        </div>
      </div>
    </details>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import ThinkingBlock from './ThinkingBlock.vue';
import CommandBlock from './CommandBlock.vue';
import { useWorkLogFollow } from '../composables/useWorkLogFollow.js';

const props = defineProps({
  workLogs: { type: Array, default: () => [] },
});

// Work logs in completed messages should always start collapsed
const isExpanded = ref(false);

const totalCount = computed(() => props.workLogs?.length || 0);

function handleToggle(event) {
  isExpanded.value = event.target.open;
}

// Follow mode (FR-9): new arrivals scroll to the newest item while the user
// is near the bottom; scrolling up disengages until they return. Collapsed
// panels never scroll.
const contentRef = ref(null);
const contentInnerRef = ref(null);
const { isNearBottom, handleScroll } = useWorkLogFollow({
  resolveContainer: () => contentRef.value,
  resolveContent: () => contentInnerRef.value,
  // Watching expansion scrolls to newest on open when following — expanding
  // with existing rows otherwise lands at the top (length is unchanged).
  // The isActive gate still blocks scrolling while collapsed, and a
  // scrolled-up user (isNearBottom false) is never yanked.
  watchSources: [() => props.workLogs?.length, () => isExpanded.value],
  isActive: () => isExpanded.value,
});

// Expose for testing
defineExpose({
  isNearBottom,
});
</script>

<style scoped>
.work-log-panel {
  margin-top: 0.75rem;
  border-left: 2px solid var(--color-border);
  padding-left: 0.75rem;
}

.work-log-header {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--color-text-soft);
  padding: 0.25rem 0;
  user-select: none;
  list-style: none;
}

.work-log-header::-webkit-details-marker {
  display: none;
}

.work-log-header:hover {
  color: var(--color-text);
}

.work-log-icon {
  display: flex;
  align-items: center;
  opacity: 0.7;
}

.work-log-title {
  font-weight: 500;
}

.work-log-count {
  opacity: 0.7;
}

.work-log-chevron {
  margin-left: auto;
  display: flex;
  align-items: center;
  transition: transform 0.15s ease;
}

.work-log-chevron.expanded {
  transform: rotate(90deg);
}

/* Inner content wrapper: single child of the scroll box, so it sizes
   naturally with its items and preserves the item spacing. */
.work-log-content-inner {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.work-log-content {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  /* Scroll container for follow mode (FR-9). Short lists render exactly as
     before (no scrollbar); long turns scroll instead of growing the page. */
  max-height: 400px;
  overflow-y: auto;
}

.work-log-item {
  /* No animation needed for collapsed work logs */
}
</style>
