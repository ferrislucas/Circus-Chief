<template>
  <div class="container">
    <h1>Settings</h1>

    <div class="tabs">
      <router-link
        to="/settings/providers"
        class="tab"
        :class="{ active: $route.path === '/settings/providers' }"
      >
        Model Providers
      </router-link>
      <router-link
        to="/settings/summary"
        class="tab"
        :class="{ active: $route.path === '/settings/summary' }"
      >
        Summary Settings
      </router-link>
      <router-link
        to="/settings/general"
        class="tab"
        :class="{ active: $route.path === '/settings/general' }"
      >
        Settings
      </router-link>
      <router-link
        to="/settings/logs"
        class="tab"
        :class="{ active: $route.path === '/settings/logs' }"
      >
        Logs
      </router-link>
    </div>

    <div class="tab-content">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { useRoute } from 'vue-router';

const route = useRoute();
</script>

<style scoped>
h1 {
  margin-bottom: 1.5rem;
}

.tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 1.5rem;
  /* Sticky positioning - accounts for header + safe area on iOS */
  position: -webkit-sticky; /* Safari prefix */
  position: sticky;
  /* Default for phones/small screens */
  top: calc(var(--header-height-computed, 51px) + var(--viewport-offset-top, 0px));
  background-color: var(--color-background);
  z-index: 99;
  padding: 0.5rem 0.5rem 0 0.5rem;
}

/* iPad and larger screens - account for safe area */
@media (min-width: 768px) {
  .tabs {
    top: calc(var(--header-height-computed, 80px) + var(--viewport-offset-top, 0px));
  }
}

.tab {
  padding: 0.75rem 1rem;
  color: var(--color-text-soft);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  transition: color 0.2s ease, border-color 0.2s ease;
  font-weight: 500;
}

.tab:hover {
  color: var(--color-text);
}

.tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.tab-content {
  /* Content rendered by router-view */
}
</style>
