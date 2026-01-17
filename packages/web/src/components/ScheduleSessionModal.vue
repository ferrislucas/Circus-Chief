<template>
    <div v-if="isOpen" class="modal-backdrop" @click.self="close">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title">Schedule Session</h2>
          <button @click="close" class="close-btn" aria-label="Close">&times;</button>
        </div>

        <div class="modal-body">
          <!-- Scheduled Time -->
          <div class="form-group">
            <label for="scheduled-at" class="form-label">Schedule Start Time *</label>
            <input
              id="scheduled-at"
              type="datetime-local"
              v-model="form.scheduledAtLocal"
              :min="minDateTime"
              class="form-input"
              required
            />
            <p class="form-help">The message you've typed will be sent at this time</p>
          </div>

          <!-- Scheduling Options (collapsible) -->
          <SchedulingOptions v-model="form.scheduling" :hide-scheduled-at="true" />
        </div>

        <div class="modal-footer">
          <button @click="close" class="btn btn-secondary">Cancel</button>
          <button @click="handleSchedule" class="btn btn-primary" :disabled="loading || !isValid">
            {{ loading ? 'Scheduling...' : 'Schedule' }}
          </button>
        </div>
      </div>
    </div>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue';
import { api } from '../composables/useApi.js';
import { useUiStore } from '../stores/ui.js';
import SchedulingOptions from './SchedulingOptions.vue';

const props = defineProps({
  isOpen: Boolean,
  sessionId: String,
});

const emit = defineEmits(['close', 'update:isOpen']);

const uiStore = useUiStore();
const loading = ref(false);

const form = reactive({
  scheduledAtLocal: '',
  scheduling: {
    autoRescheduleEnabled: false,
    rescheduleDelayMinutes: 15,
    rescheduleOnTokenLimit: true,
    rescheduleOnServiceError: true,
    maxRescheduleCount: null,
    maxTotalTokens: null,
    rescheduleAtTokenCount: null,
  },
});

// Calculate min datetime (now + 1 minute)
const minDateTime = computed(() => {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  return now.toISOString().slice(0, 16);
});

const isValid = computed(() => {
  if (!form.scheduledAtLocal) return false;
  const scheduledTime = new Date(form.scheduledAtLocal).getTime();
  return scheduledTime > Date.now();
});

function close() {
  emit('update:isOpen', false);
  emit('close');
}

async function handleSchedule() {
  if (!isValid.value) return;

  const scheduledAt = new Date(form.scheduledAtLocal).getTime();

  const payload = {
    scheduledAt,
    ...form.scheduling,
  };

  // Close modal immediately for better UX
  close();

  // Make API call in background
  try {
    await api.scheduleSession(props.sessionId, payload);
    uiStore.showToast('Session scheduled successfully', 'success');
  } catch (error) {
    console.error('Failed to schedule session:', error);
    uiStore.showToast('Failed to schedule session: ' + error.message, 'error');
  }
}

// Reset form when modal opens
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      form.scheduledAtLocal = '';
      form.scheduling = {
        autoRescheduleEnabled: false,
        rescheduleDelayMinutes: 15,
        rescheduleOnTokenLimit: true,
        rescheduleOnServiceError: true,
        maxRescheduleCount: null,
        maxTotalTokens: null,
        rescheduleAtTokenCount: null,
      };
    }
  }
);
</script>

<style scoped>
/* Modal styles - dark theme */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0.5rem;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  overflow-y: auto;
  border: 1px solid var(--color-border);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: var(--color-text);
}

.modal-body {
  padding: 1.5rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
}

.form-group {
  margin-bottom: 1rem;
}

.form-label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--color-text);
}

.form-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  background: var(--color-background);
  color: var(--color-text);
  font-size: 0.95rem;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(34, 197, 255, 0.1);
}

textarea.form-input {
  resize: vertical;
  min-height: 80px;
}

.form-help {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 0.25rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  font-size: 0.9rem;
  transition: opacity 0.2s, background-color 0.2s;
}

.btn-primary {
  background: var(--color-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-background-secondary);
}
</style>
