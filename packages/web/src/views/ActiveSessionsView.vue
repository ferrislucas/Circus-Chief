<template>
  <div class="container">
    <div class="page-header">
      <div>
        <router-link to="/" class="back-link">&larr; Projects</router-link>
        <h1>Active Sessions</h1>
        <p class="page-description">Sessions that are running or waiting for input</p>
      </div>
    </div>

    <div v-if="sessionsStore.loading" class="skeleton-list">
      <div v-for="i in 3" :key="i" class="skeleton card" style="height: 80px"></div>
    </div>

    <div v-else-if="sessionsStore.error" class="error-message">
      {{ sessionsStore.error }}
    </div>

    <div v-else-if="sessionsStore.activeSessions.length === 0" class="empty-state">
      <p>No active sessions. All sessions are completed or there are no sessions yet.</p>
      <router-link to="/" class="btn btn-primary">View Projects</router-link>
    </div>

    <div v-else class="session-list">
      <router-link
        v-for="session in sessionsStore.activeSessions"
        :key="session.id"
        :to="`/sessions/${session.id}`"
        class="session-card card"
      >
        <div class="session-info">
          <h3 class="session-name">{{ session.name }}</h3>
          <p class="session-meta">
            <span :class="['status-badge', `status-${session.status}`]">{{ session.status }}</span>
            <span class="session-mode">{{ session.mode }}</span>
            <span v-if="session.gitBranch" class="session-branch">{{ session.gitBranch }}</span>
          </p>
          <p class="session-project">
            <span class="project-name">{{ session.projectName }}</span>
          </p>
        </div>
        <div class="session-date">
          {{ formatDate(session.updatedAt) }}
        </div>
      </router-link>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';

const sessionsStore = useSessionsStore();

let refreshInterval = null;

onMounted(() => {
  sessionsStore.fetchActiveSessions();

  // Auto-refresh every 10 seconds
  refreshInterval = setInterval(() => {
    sessionsStore.fetchActiveSessions(false);
  }, 10000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 2rem;
}

.back-link {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  display: inline-block;
  margin-bottom: 0.5rem;
}

.page-header h1 {
  margin: 0;
}

.page-description {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

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

.session-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--color-text);
  text-decoration: none;
  transition: border-color 0.2s;
}

.session-card:hover {
  border-color: var(--color-primary);
  text-decoration: none;
}

.session-name {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.session-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.session-mode {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  text-transform: capitalize;
}

.session-branch {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  font-family: var(--font-mono);
}

.session-project {
  margin: 0.5rem 0 0;
}

.project-name {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.session-date {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}
</style>
