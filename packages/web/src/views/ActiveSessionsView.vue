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
            <a
              v-if="session.prUrl"
              :href="session.prUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="pr-link"
              @click.stop
            >
              <svg class="pr-icon" viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
              </svg>
              PR
            </a>
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

.pr-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.125rem 0.375rem;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--color-primary);
  background: var(--color-primary-soft);
  border-radius: 3px;
  text-decoration: none;
  transition: background-color 0.2s, color 0.2s;
}

.pr-link:hover {
  background: var(--color-primary);
  color: white;
}

.pr-icon {
  width: 12px;
  height: 12px;
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
