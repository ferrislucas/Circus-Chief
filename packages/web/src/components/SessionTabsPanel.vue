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
      </router-link>
    </div>

    <!-- Mobile dropdown -->
    <div class="tabs-mobile">
      <select :value="activeTab" @change="navigateToTab($event.target.value)" class="tab-select">
        <option v-for="tab in tabs" :key="tab.id" :value="tab.id">
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

.tabs-mobile {
  align-items: center;
  gap: 0.5rem;
}
</style>
