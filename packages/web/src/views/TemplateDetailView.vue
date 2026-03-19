<template>
  <div class="container template-detail">
    <div v-if="isLoading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading...
    </div>

    <div v-else class="form-container">
      <!-- Header -->
      <div class="form-header">
        <router-link :to="`/projects/${projectId}/templates`" class="btn btn-outline-secondary">
          ← Back
        </router-link>
        <h2>Edit Template</h2>
      </div>

      <!-- Form -->
      <form @submit.prevent="onSubmit" class="template-form">
        <!-- Name Field -->
        <div class="form-group">
          <label for="name">Name</label>
          <input
            id="name"
            v-model="formData.name"
            type="text"
            class="form-input"
            placeholder="Template name"
            required
          />
        </div>

        <!-- Prompt Field -->
        <div class="form-group">
          <label for="prompt">Prompt</label>
          <textarea
            id="prompt"
            v-model="formData.prompt"
            class="form-input form-textarea"
            placeholder="Session prompt. Use {{parentSession.summary}} to reference parent session data."
            rows="6"
            required
          ></textarea>
          <p class="form-help">
            Available variables: <code v-pre>{{parentSession.summary}}</code>, <code v-pre>{{parentSession.status}}</code>, <code v-pre>{{parentSession.name}}</code>, <code v-pre>{{rootSession.id}}</code>, <code v-pre>{{rootSession.name}}</code>, <code v-pre>{{rootSession.summary}}</code>, <code v-pre>{{rootSession.status}}</code>
          </p>
        </div>

        <!-- Next Template Field -->
        <div class="form-group">
          <label for="nextTemplate">Next Template (Optional)</label>
          <select id="nextTemplate" v-model="formData.nextTemplateId" class="form-input">
            <option :value="null">None</option>
            <option v-for="t in availableNextTemplates" :key="t.id" :value="t.id">
              {{ t.name }} {{ t.projectId ? '' : '(Global)' }}
            </option>
          </select>
          <p class="form-help">Chain another template to run after this one completes.</p>
        </div>

        <!-- Thinking Enabled Select -->
        <div class="form-group">
          <label for="thinkingEnabled">Extended Thinking</label>
          <select id="thinkingEnabled" v-model="formData.thinkingEnabled" class="form-input">
            <option :value="null">Inherit from root session</option>
            <option :value="true">Enabled</option>
            <option :value="false">Disabled</option>
          </select>
        </div>

        <!-- Model Field -->
        <div class="form-group">
          <label for="model">Model</label>
          <ModelSelector v-model="formData.model" :allowEmpty="true" emptyLabel="Inherit from root session" />
        </div>

        <!-- Mode Field -->
        <div class="form-group">
          <label for="mode">Mode</label>
          <select id="mode" v-model="formData.mode" class="form-input">
            <option :value="null">Inherit from root session</option>
            <option value="plan">Plan</option>
            <option value="standard">Standard</option>
            <option value="yolo">YOLO</option>
          </select>
        </div>

        <!-- Git Branch Field -->
        <div class="form-group">
          <label for="gitBranch">Git Branch (Optional)</label>
          <input
            id="gitBranch"
            v-model="formData.gitBranch"
            type="text"
            class="form-input"
            placeholder="Leave empty to inherit from root session"
          />
        </div>

        <!-- Form Actions -->
        <div class="form-actions">
          <button type="button" class="btn btn-outline-secondary" @click="onCancel">
            Cancel
          </button>
          <button type="button" class="btn btn-outline-danger" @click="onDelete">
            Delete
          </button>
          <button type="submit" class="btn btn-primary" :disabled="isSaving">
            {{ isSaving ? 'Saving...' : 'Save' }}
          </button>
        </div>

        <!-- Error Message -->
        <div v-if="error" class="form-error-message">
          {{ error }}
        </div>
      </form>
    </div>

    <!-- Delete Confirmation Dialog -->
    <div v-if="showDeleteConfirm" class="modal-overlay" @click="showDeleteConfirm = false">
      <div class="modal-dialog" @click.stop>
        <div class="modal-header">
          <h4>Delete Template</h4>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to delete "<strong>{{ formData.name }}</strong>"?</p>
          <p>This action cannot be undone.</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline-secondary" @click="showDeleteConfirm = false">
            Cancel
          </button>
          <button class="btn btn-danger" @click="confirmDelete" :disabled="isDeleting">
            {{ isDeleting ? 'Deleting...' : 'Delete' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useTemplatesStore } from '../stores/templates.js';
import { useUiStore } from '../stores/ui.js';
import { api } from '../api/index.js';
import ModelSelector from '../components/ModelSelector.vue';

const route = useRoute();
const router = useRouter();
const templatesStore = useTemplatesStore();
const uiStore = useUiStore();

const isLoading = ref(false);
const isSaving = ref(false);
const isDeleting = ref(false);
const showDeleteConfirm = ref(false);
const error = ref(null);

const formData = ref({
  name: '',
  prompt: '',
  isGlobal: false,
  nextTemplateId: null,
  thinkingEnabled: null,
  gitBranch: '',
  model: null,
  mode: null,
});

const projectId = computed(() => route.params.projectId);
const templateId = computed(() => route.params.templateId);

const availableNextTemplates = computed(() => {
  const all = [...templatesStore.projectTemplates, ...templatesStore.globalTemplates];
  // Exclude the current template being edited
  return all.filter((t) => t.id !== templateId.value);
});

const loadTemplate = async () => {
  isLoading.value = true;
  error.value = null;
  try {
    const template = await api.getTemplate(templateId.value);

    if (template) {
      formData.value = {
        name: template.name,
        prompt: template.prompt,
        isGlobal: !template.projectId,
        nextTemplateId: template.nextTemplateId || null,
        thinkingEnabled: template.thinkingEnabled,  // Preserve null (inherit), true, or false
        gitBranch: template.gitBranch || '',
        model: template.model,                      // Preserve null (inherit) or model ID
        mode: template.mode,                        // Preserve null (inherit), 'plan', 'standard', or 'yolo'
      };
    }
  } catch (err) {
    error.value = `Failed to load template: ${err.message}`;
    uiStore.error(err.message);
  } finally {
    isLoading.value = false;
  }
};

const onSubmit = async () => {
  error.value = null;
  isSaving.value = true;
  try {
    const data = {
      name: formData.value.name,
      prompt: formData.value.prompt,
      nextTemplateId: formData.value.nextTemplateId || undefined,
      thinkingEnabled: formData.value.thinkingEnabled,  // null = inherit, true/false = explicit
      gitBranch: formData.value.gitBranch || undefined,
      model: formData.value.model,                      // null = inherit
      mode: formData.value.mode,                        // null = inherit
    };

    await templatesStore.updateTemplate(templateId.value, data);
    uiStore.success('Template updated');

    router.push(`/projects/${projectId.value}/templates`);
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
  error.value = null;
  try {
    await templatesStore.deleteTemplate(templateId.value);
    uiStore.success('Template deleted');
    showDeleteConfirm.value = false;

    router.push(`/projects/${projectId.value}/templates`);
  } catch (err) {
    error.value = err.message;
    uiStore.error(err.message);
  } finally {
    isDeleting.value = false;
  }
};

onMounted(async () => {
  await loadTemplate();
});
</script>

<style scoped>
.template-detail {
  max-width: 700px;
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

.template-form {
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

.form-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background-color: var(--color-bg-soft);
}

.form-input::placeholder {
  color: var(--color-text-soft);
}

textarea.form-textarea {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  resize: vertical;
  min-height: 120px;
  line-height: 1.5;
}

.form-help {
  font-size: 0.85rem;
  color: var(--color-text-soft);
  margin: 0;
}

.form-help code {
  background: var(--color-bg-soft);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-size: 0.8rem;
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
  .template-detail {
    padding: 1rem;
  }

  .form-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .template-form {
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
