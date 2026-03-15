<template>
  <div>
    <div v-if="sessionsStore.archivedPagination.loading && sessionsStore.archivedSessions.length === 0" class="skeleton-list">
      <div v-for="i in 3" :key="i" class="skeleton card" style="height: 120px"></div>
    </div>

    <div v-else-if="sessionsStore.error" class="error-message">
      {{ sessionsStore.error }}
    </div>

    <div v-else-if="sessionsStore.archivedSessions.length === 0" class="empty-state">
      <p>No archived sessions. Archive completed sessions to keep your session list tidy.</p>
    </div>

    <div v-else class="session-list">
      <SessionCard
        v-for="session in sessionsStore.archivedSessions"
        :key="session.id"
        :session="session"
        :show-summary="true"
        :summary="summaries[session.id]"
        :summary-loading="loadingSummaries[session.id]"
        :summary-error="summaryErrors[session.id]"
        :show-unarchive="true"
        :pr-url="session.prUrl"
        :pr-summary="summaries[session.id]"
        @retry-summary="$emit('retrySummary', $event)"
        @unarchive="$emit('unarchive', $event)"
      />

      <!-- Load More Button -->
      <div v-if="sessionsStore.archivedPagination.hasMore" class="load-more-container">
        <button
          class="btn btn-secondary"
          :disabled="sessionsStore.archivedPagination.loading"
          @click="$emit('loadMore')"
        >
          <span v-if="sessionsStore.archivedPagination.loading">Loading...</span>
          <span v-else>Load More ({{ archivedRemaining }} remaining)</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import SessionCard from './SessionCard.vue';

defineProps({
  /** Summaries keyed by session ID */
  summaries: {
    type: Object,
    required: true,
  },
  /** Loading states keyed by session ID */
  loadingSummaries: {
    type: Object,
    required: true,
  },
  /** Error states keyed by session ID */
  summaryErrors: {
    type: Object,
    required: true,
  },
});

defineEmits(['retrySummary', 'unarchive', 'loadMore']);

const sessionsStore = useSessionsStore();

const archivedRemaining = computed(() => {
  const { total, offset } = sessionsStore.archivedPagination;
  return Math.max(0, total - offset);
});
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
