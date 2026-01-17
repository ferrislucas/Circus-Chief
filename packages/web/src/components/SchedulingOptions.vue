<template>
  <div class="scheduling-options">
    <!-- Schedule Start Time -->
    <div v-if="!hideScheduledAt" class="form-group">
        <label for="scheduled-at" class="form-label">Schedule Start Time (optional)</label>
        <input
          id="scheduled-at"
          type="datetime-local"
          v-model="localScheduling.scheduledAtLocal"
          class="form-input"
          @change="updateScheduledAt"
        />
        <p class="form-help">Leave empty to start immediately</p>
      </div>

      <!-- Auto-Reschedule Toggle -->
      <div class="form-group">
        <label class="toggle-switch">
          <input
            type="checkbox"
            v-model="localScheduling.autoRescheduleEnabled"
          />
          <span class="toggle-slider"></span>
          <span class="toggle-label">Auto-reschedule on errors</span>
        </label>
      </div>

      <!-- Reschedule Settings (shown when auto-reschedule enabled) -->
      <div v-if="localScheduling.autoRescheduleEnabled" class="reschedule-settings">
        <!-- Reschedule Triggers -->
        <div class="form-group">
          <p class="settings-label">Reschedule Triggers</p>
          <label class="checkbox-option">
            <input
              type="checkbox"
              v-model="localScheduling.rescheduleOnTokenLimit"
            />
            <span class="checkbox-label">Token limit errors</span>
          </label>
          <label class="checkbox-option">
            <input
              type="checkbox"
              v-model="localScheduling.rescheduleOnServiceError"
            />
            <span class="checkbox-label">Service unavailability</span>
          </label>
        </div>

        <!-- Reschedule Delay -->
        <div class="form-group">
          <label for="reschedule-delay" class="form-label">Reschedule Delay</label>
          <select
            id="reschedule-delay"
            v-model.number="localScheduling.rescheduleDelayMinutes"
            class="form-input"
          >
            <option :value="5">5 minutes</option>
            <option :value="15">15 minutes</option>
            <option :value="30">30 minutes</option>
            <option :value="60">1 hour</option>
            <option :value="120">2 hours</option>
          </select>
        </div>

        <!-- Limits Section -->
        <div class="limits-section">
          <p class="settings-label">Limits (optional)</p>

          <div class="form-group">
            <label for="max-reschedule-count" class="form-label">Max Reschedule Count</label>
            <input
              id="max-reschedule-count"
              type="number"
              v-model.number="localScheduling.maxRescheduleCount"
              min="1"
              max="100"
              class="form-input"
              placeholder="Unlimited"
            />
            <p class="form-help">Stop after N reschedule attempts</p>
          </div>

          <div class="form-group">
            <label for="max-total-tokens" class="form-label">Max Total Tokens (Hard Limit)</label>
            <input
              id="max-total-tokens"
              type="number"
              v-model.number="localScheduling.maxTotalTokens"
              min="1000"
              step="1000"
              class="form-input"
              placeholder="Unlimited"
            />
            <p class="form-help">Stop rescheduling after consuming this many tokens</p>
          </div>

          <div class="form-group">
            <label for="reschedule-at-token-count" class="form-label">Reschedule At Token Count</label>
            <input
              id="reschedule-at-token-count"
              type="number"
              v-model.number="localScheduling.rescheduleAtTokenCount"
              min="10000"
              step="10000"
              class="form-input"
              placeholder="None"
            />
            <p class="form-help">Proactively reschedule when session reaches this token count</p>
          </div>
        </div>
      </div>
  </div>
</template>

<script setup>
import { ref, reactive, watch, computed } from 'vue';

