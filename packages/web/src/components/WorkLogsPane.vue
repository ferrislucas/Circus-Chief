<template>
  <div class="work-logs-pane running-state" data-testid="work-logs-pane">
    <!-- Frosted-glass sticky header -->
    <div class="work-logs-header" data-testid="work-logs-header">
      <div class="running-status">
        <span class="running-spinner-glow">
          <span class="loading-spinner"></span>
        </span>
        <span class="running-title">Claude is working...</span>
      </div>
      <div class="running-actions">
        <span v-if="activeModelDisplayName" class="running-model-badge">
          {{ activeModelDisplayName }}
        </span>
        <button class="btn btn-danger btn-stop" @click="$emit('stop')" :disabled="stopping">
          <span v-if="stopping" class="loading-spinner"></span>
          Stop
        </button>
      </div>
    </div>

    <!-- Work logs - fills remaining space -->
    <LiveWorkLogPanel
      :work-logs="workLogs"
      :partial-thinking="partialThinking"
      :show-header="false"
      :fill-available="true"
    />

    <!-- Next template indicator -->
    <div v-if="nextTemplate" class="template-pending" data-testid="template-pending">
      <span class="template-pending-label">Next:</span>
      <router-link v-if="projectId" :to="`/projects/${projectId}/templates`" class="template-pending-link">
        {{ nextTemplate.name }}
      </router-link>
      <span v-else class="template-pending-name">{{ nextTemplate.name }}</span>
      <span class="template-pending-description">will trigger when Claude finishes</span>
    </div>
  </div>
</template>

<script setup>
import LiveWorkLogPanel from './LiveWorkLogPanel.vue';

defineProps({
  workLogs: { type: Array, default: () => [] },
  partialThinking: { type: String, default: '' },
  activeModelDisplayName: { type: String, default: null },
  stopping: { type: Boolean, default: false },
  nextTemplate: { type: Object, default: null },
  projectId: { type: String, default: null },
});

defineEmits(['stop']);
</script>

<style scoped>
.work-logs-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0; /* Allow flex shrinking */
}

/* Frosted-glass sticky header
   Uses @supports for deliberate progressive enhancement - Safari has
   long-standing compositing bugs with backdrop-filter inside scrollable
   flex containers with overflow: hidden. The solid fallback looks
   intentionally designed rather than accidentally broken. */
.work-logs-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--color-background-soft); /* Solid fallback */
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 5;
  flex-shrink: 0;
}

@supports (backdrop-filter: blur(8px)) {
  .work-logs-header {
    background: rgba(22, 27, 34, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
}

.running-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Subtle green pulse glow around spinner */
.running-spinner-glow {
  display: inline-flex;
  border-radius: 50%;
  animation: spinnerGlow 2s ease-in-out infinite;
}

@keyframes spinnerGlow {
  0%, 100% { box-shadow: 0 0 4px rgba(63, 185, 80, 0.15); }
  50% { box-shadow: 0 0 8px rgba(63, 185, 80, 0.35); }
}

.running-title {
  font-size: 0.875rem;
  color: var(--color-text);
}

.running-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* Model badge - monospace, muted background, compact */
.running-model-badge {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  padding: 0.125rem 0.375rem;
  background: var(--color-background-mute);
  border-radius: 0.25rem;
  color: var(--color-text-soft);
}

.btn-stop {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

/* Template pending indicator */
.template-pending {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-background-mute);
  border-top: 1px solid var(--color-border);
  font-size: 0.8125rem;
  color: var(--color-text-soft);
  flex-shrink: 0;
}

.template-pending-label {
  font-weight: 500;
  color: var(--color-text);
}

.template-pending-link {
  color: var(--color-primary);
  text-decoration: none;
}

.template-pending-link:hover {
  text-decoration: underline;
}

.template-pending-name {
  color: var(--color-primary);
}

.template-pending-description {
  opacity: 0.7;
}

@media (prefers-reduced-motion: reduce) {
  .running-spinner-glow { animation: none; }
}

/* Mobile adjustments */
@media (max-width: 639px) {
  .work-logs-header {
    padding: 0.375rem 0.5rem;
  }

  .running-title {
    font-size: 0.8125rem;
  }

  .running-model-badge {
    display: none; /* Hide model badge on very small screens */
  }
}
</style>
