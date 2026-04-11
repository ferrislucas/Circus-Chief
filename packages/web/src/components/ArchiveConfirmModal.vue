<template>
  <Teleport to="body">
    <div v-if="isOpen" class="modal-backdrop" @click.self="cancel">
      <div class="modal-content" role="dialog" aria-labelledby="archive-modal-title">
        <div class="modal-header">
          <h2 id="archive-modal-title" class="modal-title">Archive Session</h2>
          <button @click="cancel" class="close-btn" aria-label="Close modal">&times;</button>
        </div>

        <div class="modal-body">
          <p class="confirm-message">
            Are you sure you want to archive <strong>{{ sessionName }}</strong>?
          </p>

          <div v-if="hasCleanupScript" class="cleanup-option">
            <label class="checkbox-label">
              <input
                type="checkbox"
                v-model="runCleanup"
                aria-label="Run project cleanup script"
              />
              <span>Run project cleanup script</span>
            </label>
          </div>
        </div>

        <div class="modal-footer">
          <button @click="cancel" class="btn btn-secondary">Cancel</button>
          <button @click="handleConfirm" class="btn btn-primary">Archive</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  sessionName: {
    type: String,
    default: 'this session',
  },
  hasCleanupScript: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['confirm', 'cancel']);

const runCleanup = ref(true);

// Reset runCleanup to true whenever modal opens
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) {
      runCleanup.value = true;
    }
  }
);

function handleConfirm() {
  emit('confirm', runCleanup.value);
}

function cancel() {
  emit('cancel');
}

// Handle Escape key to close modal
function handleEscape(event) {
  if (event.key === 'Escape' && props.isOpen) {
    cancel();
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape);
});
</script>

<style scoped>
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
  max-width: 450px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
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

.confirm-message {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text);
  line-height: 1.5;
}

.cleanup-option {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--color-text);
}

.checkbox-label input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--color-border);
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

.btn-primary:hover {
  opacity: 0.9;
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
