<template>
  <div class="child-sessions-panel">
    <div class="panel-header" @click="isExpanded = !isExpanded">
      <h4 class="panel-title">
        <span class="expand-icon">{{ isExpanded ? '▼' : '▶' }}</span>
        Child Sessions ({{ sessions.length }})
      </h4>
    </div>

    <div v-if="isExpanded" class="panel-content">
      <div class="child-sessions-list">
        <router-link
          v-for="session in sessions"
          :key="session.id"
          :to="`/sessions/${session.id}`"
          class="child-session-item"
        >
          <div class="child-session-info">
            <div class="child-session-name">{{ session.name }}</div>
            <div class="child-session-meta">
              <span :class="['status-badge', `status-${session.status}`]">{{ session.status }}</span>
              <span class="child-session-date">{{ formatDate(session.createdAt) }}</span>
            </div>
          </div>
          <div class="child-session-arrow">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </div>
        </router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

defineProps({
  sessions: {
    type: Array,
    required: true,
  },
  parentSessionId: {
    type: String,
    required: true,
  },
});

const isExpanded = ref(true);

const formatDate = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;

  // Today
  if (diffMs < 86400000) {
    return `at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  // Within a week
  if (diffMs < 604800000) {
    return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  // Older
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
</script>

<style scoped>
.child-sessions-panel {
  margin-top: 1.5rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius, 8px);
  background: var(--color-background-secondary, rgba(0, 0, 0, 0.1));
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background-color 0.15s;
}

.panel-header:hover {
  background-color: var(--color-bg-soft, rgba(255, 255, 255, 0.05));
}

.panel-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-soft);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.expand-icon {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.panel-content {
  border-top: 1px solid var(--color-border);
}

.child-sessions-list {
  padding: 0.5rem;
}

.child-session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  border-radius: var(--border-radius, 6px);
  text-decoration: none;
  color: var(--color-text);
  transition: background-color 0.15s;
  margin-bottom: 0.5rem;
}

.child-session-item:last-child {
  margin-bottom: 0;
}

.child-session-item:hover {
  background-color: var(--color-bg-soft, rgba(255, 255, 255, 0.05));
}

.child-session-info {
  flex: 1;
  min-width: 0;
}

.child-session-name {
  font-size: 0.9rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.child-session-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.child-session-date {
  opacity: 0.7;
}

.child-session-arrow {
  flex-shrink: 0;
  color: var(--color-text-soft);
  margin-left: 0.5rem;
}
</style>
