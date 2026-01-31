<template>
  <Teleport to="body">
    <div v-if="isOpen" class="modal-backdrop" @click.self="close">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title">Auto-Reschedule Settings</h2>
          <button @click="close" class="close-btn" aria-label="Close">&times;</button>
        </div>

        <div class="modal-body">
          <!-- Error message -->
          <div v-if="error" class="error-message">
            {{ error }}
          </div>

          <!-- Auto-Reschedule Settings -->
          <div class="form-group">
              <label class="toggle-switch">
                <input type="checkbox" v-model="form.autoRescheduleEnabled" />
                <span class="toggle-slider"></span>
                <span class="toggle-label">Auto-reschedule on errors</span>
              </label>
            </div>

            <div v-if="form.autoRescheduleEnabled" class="reschedule-settings">
            <!-- Reschedule Triggers -->
            <div class="form-group">
              <p class="settings-label">Reschedule Triggers</p>
              <label class="checkbox-option">
                <input type="checkbox" v-model="form.rescheduleOnTokenLimit" />
                <span>Token limit errors</span>
              </label>
              <label class="checkbox-option">
                <input type="checkbox" v-model="form.rescheduleOnServiceError" />
                <span>Service unavailability</span>
              </label>
            </div>

            <!-- Delay -->
            <div class="form-group">
              <label class="form-label">Reschedule Delay</label>
              <select v-model.number="form.rescheduleDelayMinutes" class="form-input">
                <option :value="5">5 minutes</option>
                <option :value="15">15 minutes</option>
                <option :value="30">30 minutes</option>
                <option :value="60">1 hour</option>
                <option :value="120">2 hours</option>
              </select>
            </div>

            <!-- Limits -->
            <div class="form-group">
              <label class="form-label">Max Reschedule Count</label>
              <input
                type="number"
                v-model.number="form.maxRescheduleCount"
                min="1"
                max="100"
                class="form-input"
                placeholder="Unlimited"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Max Total Tokens</label>
              <input
                type="number"
                v-model.number="form.maxTotalTokens"
                min="1000"
                step="1000"
                class="form-input"
                placeholder="Unlimited"
              />
            </div>

            <div class="form-group">
              <label class="form-label">Reschedule At Token Count</label>
              <input
                type="number"
                v-model.number="form.rescheduleAtTokenCount"
                min="10000"
                step="10000"
                class="form-input"
                placeholder="None"
              />
            </div>

            <!-- Reset reschedule count -->
            <div v-if="session?.rescheduleCount > 0" class="form-group">
              <label class="checkbox-option">
                <input type="checkbox" v-model="form.resetRescheduleCount" />
                <span>Reset reschedule count to 0</span>
              </label>
              <p class="form-help">Current count: {{ session.rescheduleCount }}</p>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button @click="close" class="btn btn-secondary">Cancel</button>
          <button @click="handleSave" class="btn btn-primary" :disabled="loading">
            {{ loading ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  isOpen: Boolean,
  session: Object,
});

const emit = defineEmits(['close', 'saved']);

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const loading = ref(false);
const error = ref(null);

const form = reactive({
  autoRescheduleEnabled: false,
  rescheduleDelayMinutes: 15,
  rescheduleOnTokenLimit: true,
  rescheduleOnServiceError: true,
  maxRescheduleCount: null,
  maxTotalTokens: null,
  rescheduleAtTokenCount: null,
  resetRescheduleCount: false,
});

function close() {
  emit('close');
}

async function handleSave() {
  loading.value = true;
  error.value = null;

  try {
    const updateData = {
      autoRescheduleEnabled: form.autoRescheduleEnabled,
      rescheduleDelayMinutes: form.rescheduleDelayMinutes,
      rescheduleOnTokenLimit: form.rescheduleOnTokenLimit,
      rescheduleOnServiceError: form.rescheduleOnServiceError,
      maxRescheduleCount: form.maxRescheduleCount || null,
      maxTotalTokens: form.maxTotalTokens || null,
      rescheduleAtTokenCount: form.rescheduleAtTokenCount || null,
    };

    // Reset reschedule count if requested
    if (form.resetRescheduleCount) {
      updateData.rescheduleCount = 0;
    }

    await sessionsStore.updateSessionFields(props.session.id, updateData);

    uiStore.success('Settings saved');
    emit('saved');
    close(); // Close modal on success
  } catch (err) {
    error.value = err.message || 'Failed to save settings';
    uiStore.error('Failed to save settings: ' + error.value);
    // Modal stays open on error
  } finally {
    loading.value = false;
  }
}

// Initialize form when modal opens
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen && props.session) {
      error.value = null; // Clear any previous errors
      form.autoRescheduleEnabled = props.session.autoRescheduleEnabled || false;
      form.rescheduleDelayMinutes = props.session.rescheduleDelayMinutes || 15;
      form.rescheduleOnTokenLimit = props.session.rescheduleOnTokenLimit ?? true;
      form.rescheduleOnServiceError = props.session.rescheduleOnServiceError ?? true;
      form.maxRescheduleCount = props.session.maxRescheduleCount;
      form.maxTotalTokens = props.session.maxTotalTokens;
      form.rescheduleAtTokenCount = props.session.rescheduleAtTokenCount;
      form.resetRescheduleCount = false;
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
  display: flex;
  flex-direction: column;
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0.5rem;
  width: 100%;
  max-width: 500px;
  max-height: 90vh;
  overflow: hidden;
  border: 1px solid var(--color-border);
}

.modal-header {
  flex-shrink: 0;
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
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 1.5rem;
}

.error-message {
  padding: 0.75rem;
  margin-bottom: 1rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 0.25rem;
  color: #fca5a5;
  font-size: 0.9rem;
}

.modal-footer {
  flex-shrink: 0;
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
  flex-shrink: 0;
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
  border-radius: 0 0.25rem 0.25rem 0;
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
  color: var(--color-text);
}

.checkbox-option input {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
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
