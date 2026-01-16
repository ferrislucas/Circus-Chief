<template>
  <!-- Scheduled Session Info -->
  <div v-if="session.status === 'scheduled'" class="scheduling-info scheduled-panel">
    <div class="info-header">
      <span class="info-icon">⏰</span>
      <h3 class="info-title">Scheduled Session</h3>
    </div>

    <div class="info-content">
      <div class="countdown-section">
        <p class="countdown-text">
          Starting <strong>{{ countdownDisplay }}</strong>
        </p>
        <p class="absolute-time">{{ absoluteTimeDisplay }}</p>
      </div>

      <div v-if="session.autoRescheduleEnabled" class="reschedule-info">
        <div class="reschedule-badge">
          <span class="badge-icon">🔄</span>
          <span class="badge-label">Auto-reschedule enabled</span>
        </div>
      </div>

      <div class="actions">
        <button @click="handleStartNow" class="btn btn-primary" :disabled="loading">
          {{ loading ? 'Loading...' : 'Start Now' }}
        </button>
      </div>
    </div>
  </div>

  <!-- Auto-Reschedule Info (for running sessions) -->
  <div
    v-else-if="session.status === 'running' && session.autoRescheduleEnabled"
    class="auto-reschedule-panel"
  >
    <div class="info-header">
      <span class="info-icon">🔄</span>
      <h3 class="info-title">Auto-Reschedule Enabled</h3>
    </div>

    <div class="reschedule-grid">
      <div class="grid-item">
        <span class="grid-label">Delay:</span>
        <span class="grid-value">{{ session.rescheduleDelayMinutes }} min</span>
      </div>

      <div class="grid-item">
        <span class="grid-label">Attempts:</span>
        <span class="grid-value">
          {{ session.rescheduleCount }}/{{ session.maxRescheduleCount || '∞' }}
        </span>
      </div>

      <div class="grid-item">
        <span class="grid-label">Triggers:</span>
        <div class="triggers-list">
          <span v-if="session.rescheduleOnTokenLimit" class="trigger-badge">✓ Tokens</span>
          <span v-if="session.rescheduleOnServiceError" class="trigger-badge">✓ Service</span>
        </div>
      </div>

      <div v-if="session.maxTotalTokens" class="grid-item">
        <span class="grid-label">Token Budget:</span>
        <span class="grid-value">
          {{ formatTokenCount(session.inputTokens + session.outputTokens) }} /
          {{ formatTokenCount(session.maxTotalTokens) }}
        </span>
      </div>

      <div v-if="session.rescheduleAtTokenCount" class="grid-item">
        <span class="grid-label">Soft Threshold:</span>
        <span class="grid-value">
          {{ formatTokenCount(session.rescheduleAtTokenCount) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { formatDistanceToNow, format } from 'date-fns';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  session: {
    type: Object,
    required: true,
  },
});

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const loading = ref(false);
const countdownTime = ref(new Date());
let countdownInterval = null;

const countdownDisplay = computed(() => {
  return formatDistanceToNow(new Date(props.session.scheduledAt), { addSuffix: true });
});

const absoluteTimeDisplay = computed(() => {
  return format(new Date(props.session.scheduledAt), 'EEEE, MMMM d, yyyy h:mm a');
});

function formatTokenCount(count) {
  if (!count) return '0';
  return count.toLocaleString();
}

async function handleStartNow() {
  loading.value = true;
  try {
    await sessionsStore.updateSessionFields(props.session.id, {
      status: 'starting',
      scheduledAt: null,
    });

    uiStore.showToast('Session started', 'success');
  } catch (error) {
    console.error('Failed to start session:', error);
    uiStore.showToast('Failed to start session: ' + error.message, 'error');
  } finally {
    loading.value = false;
  }
}

// Update countdown display every second
onMounted(() => {
  countdownInterval = setInterval(() => {
    countdownTime.value = new Date();
  }, 1000);
});

onUnmounted(() => {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
});
</script>

<style scoped>
.scheduling-info {
  border-radius: var(--border-radius, 6px);
  padding: 1.5rem;
  margin-bottom: 1rem;
}

.scheduled-panel {
  background: linear-gradient(135deg, rgba(34, 197, 255, 0.1) 0%, rgba(34, 197, 255, 0.05) 100%);
  border: 1px solid rgba(34, 197, 255, 0.3);
  border-left: 4px solid var(--color-primary);
}

.auto-reschedule-panel {
  background: linear-gradient(135deg, rgba(34, 197, 255, 0.08) 0%, rgba(34, 197, 255, 0.02) 100%);
  border: 1px solid rgba(34, 197, 255, 0.2);
}

.info-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.info-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.info-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
}

.info-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.countdown-section {
  background: var(--color-background, rgba(255, 255, 255, 0.05));
  padding: 1rem;
  border-radius: var(--border-radius, 4px);
}

.countdown-text {
  margin: 0 0 0.25rem 0;
  font-size: 1rem;
  color: var(--color-text);
  line-height: 1.4;
}

.countdown-text strong {
  color: var(--color-primary);
  font-weight: 600;
}

.absolute-time {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.reschedule-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.reschedule-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(34, 197, 255, 0.15);
  border: 1px solid rgba(34, 197, 255, 0.3);
  border-radius: 0.375rem;
  width: fit-content;
}

.badge-icon {
  font-size: 1rem;
}

.badge-label {
  font-size: 0.875rem;
  color: var(--color-text);
  font-weight: 500;
}

.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.btn {
  padding: 0.625rem 1.25rem;
  border-radius: var(--border-radius, 4px);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
  border: 1px solid var(--color-primary);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(34, 197, 255, 0.2);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.reschedule-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  background: var(--color-background, rgba(255, 255, 255, 0.02));
  padding: 1rem;
  border-radius: var(--border-radius, 4px);
  border: 1px solid rgba(34, 197, 255, 0.1);
}

.grid-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.grid-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-soft);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.grid-value {
  font-size: 0.95rem;
  color: var(--color-text);
  font-weight: 500;
}

.triggers-list {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.trigger-badge {
  display: inline-block;
  padding: 0.25rem 0.5rem;
  background: rgba(34, 197, 255, 0.2);
  border-radius: 0.25rem;
  font-size: 0.8rem;
  color: #22c5ff;
  font-weight: 500;
}

@media (max-width: 640px) {
  .scheduling-info {
    padding: 1rem;
  }

  .info-header {
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .info-icon {
    font-size: 1.25rem;
  }

  .info-title {
    font-size: 1rem;
  }

  .reschedule-grid {
    grid-template-columns: 1fr;
  }
}
</style>
