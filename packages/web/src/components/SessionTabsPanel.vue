<template>
  <div class="tabs">
    <router-link
      :to="`/projects/${projectId}/sessions`"
      class="tab tab-back"
    >
      &larr; Sessions
    </router-link>
    <span class="tab-separator"></span>

    <!-- Desktop tabs -->
    <div class="tabs-desktop">
      <router-link
        v-for="tab in tabs"
        :key="tab.id"
        :to="`/sessions/${sessionId}/${tab.id}`"
        :class="['tab', { active: activeTab === tab.id }]"
      >
        {{ tab.label }}
        <span
          v-if="tab.id === 'changes' && hasChanges"
          class="changes-indicator"
          title="Uncommitted changes"
        ></span>
        <span
          v-if="tab.id === 'canvas' && canvasCount > 0"
          class="canvas-indicator"
          title="Canvas contains files"
        ></span>
        <span
          v-if="tab.id === 'conversation' && isSessionActive"
          class="session-active-indicator"
          :title="sessionStatus === 'starting'
            ? 'Session starting...' : 'Session running...'"
        >
          <span class="active-spinner"></span>
        </span>
      </router-link>
    </div>

    <!-- Mobile dropdown -->
    <div class="tabs-mobile">
      <select :value="activeTab" @change="navigateToTab($event.target.value)" class="tab-select">
        <option v-for="tab in tabs" :key="tab.id" :value="tab.id">
          {{ tab.label }}{{ tab.id === 'changes' && hasChanges ? ' \u2022' : '' }}{{ tab.id === 'canvas' && canvasCount > 0 ? ' \u2022' : '' }}{{ tab.id === 'conversation' && isSessionActive ? ' ...' : '' }}
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
    default: 'conversation',
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
  /** Whether the session is actively running/starting */
  isSessionActive: {
    type: Boolean,
    default: false,
  },
  /** The session status string (for tooltip text) */
  sessionStatus: {
    type: String,
    default: '',
  },
});

const router = useRouter();

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

.session-active-indicator {
  display: inline-flex;
  align-items: center;
  padding: 0 0.5rem;
}

.active-spinner {
  display: inline-block;
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid rgba(0, 188, 212, 0.2);
  border-top-color: #00bcd4;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
