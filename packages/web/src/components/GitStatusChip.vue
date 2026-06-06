<template>
  <button
    type="button"
    class="git-status-chip"
    :class="{
      'is-actionable': hasActionableStatus,
      'is-loading': loading,
      'is-unknown': error && !hasActionableStatus,
    }"
    :title="summaryText"
    @click="goToChanges"
  >
    <span
      class="git-status-dot"
      aria-hidden="true"
    />
    <span class="git-status-text">{{ displayText }}</span>
  </button>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
  sessionId: { type: String, required: true },
  summaryText: { type: String, default: 'Git status unknown' },
  loading: { type: Boolean, default: false },
  error: { type: [Object, String], default: null },
  hasActionableStatus: { type: Boolean, default: false },
});

const router = useRouter();

const displayText = computed(() => {
  if (props.loading && !props.summaryText) return 'Checking Git...';
  return props.summaryText || 'Git status unknown';
});

function goToChanges() {
  router.push(`/sessions/${props.sessionId}/changes`);
}
</script>

<style scoped>
.git-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 1.5rem;
  max-width: min(100%, 28rem);
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-soft, rgba(255, 255, 255, 0.05));
  color: var(--color-text-soft);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  line-height: 1;
  transition: background-color 0.15s, border-color 0.15s, color 0.15s;
}

.git-status-chip:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text, #e0e0e0);
}

.git-status-chip.is-actionable {
  border-color: rgba(245, 158, 11, 0.45);
  background: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
}

.git-status-chip.is-unknown {
  border-color: rgba(156, 163, 175, 0.35);
}

.git-status-dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.65;
  flex-shrink: 0;
}

.git-status-chip.is-loading .git-status-dot {
  animation: git-status-pulse 1s ease-in-out infinite;
}

.git-status-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes git-status-pulse {
  50% { opacity: 0.3; }
}
</style>