const props = defineProps({
  modelValue: {
    type: Object,
    default: () => ({}),
  },
  hideScheduledAt: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['update:modelValue']);

// Local scheduling state
const localScheduling = reactive({
  scheduledAt: props.modelValue.scheduledAt || null,
  scheduledAtLocal: '',
  autoRescheduleEnabled: props.modelValue.autoRescheduleEnabled ?? false,
  rescheduleDelayMinutes: props.modelValue.rescheduleDelayMinutes ?? 15,
  rescheduleOnTokenLimit: props.modelValue.rescheduleOnTokenLimit ?? true,
  rescheduleOnServiceError: props.modelValue.rescheduleOnServiceError ?? true,
  maxRescheduleCount: props.modelValue.maxRescheduleCount ?? null,
  maxTotalTokens: props.modelValue.maxTotalTokens ?? null,
  rescheduleAtTokenCount: props.modelValue.rescheduleAtTokenCount ?? null,
});

// Convert local datetime string to scheduledAt timestamp
function updateScheduledAt() {
  if (localScheduling.scheduledAtLocal) {
    // Convert local datetime string to UTC timestamp
    const date = new Date(localScheduling.scheduledAtLocal);
    localScheduling.scheduledAt = date.getTime();
  } else {
    localScheduling.scheduledAt = null;
  }
  emitUpdate();
}

// Convert scheduledAt timestamp to local datetime string
function convertToLocalDatetime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  // Format as datetime-local: YYYY-MM-DDTHH:mm
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// Initialize local datetime when component mounts
watch(
  () => props.modelValue.scheduledAt,
  (newVal) => {
    if (newVal) {
      localScheduling.scheduledAtLocal = convertToLocalDatetime(newVal);
    }
  },
  { immediate: true }
);

// Emit updates whenever local state changes
function emitUpdate() {
  emit('update:modelValue', {
    scheduledAt: localScheduling.scheduledAt,
    autoRescheduleEnabled: localScheduling.autoRescheduleEnabled,
    rescheduleDelayMinutes: localScheduling.rescheduleDelayMinutes,
    rescheduleOnTokenLimit: localScheduling.rescheduleOnTokenLimit,
    rescheduleOnServiceError: localScheduling.rescheduleOnServiceError,
    maxRescheduleCount: localScheduling.maxRescheduleCount,
    maxTotalTokens: localScheduling.maxTotalTokens,
    rescheduleAtTokenCount: localScheduling.rescheduleAtTokenCount,
  });
}

// Watch all scheduling fields for changes
watch(
  () => ({
    autoRescheduleEnabled: localScheduling.autoRescheduleEnabled,
    rescheduleDelayMinutes: localScheduling.rescheduleDelayMinutes,
    rescheduleOnTokenLimit: localScheduling.rescheduleOnTokenLimit,
    rescheduleOnServiceError: localScheduling.rescheduleOnServiceError,
    maxRescheduleCount: localScheduling.maxRescheduleCount,
    maxTotalTokens: localScheduling.maxTotalTokens,
    rescheduleAtTokenCount: localScheduling.rescheduleAtTokenCount,
  }),
  () => {
    emitUpdate();
  },
  { deep: true }
);
</script>

<style scoped>
.scheduling-options {
  /* Container for scheduling form fields - no border/background needed as it lives inside modal */
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
  border-radius: var(--border-radius, 4px);
  background: var(--color-background);
  color: var(--color-text);
  font-size: 0.95rem;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(34, 197, 255, 0.1);
}

.form-help {
  margin-top: 0.25rem;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.toggle-switch {
  display: flex;
  align-items: center;
  cursor: pointer;
  gap: 0.75rem;
}

.toggle-switch input {
  display: none;
}

.toggle-slider {
  position: relative;
  display: inline-block;
  width: 2.5rem;
  height: 1.25rem;
  background-color: var(--color-border);
  border-radius: 1rem;
  transition: background-color 0.2s;
}

.toggle-slider::after {
  content: '';
  position: absolute;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background-color: white;
  top: 0.125rem;
  left: 0.125rem;
  transition: transform 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--color-primary);
}

.toggle-switch input:checked + .toggle-slider::after {
  transform: translateX(1.25rem);
}

.toggle-label {
  color: var(--color-text);
  font-weight: 500;
}

.reschedule-settings {
  padding: 1rem;
  margin-top: 1rem;
  border-left: 2px solid var(--color-primary);
  background: var(--color-background, rgba(255, 255, 255, 0.02));
}

.settings-label {
  margin-bottom: 0.75rem;
  font-weight: 500;
  font-size: 0.95rem;
  color: var(--color-text);
}

.checkbox-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  cursor: pointer;
}

.checkbox-option input {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}

.checkbox-label {
  color: var(--color-text);
}

.limits-section {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}
</style>
