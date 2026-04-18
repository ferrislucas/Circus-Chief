<template>
  <div class="container">
    <router-link
      :to="`/projects/${route.params.id}/sessions`"
      class="back-link"
    >
      &larr; Sessions
    </router-link>
    <h1>New Session</h1>

    <form
      class="form card"
      @submit.prevent="handleSubmit"
    >
      <!-- Start From Template selector (Rec 7: slimmed down) -->
      <div
        v-if="allTemplates.length > 0"
        class="form-group"
      >
        <label
          class="form-label"
          for="start-from-template"
        >Start From Template</label>
        <select
          id="start-from-template"
          v-model="startFromTemplateId"
          class="form-input"
          title="Selecting a template will populate all form fields below. You can still edit before starting."
          @change="handleStartFromTemplateChange"
        >
          <option :value="null">
            Select a template to pre-fill...
          </option>
          <optgroup
            v-if="projectTemplates.length"
            label="Project Templates"
          >
            <option
              v-for="template in projectTemplates"
              :key="template.id"
              :value="template.id"
            >
              {{ template.name }}
            </option>
          </optgroup>
          <optgroup
            v-if="globalTemplates.length"
            label="Global Templates"
          >
            <option
              v-for="template in globalTemplates"
              :key="template.id"
              :value="template.id"
            >
              {{ template.name }}
            </option>
          </optgroup>
        </select>
      </div>

      <div class="form-group">
        <ResizableTextarea
          id="prompt"
          ref="textareaRef"
          class="form-input form-textarea"
          placeholder="What would you like the agent to help you with?"
          :min-height="textareaMinHeight"
          required
          @input="handleInput"
          @keydown="handleKeydown"
        />
        <div class="attachment-row">
          <FileAttachment
            ref="fileAttachment"
            @update:files="attachedFiles = $event"
          />
          <SlashCommandButton
            v-if="workingDirectory"
            @open="showSlashCommandWizard = true"
          />
        </div>
      </div>

      <!-- Quick Responses Panel -->
      <QuickResponsesPanel
        :show-empty="true"
        @insert="handleQuickResponseInsert"
        @open-settings="quickResponseSettingsOpen = true"
      />

      <SessionFormOptions
        :mode="mode"
        :model="model"
        :effort-level="effortLevel"
        :thinking-enabled="thinkingEnabled"
        :start-immediately="startImmediately"
        @update:mode="mode = $event"
        @update:model="model = $event"
        @update:provider-id="providerId = $event"
        @update:effort-level="effortLevel = $event"
        @update:thinking-enabled="thinkingEnabled = $event"
        @update:start-immediately="startImmediately = $event"
      />

      <div
        v-if="error"
        class="error-message"
      >
        {{ error }}
      </div>

      <!-- Git Options -->
      <GitOptionsPanel
        :git-status="gitStatus"
        :model-value="quickGitMode"
        :branch-name="quickWorktreeBranch"
        :auto-branch-name="autoBranchName"
        :editing-branch="editingBranch"
        :loading-git="loadingGit"
        @update:model-value="quickGitMode = $event"
        @update:branch-name="quickWorktreeBranch = $event"
        @branch-edit="handleBranchEdit"
        @reset-branch="resetBranchName"
      />

      <!-- Advanced Options — shown inline (no collapsible) when relevant -->
      <div
        v-if="showAdvancedOptions"
        ref="advancedOptionsRef"
        class="advanced-options"
      >
        <!-- Scheduling Options (hidden when starting immediately) -->
        <SchedulingOptions
          v-if="!startImmediately"
          v-model="schedulingData"
        />

        <!-- Next Template (optional) -->
        <div
          v-if="allTemplates.length > 0"
          class="form-group"
        >
          <label
            class="form-label"
            for="template"
          >Next Template (optional)</label>
          <select
            id="template"
            v-model="selectedTemplateId"
            class="form-input"
          >
            <option :value="null">
              None - single session
            </option>
            <optgroup
              v-if="projectTemplates.length"
              label="Project Templates"
            >
              <option
                v-for="template in projectTemplates"
                :key="template.id"
                :value="template.id"
              >
                {{ template.name }}
              </option>
            </optgroup>
            <optgroup
              v-if="globalTemplates.length"
              label="Global Templates"
            >
              <option
                v-for="template in globalTemplates"
                :key="template.id"
                :value="template.id"
              >
                {{ template.name }}
              </option>
            </optgroup>
          </select>
          <p class="form-help">
            After this session completes, the selected template will automatically start a new session.
          </p>
        </div>

        <!-- Parent Session (optional) -->
        <div
          v-if="availableSessions.length > 0"
          class="form-group"
        >
          <label
            class="form-label"
            for="parent-session"
          >Parent Session (optional)</label>
          <select
            id="parent-session"
            v-model="parentSessionId"
            class="form-input"
          >
            <option :value="null">
              None - create standalone session
            </option>
            <option
              v-for="session in availableSessions"
              :key="session.id"
              :value="session.id"
            >
              {{ session.name }}
            </option>
          </select>
          <p class="form-help">
            Choose a parent session to link this as a child session. Child sessions help organize related work.
          </p>
        </div>
      </div>

      <!-- Submit + Cancel (Rec 1: moved to bottom, sticky on mobile) -->
      <div class="form-actions">
        <button
          type="button"
          class="btn btn-secondary"
          @click="goBack"
        >
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-primary btn-submit"
          :disabled="loading"
        >
          <span
            v-if="loading"
            class="loading-spinner"
          />
          {{ startImmediately ? 'Start Session' : 'Create Draft' }}
        </button>
      </div>
    </form>

    <!-- Slash Command Wizard Modal -->
    <SlashCommandWizard
      v-model:is-open="showSlashCommandWizard"
      :working-directory="workingDirectory || ''"
      mode="insert"
      :hide-builtin="true"
      @insert="handleSlashCommandInsert"
    />

    <!-- Quick Response Settings Modal -->
    <QuickResponseSettings
      :is-open="quickResponseSettingsOpen"
      :project-id="route.params.id"
      @close="quickResponseSettingsOpen = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';
