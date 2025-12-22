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
      <h3>{{ editingTemplate ? 'Edit Template' : 'Create Template' }}</h3>
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
            Available variables: <code v-pre>{{parentSession.summary}}</code>, <code v-pre>{{parentSession.status}}</code>, <code v-pre>{{parentSession.name}}</code>
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

        <div class="form-row">
          <div class="form-group">
            <label class="form-check">
              <input type="checkbox" v-model="formData.thinkingEnabled" />
              Enable Extended Thinking
            </label>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Git Branch (Optional)</label>
          <input
            v-model="formData.gitBranch"
            type="text"
            class="form-input"
            placeholder="Branch name"
          />
        </div>

        <div class="form-actions">
          <button type="button" class="btn" @click="cancelForm" data-testid="cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary" :disabled="saving" data-testid="submit-btn">
            <span v-if="saving" class="loading-spinner"></span>
            {{ editingTemplate ? 'Update' : 'Create' }}
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
          <div v-for="template in projectTemplates" :key="template.id" class="template-card card" :data-testid="`template-card-${template.id}`">
            <div class="template-header">
              <h4 class="template-name">{{ template.name }}</h4>
              <div class="template-actions">
                <button class="btn-icon" @click="editTemplate(template)" title="Edit" data-testid="edit-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button class="btn-icon btn-icon-danger" @click="handleDelete(template)" title="Delete" data-testid="delete-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
            <p class="template-prompt">{{ truncatePrompt(template.prompt) }}</p>
            <div class="template-meta">
              <span v-if="template.thinkingEnabled" class="meta-badge">Thinking</span>
              <span v-if="template.gitBranch" class="meta-badge">{{ template.gitBranch }}</span>
              <span v-if="template.nextTemplateId" class="meta-badge meta-badge-chain">
                Chains to: {{ getTemplateName(template.nextTemplateId) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Global Templates -->
      <div v-if="globalTemplates.length > 0" class="template-section">
        <h3 class="section-title">Global Templates</h3>
        <div class="templates-list">
          <div v-for="template in globalTemplates" :key="template.id" class="template-card card" :data-testid="`template-card-${template.id}`">
            <div class="template-header">
              <h4 class="template-name">{{ template.name }}</h4>
              <div class="template-actions">
                <button class="btn-icon" @click="editTemplate(template)" title="Edit" data-testid="edit-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button class="btn-icon btn-icon-danger" @click="handleDelete(template)" title="Delete" data-testid="delete-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
            <p class="template-prompt">{{ truncatePrompt(template.prompt) }}</p>
            <div class="template-meta">
              <span class="meta-badge meta-badge-global">Global</span>
              <span v-if="template.thinkingEnabled" class="meta-badge">Thinking</span>
              <span v-if="template.gitBranch" class="meta-badge">{{ template.gitBranch }}</span>
              <span v-if="template.nextTemplateId" class="meta-badge meta-badge-chain">
                Chains to: {{ getTemplateName(template.nextTemplateId) }}
              </span>
            </div>
          </div>
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

const props = defineProps({
  projectId: { type: String, required: true },
});

const templatesStore = useTemplatesStore();
const uiStore = useUiStore();

const showCreateForm = ref(false);
const editingTemplate = ref(null);
const saving = ref(false);

const formData = ref({
  name: '',
  prompt: '',
  isGlobal: false,
  nextTemplateId: null,
  thinkingEnabled: false,
  gitBranch: '',
});

const loading = computed(() => templatesStore.loading);
const projectTemplates = computed(() => templatesStore.projectTemplates);
const globalTemplates = computed(() => templatesStore.globalTemplates);

const availableNextTemplates = computed(() => {
  const all = [...templatesStore.projectTemplates, ...templatesStore.globalTemplates];
  // Exclude the current template being edited
  if (editingTemplate.value) {
    return all.filter((t) => t.id !== editingTemplate.value.id);
  }
  return all;
});

onMounted(() => {
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

function resetForm() {
  formData.value = {
    name: '',
    prompt: '',
    isGlobal: false,
    nextTemplateId: null,
    thinkingEnabled: false,
    gitBranch: '',
  };
  editingTemplate.value = null;
}

function openCreateForm() {
  showCreateForm.value = true;
}

function cancelForm() {
  showCreateForm.value = false;
  resetForm();
}

function editTemplate(template) {
  editingTemplate.value = template;
  formData.value = {
    name: template.name,
    prompt: template.prompt,
    isGlobal: !template.projectId,
    nextTemplateId: template.nextTemplateId || null,
    thinkingEnabled: template.thinkingEnabled || false,
    gitBranch: template.gitBranch || '',
  };
  showCreateForm.value = true;
}

async function handleSubmit() {
  if (saving.value) return;

  saving.value = true;
  try {
    const data = {
      name: formData.value.name,
      prompt: formData.value.prompt,
      nextTemplateId: formData.value.nextTemplateId || undefined,
      thinkingEnabled: formData.value.thinkingEnabled || undefined,
      gitBranch: formData.value.gitBranch || undefined,
    };

    if (editingTemplate.value) {
      await templatesStore.updateTemplate(editingTemplate.value.id, data);
      uiStore.success('Template updated');
    } else if (formData.value.isGlobal) {
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

async function handleDelete(template) {
  if (!confirm(`Delete template "${template.name}"?`)) return;

  try {
    await templatesStore.deleteTemplate(template.id);
    uiStore.success('Template deleted');
  } catch (err) {
    uiStore.error(err.message);
  }
}
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
}

.template-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}

.template-name {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.template-actions {
  display: flex;
  gap: 0.25rem;
}

.btn-icon {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-soft);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon:hover {
  background: var(--color-bg-soft);
  color: var(--color-text);
}

.btn-icon-danger:hover {
  color: var(--color-error);
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
