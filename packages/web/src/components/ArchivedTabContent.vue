<template>
  <div>
    <div
      v-if="loading && workspaces.length === 0"
      class="skeleton-list"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="skeleton card"
        style="height: 120px"
      />
    </div>

    <div
      v-else-if="error && workspaces.length === 0"
      class="error-message"
      role="alert"
    >
      {{ error }}
    </div>

    <div
      v-else-if="workspaces.length === 0"
      class="empty-state"
    >
      <p>No archived workspaces. Archive completed workspaces to keep your workspace list tidy.</p>
    </div>

    <div
      v-else
      class="session-list"
    >
      <div
        v-if="error"
        class="error-message"
        role="alert"
      >
        {{ error }}
      </div>
      <SessionCard
        v-for="workspace in workspaces"
        :key="workspace.id"
        :session="workspace"
        :show-summary="true"
        :summary="workspace.summaryPreview ? { shortSummary: workspace.summaryPreview } : null"
        :workflow-aggregate="workspace"
        :show-unarchive="true"
        :can-add-to-board="false"
        :pr-url="workspace.prUrl"
        :pr-summary="workspacePrSummary(workspace)"
        @retry-summary="handleRetrySummary"
        @unarchive="handleUnarchive"
        @star="handleStar"
      />

      <div
        v-if="hasMore"
        class="load-more-container"
      >
        <button
          type="button"
          class="btn btn-secondary"
          :disabled="loadingMore"
          @click="handleLoadMore"
        >
          <span v-if="loadingMore">Loading...</span>
          <span v-else>Load More ({{ remaining }} remaining)</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { workspacePrSummary } from '../utils/workspaceCard.js';
import SessionCard from './SessionCard.vue';

const props = defineProps({
  workspaces: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  loadingMore: {
    type: Boolean,
    default: false,
  },
  error: {
    type: String,
    default: null,
  },
  hasMore: {
    type: Boolean,
    default: false,
  },
  total: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(['retry-summary', 'unarchive', 'star', 'load-more']);

const remaining = computed(() => Math.max(0, props.total - props.workspaces.length));

const handleRetrySummary = sessionId => emit('retry-summary', sessionId);
const handleUnarchive = sessionId => emit('unarchive', sessionId);
const handleStar = session => emit('star', session);
const handleLoadMore = () => emit('load-more');
</script>

<style scoped>
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.error-message {
  color: var(--color-error);
  padding: 1rem;
  background-color: rgba(248, 81, 73, 0.1);
  border-radius: var(--border-radius);
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: var(--color-text-soft);
}

.empty-state p {
  margin-bottom: 1rem;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.load-more-container {
  display: flex;
  justify-content: center;
  padding: 1.5rem;
}
</style>
