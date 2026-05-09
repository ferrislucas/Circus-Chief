<template>
  <div class="templates-panel">
    <div class="templates-header">
      <h2>Session Templates</h2>
      <button
        v-if="!showCreateForm"
        class="btn btn-primary btn-sm"
        data-testid="new-template-btn"
        @click="openCreateForm"
      >
        New Template
      </button>
    </div>

    <!-- Create Template Form -->
    <div
      v-if="showCreateForm"
      class="template-form card"
      data-testid="template-form"
    >
      <h3>Create Template</h3>
      <form @submit.prevent="handleSubmit">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input
            v-model="formData.name"
            type="text"
            class="form-input"
            placeholder="Template name"
            required
          >
        </div>

        <div class="form-group">
          <label class="form-label">Prompt</label>
          <textarea
            v-model="formData.prompt"
            class="form-input form-textarea"
            placeholder="Session prompt. Use {{rootSession.summary}} to reference root session data."
            rows="4"
            required
          />
          <InterpolationHelp />
        </div>

        <div class="form-group">
          <label class="form-label">Scope</label>
          <select
            v-model="formData.isGlobal"
            class="form-input"
            :disabled="editingTemplate"
          >
            <option :value="false">
              Project Only
            </option>
            <option :value="true">
              Global (all projects)
            </option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Next Template (Optional)</label>
          <select
            v-model="formData.nextTemplateId"
            class="form-input"
          >
            <option :value="null">
              None
            </option>
            <option
              v-for="t in availableNextTemplates"
              :key="t.id"
              :value="t.id"
            >
              {{ t.name }} {{ t.projectId ? '' : '(Global)' }}
            </option>
          </select>
          <p class="form-help">
            Chain another template to run after this one completes.
          </p>
        </div>

        <div class="form-group">
          <label class="form-label">Model</label>
          <ModelSelector
            v-model="formData.model"
            :allow-empty="true"
            empty-label="Inherit from root session"
          />
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="create-mode"
          >Mode</label>
          <select
            id="create-mode"
            v-model="formData.mode"
            class="form-input"
            data-testid="mode-select"
          >
            <option :value="null">
              Inherit from root session
            </option>
            <option value="plan">
              Plan
            </option>
            <option value="standard">
              Standard
            </option>
            <option value="yolo">
              YOLO
            </option>
          </select>
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="create-thinking"
          >Extended Thinking</label>
          <select
            id="create-thinking"
            v-model="formData.thinkingEnabled"
            class="form-input"
            data-testid="thinking-select"
          >
            <option :value="null">
              Inherit from root session
            </option>
            <option :value="true">
              Enabled
            </option>
            <option :value="false">
              Disabled
            </option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Git Branch (Optional)</label>
          <input
            v-model="formData.gitBranch"
            type="text"
            class="form-input"
            placeholder="Leave empty to inherit from root session"
          >
        </div>

        <div class="form-group">
          <label class="form-check">
            <input
              v-model="formData.showInQuickResponses"
              type="checkbox"
            >
            <span>Show in Quick Responses</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-check">
            <input
              v-model="formData.quickResponseAutoSubmit"
              type="checkbox"
              :disabled="!formData.showInQuickResponses"
            >
            <span>Auto-submit from Quick Responses</span>
          </label>
        </div>

        <div class="form-actions">
          <button
            type="button"
            class="btn"
            data-testid="cancel-btn"
            @click="cancelForm"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="saving"
            data-testid="submit-btn"
          >
            <span
              v-if="saving"
              class="loading-spinner"
            />
            Create
          </button>
        </div>
      </form>
    </div>

    <!-- Loading State -->
    <div
      v-if="loading"
      class="loading-state"
    >
      <span class="loading-spinner" />
      Loading templates...
    </div>

    <!-- Templates List -->
    <div v-else>
      <!-- Project Templates -->
      <div
        v-if="projectTemplates.length > 0"
        class="template-section"
      >
        <h3 class="section-title">
          Project Templates
        </h3>
        <div class="templates-list">
          <TemplateCard
            v-for="template in projectTemplates"
            :key="template.id"
            :template="template"
            :project-id="projectId"
            :get-model-name="getModelName"
            :get-template-name="getTemplateName"
          />
        </div>
      </div>

      <!-- Global Templates -->
      <div
        v-if="globalTemplates.length > 0"
        class="template-section"
      >
        <h3 class="section-title">
          Global Templates
        </h3>
        <div class="templates-list">
          <TemplateCard
            v-for="template in globalTemplates"
            :key="template.id"
            :template="template"
            :project-id="projectId"
            :is-global="true"
            :get-model-name="getModelName"
            :get-template-name="getTemplateName"
          />
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-if="projectTemplates.length === 0 && globalTemplates.length === 0 && !showCreateForm"
        class="empty-state"
      >
        <p>No templates yet. Create a template to automate session workflows.</p>
        <button
          class="btn btn-primary"
          data-testid="create-template-btn"
          @click="openCreateForm"
        >
          Create Template
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useTemplatesStore } from '../stores/templates.js';
import { useUiStore } from '../stores/ui.js';
import { useProvidersStore } from '../stores/providers.js';
import ModelSelector from './ModelSelector.vue';
import InterpolationHelp from './InterpolationHelp.vue';
import TemplateCard from './TemplateCard.vue';

