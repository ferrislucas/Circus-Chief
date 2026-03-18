<template>
  <div class="templates-panel">
    <div class="templates-header">
      <h2>Session Templates</h2>
      <button
        class="btn btn-primary btn-sm"
        @click="openCreateForm"
        v-if="!showCreateForm"
        data-testid="new-template-btn"
      >
        New Template
      </button>
    </div>

    <!-- Create Template Form -->
    <div v-if="showCreateForm" class="template-form card" data-testid="template-form">
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
          />
        </div>

        <div class="form-group">
          <label class="form-label">Prompt</label>
          <textarea
            v-model="formData.prompt"
            class="form-input form-textarea"
            placeholder="Session prompt. Use {{parentSession.summary}} to reference parent session data."
            rows="4"
            required
          ></textarea>
          <p class="form-help">
            Available variables: <code v-pre>{{parentSession.summary}}</code>, <code v-pre>{{parentSession.status}}</code>, <code v-pre>{{parentSession.name}}</code>, <code v-pre>{{rootSession.id}}</code>, <code v-pre>{{rootSession.name}}</code>, <code v-pre>{{rootSession.summary}}</code>, <code v-pre>{{rootSession.status}}</code>
          </p>
        </div>

        <div class="form-group">
          <label class="form-label">Scope</label>
          <select v-model="formData.isGlobal" class="form-input" :disabled="editingTemplate">
            <option :value="false">Project Only</option>
            <option :value="true">Global (all projects)</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Next Template (Optional)</label>
          <select v-model="formData.nextTemplateId" class="form-input">
            <option :value="null">None</option>
            <option v-for="t in availableNextTemplates" :key="t.id" :value="t.id">
              {{ t.name }} {{ t.projectId ? '' : '(Global)' }}
            </option>
          </select>
          <p class="form-help">Chain another template to run after this one completes.</p>
        </div>

        <div class="form-group">
          <label class="form-label">Model</label>
          <ModelSelector v-model="formData.model" :allowEmpty="true" emptyLabel="Inherit from root session" />
        </div>

        <div class="form-group">
          <label class="form-label" for="create-mode">Mode</label>
          <select id="create-mode" v-model="formData.mode" class="form-input" data-testid="mode-select">
            <option value="plan">Plan</option>
            <option value="standard">Standard</option>
            <option value="yolo">YOLO</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="create-thinking">Extended Thinking</label>
          <select id="create-thinking" v-model="formData.thinkingEnabled" class="form-input" data-testid="thinking-select">
            <option :value="true">Enabled</option>
            <option :value="false">Disabled</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Git Branch (Optional)</label>
          <input
            v-model="formData.gitBranch"
            type="text"
            class="form-input"
            placeholder="Leave empty to inherit from root session"
          />
        </div>

        <div class="form-actions">
          <button type="button" class="btn" @click="cancelForm" data-testid="cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="saving" data-testid="submit-btn">
            <span v-if="saving" class="loading-spinner"></span>
            Create
          </button>
        </div>
      </form>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading templates...
    </div>

    <!-- Templates List -->
    <div v-else>
      <!-- Project Templates -->
      <div v-if="projectTemplates.length > 0" class="template-section">
        <h3 class="section-title">Project Templates</h3>
        <div class="templates-list">
          <router-link
            v-for="template in projectTemplates"
            :key="template.id"
            :to="`/projects/${projectId}/templates/${template.id}`"
            class="template-card card"
            :data-testid="`template-card-${template.id}`"
          >
            <div class="template-header">
              <h4 class="template-name">{{ template.name }}</h4>
            </div>
            <p class="template-prompt">{{ truncatePrompt(template.prompt) }}</p>
            <div class="template-meta">
              <span v-if="template.thinkingEnabled" class="meta-badge">Thinking</span>
              <span v-if="template.gitBranch" class="meta-badge">{{ template.gitBranch }}</span>
              <span v-if="template.model" class="meta-badge">{{ getModelName(template.model) }}</span>
              <span v-if="template.mode" class="meta-badge">{{ template.mode }}</span>
              <span v-if="template.nextTemplateId" class="meta-badge meta-badge-chain">
                Chains to: {{ getTemplateName(template.nextTemplateId) }}
              </span>
            </div>
          </router-link>
        </div>
      </div>

      <!-- Global Templates -->
      <div v-if="globalTemplates.length > 0" class="template-section">
        <h3 class="section-title">Global Templates</h3>
        <div class="templates-list">
          <router-link
            v-for="template in globalTemplates"
            :key="template.id"
            :to="`/projects/${projectId}/templates/${template.id}`"
            class="template-card card"
            :data-testid="`template-card-${template.id}`"
          >
            <div class="template-header">
              <h4 class="template-name">{{ template.name }}</h4>
            </div>
            <p class="template-prompt">{{ truncatePrompt(template.prompt) }}</p>
            <div class="template-meta">
              <span class="meta-badge meta-badge-global">Global</span>
              <span v-if="template.thinkingEnabled" class="meta-badge">Thinking</span>
              <span v-if="template.gitBranch" class="meta-badge">{{ template.gitBranch }}</span>
              <span v-if="template.model" class="meta-badge">{{ getModelName(template.model) }}</span>
              <span v-if="template.mode" class="meta-badge">{{ template.mode }}</span>
              <span v-if="template.nextTemplateId" class="meta-badge meta-badge-chain">
                Chains to: {{ getTemplateName(template.nextTemplateId) }}
              </span>
            </div>
          </router-link>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="projectTemplates.length === 0 && globalTemplates.length === 0 && !showCreateForm" class="empty-state">
        <p>No templates yet. Create a template to automate session workflows.</p>
        <button class="btn btn-primary" @click="openCreateForm" data-testid="create-template-btn">
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
  thinkingEnabled: false,
  gitBranch: '',
  model: null,
  mode: 'yolo',
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

function truncatePrompt(prompt, maxLength = 100) {
  if (prompt.length <= maxLength) return prompt;
  return prompt.substring(0, maxLength) + '...';
}

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
    thinkingEnabled: false,
    gitBranch: '',
    model: null,
    mode: 'yolo',
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
      thinkingEnabled: formData.value.thinkingEnabled || undefined,  // Send undefined if false (default)
      gitBranch: formData.value.gitBranch || undefined,
      model: formData.value.model || undefined,                      // Send undefined if null (default)
      mode: formData.value.mode === 'yolo' ? undefined : formData.value.mode,  // Send undefined if 'yolo' (default)
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

.template-card {
  padding: 1rem;
  text-decoration: none;
  color: inherit;
  display: block;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.template-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.template-header {
  margin-bottom: 0.5rem;
}

.template-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
}

.template-prompt {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: var(--color-text-soft);
  line-height: 1.4;
}

.template-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.meta-badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.4rem;
  background: var(--color-bg-soft);
  border-radius: 4px;
  color: var(--color-text-soft);
}

.meta-badge-global {
  background: var(--color-primary);
  color: white;
}

.meta-badge-chain {
  background: var(--color-warning, #f0ad4e);
  color: #333;
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
