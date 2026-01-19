<template>
  <nav class="session-breadcrumb" aria-label="Session hierarchy">
    <ol class="breadcrumb-list">
      <li
        v-for="(session, index) in path"
        :key="session.id"
        class="breadcrumb-item"
      >
        <router-link
          v-if="session.id !== currentSessionId"
          :to="`/sessions/${session.id}/conversation`"
          class="breadcrumb-link"
          :title="session.name"
        >
          {{ truncateName(session.name) }}
        </router-link>
        <span
          v-else
          class="breadcrumb-current"
          :title="session.name"
        >
          {{ truncateName(session.name) }}
        </span>
        <span v-if="index < path.length - 1" class="breadcrumb-separator">›</span>
      </li>
    </ol>
  </nav>
</template>

<script setup>
defineProps({
  path: {
    type: Array,
    required: true,
  },
  currentSessionId: {
    type: String,
    required: true,
  },
});

const truncateName = (name, maxLength = 30) => {
  if (!name) return 'Unnamed';
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + '...';
};
</script>

<style scoped>
.session-breadcrumb {
  margin-bottom: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-background-secondary, rgba(0, 0, 0, 0.1));
  border-radius: var(--border-radius, 6px);
  border: 1px solid var(--color-border);
}

.breadcrumb-list {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
  flex-wrap: wrap;
}

.breadcrumb-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
}

.breadcrumb-link {
  color: var(--color-primary);
  text-decoration: none;
  transition: color 0.15s;
}

.breadcrumb-link:hover {
  color: var(--color-primary-bright, #06ffff);
  text-decoration: underline;
}

.breadcrumb-current {
  color: var(--color-text);
  font-weight: 500;
}

.breadcrumb-separator {
  color: var(--color-text-soft);
  margin: 0 0.25rem;
}
</style>
