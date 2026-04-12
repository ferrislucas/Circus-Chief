<template>
  <div class="container command-button-detail">
    <div
      v-if="isLoading"
      class="loading-state"
    >
      <span class="loading-spinner" />
      Loading...
    </div>

    <div
      v-else
      class="form-container"
    >
      <!-- Header -->
      <div class="form-header">
        <router-link
          :to="`/projects/${route.params[ROUTE_PARAMS.PROJECT_ID]}/sessions`"
          class="btn btn-outline-secondary"
        >
          ← Back
        </router-link>
        <h2>{{ isEditMode ? 'Edit Command Button' : 'New Command Button' }}</h2>
      </div>

      <!-- Form -->
      <form
        class="command-button-form"
        @submit.prevent="onSubmit"
      >
        <!-- Label Field -->
        <div class="form-group">
          <label for="label">Label</label>
          <input
            id="label"
            v-model="formData.label"
            type="text"
            class="form-input"
            placeholder="e.g., Run Tests"
            required
          >
          <span
            v-if="validationErrors.label"
            class="form-error"
          >{{ validationErrors.label }}</span>
        </div>

        <!-- Command Field -->
        <div class="form-group">
          <label for="command">Command</label>
          <textarea
            id="command"
            v-model="formData.command"
            class="form-input"
            placeholder="e.g., npm test"
            rows="4"
            required
          />
          <span
            v-if="validationErrors.command"
            class="form-error"
          >{{ validationErrors.command }}</span>
        </div>

        <!-- Sort Order Field -->
        <div class="form-group">
          <label for="sortOrder">Sort Order (optional)</label>
          <input
            id="sortOrder"
            v-model.number="formData.sortOrder"
            type="number"
            class="form-input"
            placeholder="0"
            min="0"
          >
          <span
            v-if="validationErrors.sortOrder"
            class="form-error"
          >{{ validationErrors.sortOrder }}</span>
          <span class="form-help">Buttons are displayed in ascending order. Leave as 0 for default.</span>
        </div>

        <!-- Show on List Checkbox -->
        <div class="form-group form-group-checkbox">
          <label
            for="showOnList"
            class="checkbox-label"
          >
            <input
              id="showOnList"
              v-model="formData.showOnList"
              type="checkbox"
              class="form-checkbox"
            >
            <span>Show status indicator on session lists</span>
          </label>
          <span class="form-help">When enabled, the button status will be displayed on session cards</span>
        </div>

        <!-- Form Actions -->
        <div class="form-actions">
          <button
            type="button"
            class="btn btn-outline-secondary"
            @click="onCancel"
          >
            Cancel
          </button>
          <button
            v-if="isEditMode"
            type="button"
            class="btn btn-outline-danger"
            @click="onDelete"
          >
            Delete
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="isSaving"
          >
            {{ isSaving ? 'Saving...' : isEditMode ? 'Update' : 'Create' }}
          </button>
        </div>

        <!-- Error Message -->
        <div
          v-if="error"
          class="form-error-message"
        >
          {{ error }}
        </div>
      </form>
    </div>

    <!-- Delete Confirmation Dialog -->
    <div
      v-if="showDeleteConfirm"
      class="modal-overlay"
      @click="showDeleteConfirm = false"
    >
      <div
        class="modal-dialog"
        @click.stop
      >
        <div class="modal-header">
          <h4>Delete Command Button</h4>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to delete "<strong>{{ formData.label }}</strong>"?</p>
          <p>This action cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button
            class="btn btn-outline-secondary"
            @click="showDeleteConfirm = false"
          >
            Cancel
          </button>
          <button
            class="btn btn-danger"
            :disabled="isDeleting"
            @click="confirmDelete"
          >
            {{ isDeleting ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineProps, ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useUiStore } from '../stores/ui.js';
import { api } from '../composables/useApi.js';
import { ROUTE_PARAMS } from '@circuschief/shared/routeParams';

const route = useRoute();
const router = useRouter();
const commandButtonsStore = useCommandButtonsStore();
const uiStore = useUiStore();

const isLoading = ref(false);
const isSaving = ref(false);
const isDeleting = ref(false);
const showDeleteConfirm = ref(false);
const error = ref(null);
const validationErrors = ref({});

const formData = ref({
  label: '',
  command: '',
  sortOrder: 0,
  showOnList: false,
});

const isEditMode = computed(() => Boolean(route.params.buttonId));

const loadButton = async (buttonId) => {
  isLoading.value = true;
  try {
    const projectId = route.params[ROUTE_PARAMS.PROJECT_ID];

    // First try to get from store
    let button = commandButtonsStore.getButtonById(buttonId);

    // If not in store, fetch from API
    if (!button) {
      button = await api.getCommandButton(projectId, buttonId);
    }

    if (button) {
      formData.value = {
        label: button.label,
        command: button.command,
        sortOrder: button.sortOrder || 0,
        showOnList: button.showOnList || false,
      };
    }
  } catch (err) {
    error.value = `Failed to load button: ${err.message}`;
  } finally {
    isLoading.value = false;
  }
};

const validateForm = () => {
  validationErrors.value = {};

  if (!formData.value.label.trim()) {
    validationErrors.value.label = 'Label is required';
  }

  if (!formData.value.command.trim()) {
    validationErrors.value.command = 'Command is required';
  }

  if (formData.value.sortOrder < 0) {
    validationErrors.value.sortOrder = 'Sort order must be 0 or greater';
  }

  return Object.keys(validationErrors.value).length === 0;
};

const onSubmit = async () => {
  error.value = null;

  if (!validateForm()) {
    return;
  }

  isSaving.value = true;
  try {
    const projectId = route.params[ROUTE_PARAMS.PROJECT_ID];
    const buttonData = {
      label: formData.value.label,
      command: formData.value.command,
      sortOrder: formData.value.sortOrder,
      showOnList: formData.value.showOnList,
    };

    if (isEditMode.value) {
      await commandButtonsStore.updateButton(projectId, route.params[ROUTE_PARAMS.BUTTON_ID], buttonData);
      uiStore.success('Command button updated');
    } else {
      await commandButtonsStore.createButton(projectId, buttonData);
      uiStore.success('Command button created');
    }

    router.push(`/projects/${projectId}/sessions`);
  } catch (err) {
    error.value = err.message;
    uiStore.error(err.message);
  } finally {
    isSaving.value = false;
  }
};

const onCancel = () => {
  router.back();
};

const onDelete = () => {
  showDeleteConfirm.value = true;
};

const confirmDelete = async () => {
  isDeleting.value = true;
  try {
    const projectId = route.params[ROUTE_PARAMS.PROJECT_ID];
    const buttonId = route.params[ROUTE_PARAMS.BUTTON_ID];

    await commandButtonsStore.deleteButton(projectId, buttonId);
    uiStore.success('Command button deleted');
    showDeleteConfirm.value = false;

    router.push(`/projects/${projectId}/sessions`);
  } catch (err) {
    error.value = err.message;
    uiStore.error(err.message);
  } finally {
    isDeleting.value = false;
  }
};

onMounted(async () => {
  if (isEditMode.value) {
    await loadButton(route.params.buttonId);
  }
});
</script>

<style scoped>
.command-button-detail {
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem 0;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 3rem;
  color: var(--color-text-soft);
}

.form-container {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.form-header {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.form-header h2 {
  margin: 0;
  color: var(--color-text);
  flex: 1;
}

.command-button-form {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 2rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 500;
  color: var(--color-text);
  font-size: 0.95rem;
}

.form-input {
  padding: 0.75rem;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.95rem;
  transition: border-color 0.2s;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.1);
}

.form-input::placeholder {
  color: var(--color-text-soft);
}

textarea.form-input {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  resize: vertical;
  min-height: 100px;
}

.form-help {
  font-size: 0.85rem;
  color: var(--color-text-soft);
}

.form-error {
  font-size: 0.85rem;
  color: var(--color-error);
}

.form-group-checkbox {
  gap: 0.25rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  color: var(--color-text);
  font-size: 0.95rem;
  cursor: pointer;
  user-select: none;
}

.form-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--color-primary);
}

.form-error-message {
  padding: 0.75rem;
  background-color: rgba(248, 81, 73, 0.1);
  border: 1px solid var(--color-error);
  border-radius: var(--border-radius);
  color: var(--color-error);
  font-size: 0.9rem;
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1rem;
}

.form-actions button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-dialog {
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  max-width: 400px;
  width: 90%;
  overflow: hidden;
}

.modal-header {
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h4 {
  margin: 0;
  color: var(--color-text);
}

.modal-body {
  padding: 1.5rem 1rem;
  color: var(--color-text-soft);
}

.modal-body p {
  margin: 0.5rem 0;
}

.modal-footer {
  padding: 1rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

/* Responsive Design */
@media (max-width: 640px) {
  .command-button-detail {
    padding: 1rem;
  }

  .form-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .command-button-form {
    padding: 1.5rem 1rem;
  }

  .form-actions {
    flex-direction: column-reverse;
  }

  .form-actions button {
    width: 100%;
  }
}
</style>
