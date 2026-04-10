<template>
  <div class="container">
    <h1>Settings</h1>

    <div class="tabs">
      <!-- Desktop tabs -->
      <div class="tabs-desktop">
        <router-link
          to="/settings/providers"
          class="tab"
          :class="{ active: activeTab === 'providers' }"
        >
          Model Providers
        </router-link>
        <router-link
          to="/settings/summary"
          class="tab"
          :class="{ active: activeTab === 'summary' }"
        >
          Summary Settings
        </router-link>
        <router-link
          to="/settings/general"
          class="tab"
          :class="{ active: activeTab === 'general' }"
        >
          Settings
        </router-link>
        <router-link
          to="/settings/logs"
          class="tab"
          :class="{ active: activeTab === 'logs' }"
        >
          Logs
        </router-link>
      </div>

      <!-- Mobile dropdown -->
      <div class="tabs-mobile">
        <select
          :value="activeTab"
          class="tab-select"
          @change="navigateToTab($event.target.value)"
        >
          <option
            v-for="tab in tabs"
            :key="tab.id"
            :value="tab.id"
          >
            {{ tab.label }}
          </option>
        </select>
      </div>
    </div>

    <div class="tab-content">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { useRoute, useRouter } from 'vue-router';
import { computed } from 'vue';

const route = useRoute();
const router = useRouter();

const tabs = [
  { id: 'providers', label: 'Model Providers', path: '/settings/providers' },
  { id: 'summary', label: 'Summary Settings', path: '/settings/summary' },
  { id: 'general', label: 'Settings', path: '/settings/general' },
  { id: 'logs', label: 'Logs', path: '/settings/logs' },
];

const activeTab = computed(() => {
  // Derive from route path: '/settings/providers' -> 'providers'
  const segments = route.path.split('/');
  return segments[segments.length - 1] || 'providers';
});

function navigateToTab(tabId) {
  router.push(`/settings/${tabId}`);
}
</script>

<style scoped>
h1 {
  margin-bottom: 1.5rem;
}

.tabs {
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

.tabs-desktop {
  display: flex;
  gap: 0.25rem;
}

.tabs-mobile {
  display: none;
  width: 100%;
}

@media (max-width: 480px) {
  .tabs-desktop {
    display: none !important;
  }
  .tabs-mobile {
    display: block;
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