const props = defineProps({
  projectId: { type: String, required: true },
});

const templatesStore = useTemplatesStore();
const uiStore = useUiStore();
const providersStore = useProvidersStore();

const showCreateForm = ref(false);
const saving = ref(false);

const formData = ref({
  name: '',
  prompt: '',
  isGlobal: false,
  nextTemplateId: null,
  thinkingEnabled: null,
  gitBranch: '',
  model: null,
  mode: null,
  showInQuickResponses: false,
  quickResponseAutoSubmit: false,
});

const loading = computed(() => templatesStore.loading);
const projectTemplates = computed(() => templatesStore.projectTemplates);
const globalTemplates = computed(() => templatesStore.globalTemplates);

const availableNextTemplates = computed(() => {
  const all = [...templatesStore.projectTemplates, ...templatesStore.globalTemplates];
  return all;
});

onMounted(async () => {
  // Ensure providers with models are loaded
  if (providersStore.providers.length === 0) {
    await providersStore.fetchProviders();
  }
  templatesStore.fetchProjectTemplates(props.projectId);
});

watch(
  () => props.projectId,
  (newId) => {
    templatesStore.fetchProjectTemplates(newId);
  }
);

function getTemplateName(templateId) {
  const template = templatesStore.getTemplateById(templateId);
  return template?.name || 'Unknown';
}

function getModelName(modelId) {
  // Search through all providers and their models
  for (const provider of providersStore.providers) {
    const model = provider.models?.find(m => m.modelId === modelId);
    if (model) {
      return provider.isBuiltIn ? model.displayName : model.modelId;
    }
  }
  return modelId;
}

function resetForm() {
  formData.value = {
    name: '',
    prompt: '',
    isGlobal: false,
    nextTemplateId: null,
    thinkingEnabled: null,
    gitBranch: '',
    model: null,
    mode: null,
    showInQuickResponses: false,
    quickResponseAutoSubmit: false,
  };
}

function openCreateForm() {
  showCreateForm.value = true;
}

function cancelForm() {
  showCreateForm.value = false;
  resetForm();
}

async function handleSubmit() {
  if (saving.value) return;

  saving.value = true;
  try {
    const data = {
      name: formData.value.name,
      prompt: formData.value.prompt,
      nextTemplateId: formData.value.nextTemplateId || undefined,
      thinkingEnabled: formData.value.thinkingEnabled,  // null = inherit, true/false = explicit
      gitBranch: formData.value.gitBranch || undefined,
      model: formData.value.model,                      // null = inherit
      mode: formData.value.mode,                        // null = inherit
      showInQuickResponses: formData.value.showInQuickResponses,
      quickResponseAutoSubmit: formData.value.showInQuickResponses
        ? formData.value.quickResponseAutoSubmit
        : false,
    };

    if (formData.value.isGlobal) {
      await templatesStore.createGlobalTemplate(data);
      uiStore.success('Global template created');
    } else {
      await templatesStore.createProjectTemplate(props.projectId, data);
      uiStore.success('Template created');
    }

    cancelForm();
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    saving.value = false;
  }
}

watch(
  () => formData.value.showInQuickResponses,
  (showInQuickResponses) => {
    if (!showInQuickResponses) {
      formData.value.quickResponseAutoSubmit = false;
    }
  }
);

// Expose for testing
defineExpose({
  formData,
  getModelName,
  resetForm,
});
</script>

<style scoped>
.templates-panel {
  padding: 1rem 0;
}

.templates-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.templates-header h2 {
  margin: 0;
  font-size: 1.25rem;
}

.template-form {
  margin-bottom: 1.5rem;
}

.template-form h3 {
  margin: 0 0 1rem;
  font-size: 1rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-label {
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 500;
  font-size: 0.875rem;
}

.form-help {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.form-help code {
  background: var(--color-bg-soft);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-size: 0.7rem;
}

.form-check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
}

.form-check input {
  cursor: pointer;
}

.form-row {
  display: flex;
  gap: 1rem;
}

.form-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 1rem;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
}

.template-section {
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  margin: 0 0 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.templates-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-soft);
}

.empty-state p {
  margin-bottom: 1rem;
}

.btn-sm {
  padding: 0.35rem 0.75rem;
  font-size: 0.875rem;
}

@media (max-width: 480px) {
  .templates-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .form-row {
    flex-direction: column;
  }
}
</style>
