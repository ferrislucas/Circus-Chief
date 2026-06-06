<template>
  <section
    class="git-status-summary"
    :class="{ 'is-muted': !hasAttention }"
  >
    <div class="git-status-copy">
      <div class="git-status-title">
        {{ title }}
      </div>
      <div class="git-status-counts">
        {{ summaryText }}
      </div>
      <div
        v-if="branchMapping"
        class="git-status-branch"
      >
        {{ branchMapping }}
      </div>
      <div
        v-if="lastCheckedText"
        class="git-status-checked"
      >
        Last checked {{ lastCheckedText }}
      </div>
      <div
        v-if="error"
        class="git-status-error"
      >
        {{ errorMessage }}
      </div>
    </div>
    <button
      type="button"
      class="btn-secondary refresh-origin-button"
      :disabled="loading"
      @click="refreshOrigin"
    >
      <span
        v-if="loading"
        class="loading-spinner"
      />
      Refresh from origin
    </button>
  </section>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  status: { type: Object, default: null },
  summaryText: { type: String, default: 'Git status unknown' },
  loading: { type: Boolean, default: false },
  error: { type: [Object, String], default: null },
});

const emit = defineEmits(['refreshOrigin']);

function refreshOrigin() {
  emit('refreshOrigin');
}

const hasAttention = computed(() => {
  const status = props.status;
  return Boolean(
    props.error ||
    status?.localChangeCount > 0 ||
    status?.aheadCount > 0 ||
    status?.behindCount > 0 ||
    status?.syncStatus === 'unpublished'
  );
});

const title = computed(() => hasAttention.value ? 'Git attention' : 'Git status');

const branchMapping = computed(() => {
  if (!props.status?.currentBranch) return null;
  if (!props.status.upstreamBranch) return `${props.status.currentBranch} has no upstream`;
  return `${props.status.currentBranch} -> ${props.status.upstreamBranch}`;
});

const lastCheckedText = computed(() => {
  if (!props.status?.lastCheckedAt) return null;
  return new Date(props.status.lastCheckedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
});

const errorMessage = computed(() => {
  if (!props.error) return null;
  return typeof props.error === 'string' ? props.error : props.error.message || 'Git status lookup failed';
});
</script>

<style scoped>
.git-status-summary {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
  padding: 0.75rem;
  border: 1px solid rgba(245, 158, 11, 0.45);
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.1);
}

.git-status-summary.is-muted {
  border-color: var(--color-border);
  background: var(--color-bg-soft, rgba(255, 255, 255, 0.04));
}

.git-status-copy {
  min-width: 0;
}

.git-status-title {
  color: var(--color-text, #e0e0e0);
  font-size: 0.875rem;
  font-weight: 600;
}

.git-status-counts {
  margin-top: 0.25rem;
  color: var(--color-text, #e0e0e0);
  font-size: 0.8125rem;
}

.git-status-branch,
.git-status-checked {
  margin-top: 0.25rem;
  color: var(--color-text-soft, #9ca3af);
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.git-status-error {
  margin-top: 0.375rem;
  color: var(--color-error, #f87171);
  font-size: 0.75rem;
}

.refresh-origin-button {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .git-status-summary {
    flex-direction: column;
    gap: 0.75rem;
  }

  .refresh-origin-button {
    width: 100%;
  }
}
</style>
