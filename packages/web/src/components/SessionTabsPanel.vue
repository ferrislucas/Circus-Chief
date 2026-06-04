<template>
  <div class="tabs tabs-session-detail">
    <router-link
      :to="`/projects/${projectId}/sessions`"
      class="tab tab-back"
      title="Back to Sessions"
    >
      <span
        class="back-icon"
        title="Back to Sessions"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line
            x1="19"
            y1="12"
            x2="5"
            y2="12"
          />
          <polyline points="12 19 5 12 12 5" />
        </svg>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <line
            x1="8"
            y1="6"
            x2="21"
            y2="6"
          />
          <line
            x1="8"
            y1="12"
            x2="21"
            y2="12"
          />
          <line
            x1="8"
            y1="18"
            x2="21"
            y2="18"
          />
          <line
            x1="3"
            y1="6"
            x2="3.01"
            y2="6"
          />
          <line
            x1="3"
            y1="12"
            x2="3.01"
            y2="12"
          />
          <line
            x1="3"
            y1="18"
            x2="3.01"
            y2="18"
          />
        </svg>
      </span>
    </router-link>
    <span class="tab-separator" />

    <!-- Desktop tabs -->
    <div class="tabs-desktop">
      <router-link
        v-for="tab in tabs"
        :key="tab.id"
        :to="`/sessions/${sessionId}/${tab.id}`"
        :class="['tab', { active: activeTab === tab.id }]"
      >
        <span class="tab-label">
          <span class="tab-label-text">{{ tab.label }}</span>
          <span
            v-if="tab.id === 'chat' && isSessionActive"
            class="active-spinner"
            :title="sessionStatus === 'starting' ? 'Session starting...' : 'Session running...'"
          />
          <span
            v-if="tab.id === 'changes' && hasChanges"
            class="changes-indicator"
            title="Uncommitted changes"
          />
          <span
            v-if="tab.id === 'canvas' && canvasCount > 0"
            class="canvas-indicator"
            title="Canvas contains files"
          />
        </span>
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
          v-for="tab in mobileTabs"
          :key="tab.id"
          :value="tab.id"
        >
          {{ tab.label }}{{ tab.id === 'changes' && hasChanges ? ' \u2022' : '' }}{{ tab.id === 'canvas' && canvasCount > 0 ? ' \u2022' : '' }}
        </option>
      </select>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
  /** The session ID for building tab URLs */
  sessionId: {
    type: String,
    required: true,
  },
  /** The project ID for building the back link */
  projectId: {
    type: String,
    default: '',
  },
  /** The currently active tab ID */
  activeTab: {
    type: String,
    default: 'summary',
  },
  /** Tab definitions: array of { id, label } */
  tabs: {
    type: Array,
    required: true,
  },
  /** Whether there are uncommitted changes */
  hasChanges: {
    type: Boolean,
    default: false,
  },
  /** Number of canvas items */
  canvasCount: {
    type: Number,
    default: 0,
  },
  /** Whether any session in the current chain is active */
  isSessionActive: {
    type: Boolean,
    default: false,
  },
  /** Active session status for the chat tab spinner tooltip */
  sessionStatus: {
    type: String,
    default: '',
  },
});

const router = useRouter();

const mobileTabs = computed(() => props.tabs.filter(tab => tab.desktopOnly !== true));

function navigateToTab(tabId) {
  router.push(`/sessions/${props.sessionId}/${tabId}`);
}
</script>

<style scoped>
.changes-indicator {
  display: inline-block;
  width: 6px;
  height: 6px;
  background-color: var(--color-warning, #d29922);
  border-radius: 50%;
  margin-left: 4px;
  vertical-align: middle;
}

.canvas-indicator {
  display: inline-block;
  width: 6px;
  height: 6px;
  background-color: var(--color-warning, #d29922);
  border-radius: 50%;
  margin-left: 4px;
  vertical-align: middle;
}

.active-spinner {
  flex: 0 0 auto;
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid rgba(6, 182, 212, 0.3);
  border-top-color: #06b6d4;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.tabs-mobile {
  align-items: center;
  gap: 0.5rem;
}

.back-icon {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.back-icon svg {
  display: inline-block;
  vertical-align: middle;
}

.tabs-session-detail .tabs-desktop {
  flex: 1;
  min-width: 0;
}

.tabs-session-detail .tabs-desktop .tab {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  text-align: center;
  min-width: 0;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  min-width: 0;
  max-width: 100%;
}

.tab-label-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