import { api } from '../composables/useApi.js';
import { useSubmitShortcut } from '../composables/useSubmitShortcut.js';
import {
  useNewSessionForm,
  insertTextAtCursor,
  insertQuickResponse,
  applyTemplateToForm,
  buildSessionPayload,
} from '../composables/useNewSessionForm.js';
import FileAttachment from '../components/FileAttachment.vue';
import SessionFormOptions from '../components/SessionFormOptions.vue';
import GitOptionsPanel from '../components/GitOptionsPanel.vue';
import SchedulingOptions from '../components/SchedulingOptions.vue';
import ResizableTextarea from '../components/ResizableTextarea.vue';
import SlashCommandButton from '../components/SlashCommandButton.vue';
import SlashCommandWizard from '../components/SlashCommandWizard.vue';
import { useProjectsStore } from '../stores/projects.js';
import { useQuickResponsesStore } from '../stores/quickResponses.js';
import QuickResponsesPanel from '../components/QuickResponsesPanel.vue';
import QuickResponseSettings from '../components/QuickResponseSettings.vue';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const uiStore = useUiStore();
const templatesStore = useTemplatesStore();
const defaultsStore = useProjectDefaultsStore();
const projectsStore = useProjectsStore();

const storageKey = computed(() => `new-session-draft-${route.params.id}`);
const formState = useNewSessionForm(storageKey);
const {
  prompt, promptHasContent, mode, model, providerId, thinkingEnabled, effortLevel,
  startImmediately, quickGitMode, quickWorktreeBranch, editingBranch, autoBranchName,
  selectedTemplateId, startFromTemplateId, parentSessionId, schedulingData, usingDefaults,
  applyProjectDefaults, restoreDraftFromStorage, resetSchedulingData,
  handleBranchEdit, resetBranchName, updateAutoBranchName,
} = formState;

const textareaRef = ref(null);
let inputSyncTimer = null;
let debounceTimer = null;
let branchDebounceTimer = null;
const loading = ref(false);
const showSlashCommandWizard = ref(false);
const quickResponseSettingsOpen = ref(false);

// Rec 9: Responsive textarea min height
const textareaMinHeight = computed(() => window.innerWidth <= 480 ? 80 : 120);

// Create keyboard shortcut handler for form submission
const handleKeydown = useSubmitShortcut(() => {
  const currentValue = textareaRef.value?.value || prompt.value;
  if (!loading.value && currentValue.trim()) {
    handleSubmit();
  }
});
const gitStatus = ref(null);
const attachedFiles = ref([]);
const fileAttachment = ref(null);
const advancedOptionsRef = ref(null);

const projectTemplates = computed(() => templatesStore.projectTemplates);
const globalTemplates = computed(() => templatesStore.globalTemplates);
const allTemplates = computed(() => [...projectTemplates.value, ...globalTemplates.value]);

// Get working directory for slash commands
const workingDirectory = computed(() => {
  const project = projectsStore.getProjectById(route.params.id);
  return project?.workingDirectory || null;
});

// Get available sessions that can be parents (completed sessions only)
const availableSessions = computed(() => sessionsStore.sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));

// Rec 4: Show advanced options only when there's content to show
const showAdvancedOptions = computed(() => !startImmediately.value || allTemplates.value.length > 0 || availableSessions.value.length > 0);

const loadingGit = ref(false);
const error = ref(null);

// Handle textarea input with debounced sync to reactive state
function handleInput(event) {
  const value = event.target.value;
  const hasContent = value.trim().length > 0;
  if (promptHasContent.value !== hasContent) promptHasContent.value = hasContent;
  if (inputSyncTimer) clearTimeout(inputSyncTimer);
  inputSyncTimer = setTimeout(() => { prompt.value = value; }, 150);
  if (gitStatus.value?.isGitRepo) {
    if (branchDebounceTimer) clearTimeout(branchDebounceTimer);
    branchDebounceTimer = setTimeout(() => updateAutoBranchName(value), 300);
  }
}

// Initialize quick worktree branch when git status loads
watch(() => gitStatus.value, (status) => {
  if (status?.isGitRepo && !autoBranchName.value) {
    updateAutoBranchName(prompt.value);
  }
}, { immediate: true });

