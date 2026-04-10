<template>
  <div>
    <div
      v-if="loading"
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
      v-else-if="sessions.length === 0"
      class="empty-state"
    >
      <p>No scheduled sessions. Use scheduling options when creating a new session to schedule it for later.</p>
    </div>

    <div
      v-else
      class="session-list"
    >
      <ScheduledSessionCard
        v-for="session in sessions"
        :key="session.id"
        :session="session"
      />
    </div>
  </div>
</template>

<script setup>
import ScheduledSessionCard from './ScheduledSessionCard.vue';

defineProps({
  /** Array of scheduled session objects */
  sessions: {
    type: Array,
    required: true,
  },
  /** Whether the scheduled sessions are currently loading */
  loading: {
    type: Boolean,
    default: false,
  },
});
</script>

<style scoped>
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
</style>