// Track when fields are overridden by user
watch(mode, () => { usingDefaults.value.mode = false; });
watch(model, () => { usingDefaults.value.model = false; });
watch(thinkingEnabled, () => { usingDefaults.value.thinkingEnabled = false; });

// Rec 3: Reset scheduling data when startImmediately is toggled on
watch(startImmediately, (newVal) => {
  usingDefaults.value.startImmediately = false;
  if (newVal) {
    resetSchedulingData();
  } else {
    nextTick(() => {
      advancedOptionsRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
});

watch(quickGitMode, () => { usingDefaults.value.quickGitMode = false; });
watch(quickWorktreeBranch, () => { usingDefaults.value.quickWorktreeBranch = false; });

// Watch prompt for localStorage persistence with debouncing
watch(prompt, (newValue) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (newValue.trim()) {
      localStorage.setItem(storageKey.value, newValue);
    } else {
      localStorage.removeItem(storageKey.value);
    }
  }, 500); // 500ms debounce to avoid excessive writes
});

// Cleanup timers on unmount
onUnmounted(() => {
  if (branchDebounceTimer) clearTimeout(branchDebounceTimer);
  if (inputSyncTimer) clearTimeout(inputSyncTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
});

onMounted(async () => {
  const projectId = route.params.id;
  restoreDraftFromStorage(textareaRef);

  // Fetch project defaults FIRST to ensure model is set before ModelSelector renders
  try {
    await defaultsStore.fetchDefaults(projectId);
    const defaults = defaultsStore.getDefaultsForProject(projectId);
    if (defaults) {
      applyProjectDefaults(defaults);
    } else {
      model.value = 'sonnet';
      usingDefaults.value.model = true;
    }
  } catch (err) {
    console.warn('Failed to fetch project defaults:', err);
    if (!model.value) {
      model.value = 'sonnet';
      usingDefaults.value.model = true;
    }
  }

  loadingGit.value = true;
  try {
    gitStatus.value = await api.getGitStatus(projectId);
  } catch {
    // Git status is optional
  } finally {
    loadingGit.value = false;
  }

  templatesStore.fetchProjectTemplates(projectId);
  const quickResponsesStore = useQuickResponsesStore();
  quickResponsesStore.fetchForProject(projectId);
  if (route.query.parentSessionId) parentSessionId.value = route.query.parentSessionId;
});

// Rec 1: Navigate back to sessions list
function goBack() {
  router.push(`/projects/${route.params.id}/sessions`);
}

function handleSlashCommandInsert({ text }) {
  insertTextAtCursor(textareaRef.value, text);
}

function handleQuickResponseInsert({ content, autoSubmit }) {
  insertQuickResponse(textareaRef.value, content);
  if (autoSubmit) {
    setTimeout(() => handleSubmit(), 0);
  } else {
    textareaRef.value?.blur();
  }
}

function handleStartFromTemplateChange() {
  const template = startFromTemplateId.value && templatesStore.getTemplateById(startFromTemplateId.value);
  applyTemplateToForm(template, formState, textareaRef);
}

async function handleSubmit() {
  const currentPrompt = textareaRef.value?.value || prompt.value;
  if (!currentPrompt.trim()) return;

  loading.value = true;
  error.value = null;

  try {
    const payload = buildSessionPayload(formState, {
      currentPrompt,
      gitStatus: gitStatus.value,
      files: attachedFiles.value,
    });
    const session = await sessionsStore.createSession(route.params.id, payload);
    fileAttachment.value?.clear();
    localStorage.removeItem(storageKey.value);
    router.push(`/sessions/${session.id}?overlay=open`);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.back-link {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  display: inline-block;
  margin-bottom: 0.25rem;
  margin-top: 0;
}

h1 {
  margin-bottom: 0.5rem;
  margin-top: 0;
}

.form {
  width: 100%;
}

.form-help {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.attachment-row {
  margin-top: 0.5rem;
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 1rem;
}

.btn-submit {
  flex: 1;
  justify-content: center;
  text-align: center;
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
  font-size: 1.05rem;
}

.btn-secondary {
  padding: 0.75rem 1.25rem;
  font-size: 1.05rem;
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  border-radius: var(--border-radius, 4px);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.btn-secondary:hover {
  border-color: var(--color-border-hover);
  color: var(--color-text);
}

.error-message {
  color: var(--color-error);
  margin-bottom: 1rem;
}

.advanced-options {
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
}

@media (max-width: 480px) {
  h1 {
    margin-bottom: 0.5rem;
    font-size: 1.5rem;
  }

  .form.card {
    padding: 0.75rem;
  }
}

@media (max-width: 640px) {
  .form-actions {
    position: sticky;
    bottom: 0;
    background: var(--color-background-soft, var(--color-bg-soft, #1a1a2e));
    border-top: 1px solid var(--color-border);
    padding: 0.75rem 1rem;
    margin: 0 -1rem -1rem;
    padding-bottom: calc(0.75rem + env(safe-area-inset-bottom));
    z-index: 10;
  }
}
</style>
