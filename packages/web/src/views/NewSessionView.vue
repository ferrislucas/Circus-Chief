<template>
  <div class="container">
    <router-link :to="`/projects/${route.params.id}/sessions`" class="back-link">
      &larr; Sessions
    </router-link>
    <h1>New Session</h1>

    <form @submit.prevent="handleSubmit" class="form card">
      <!-- Start From Template selector (Rec 7: slimmed down) -->
      <div v-if="allTemplates.length > 0" class="form-group">
        <label class="form-label" for="start-from-template">Start From Template</label>
        <select id="start-from-template" v-model="startFromTemplateId" class="form-input" @change="handleStartFromTemplateChange" title="Selecting a template will populate all form fields below. You can still edit before starting.">
          <option :value="null">Select a template to pre-fill...</option>
          <optgroup v-if="projectTemplates.length" label="Project Templates">
            <option v-for="template in projectTemplates" :key="template.id" :value="template.id">
              {{ template.name }}
            </option>
          </optgroup>
          <optgroup v-if="globalTemplates.length" label="Global Templates">
            <option v-for="template in globalTemplates" :key="template.id" :value="template.id">
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
          placeholder="What would you like Claude to help you with?"
          :min-height="textareaMinHeight"
          required
          @input="handleInput"
          @keydown="handleKeydown"
        />
        <div class="attachment-row">
          <FileAttachment ref="fileAttachment" @update:files="attachedFiles = $event" />
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
        @openSettings="quickResponseSettingsOpen = true"
      />

      <SessionFormOptions
        :mode="mode"
        :model="model"
        :effortLevel="effortLevel"
        :thinkingEnabled="thinkingEnabled"
        :startImmediately="startImmediately"
        @update:mode="mode = $event"
        @update:model="model = $event"
        @update:providerId="providerId = $event"
        @update:effortLevel="effortLevel = $event"
        @update:thinkingEnabled="thinkingEnabled = $event"
        @update:startImmediately="startImmediately = $event"
      />

      <div v-if="error" class="error-message">{{ error }}</div>

      <!-- Git Options -->
      <GitOptionsPanel
        :gitStatus="gitStatus"
        :modelValue="quickGitMode"
        :branchName="quickWorktreeBranch"
        :autoBranchName="autoBranchName"
        :editingBranch="editingBranch"
        :loadingGit="loadingGit"
        @update:modelValue="quickGitMode = $event"
        @update:branchName="quickWorktreeBranch = $event"
        @branchEdit="handleBranchEdit"
        @resetBranch="resetBranchName"
      />

      <!-- Advanced Options — shown inline (no collapsible) when relevant -->
      <div v-if="showAdvancedOptions" ref="advancedOptionsRef" class="advanced-options">
        <!-- Scheduling Options (hidden when starting immediately) -->
        <SchedulingOptions v-if="!startImmediately" v-model="schedulingData" />

        <!-- Next Template (optional) -->
        <div v-if="allTemplates.length > 0" class="form-group">
          <label class="form-label" for="template">Next Template (optional)</label>
          <select id="template" v-model="selectedTemplateId" class="form-input">
            <option :value="null">None - single session</option>
            <optgroup v-if="projectTemplates.length" label="Project Templates">
              <option v-for="template in projectTemplates" :key="template.id" :value="template.id">
                {{ template.name }}
              </option>
            </optgroup>
            <optgroup v-if="globalTemplates.length" label="Global Templates">
              <option v-for="template in globalTemplates" :key="template.id" :value="template.id">
                {{ template.name }}
              </option>
            </optgroup>
          </select>
          <p class="form-help">
            After this session completes, the selected template will automatically start a new session.
          </p>
        </div>

        <!-- Parent Session (optional) -->
        <div v-if="availableSessions.length > 0" class="form-group">
          <label class="form-label" for="parent-session">Parent Session (optional)</label>
          <select id="parent-session" v-model="parentSessionId" class="form-input">
            <option :value="null">None - create standalone session</option>
            <option v-for="session in availableSessions" :key="session.id" :value="session.id">
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
        <button type="button" class="btn btn-secondary" @click="goBack">Cancel</button>
        <button type="submit" class="btn btn-primary btn-submit" :disabled="loading">
          <span v-if="loading" class="loading-spinner"></span>
          {{ startImmediately ? 'Start Session' : 'Create Draft' }}
        </button>
      </div>
    </form>

    <!-- Slash Command Wizard Modal -->
    <SlashCommandWizard
      v-model:isOpen="showSlashCommandWizard"
      :workingDirectory="workingDirectory || ''"
      mode="insert"
      :hide-builtin="true"
      @insert="handleSlashCommandInsert"
    />

    <!-- Quick Response Settings Modal -->
    <QuickResponseSettings
      :isOpen="quickResponseSettingsOpen"
      :projectId="route.params.id"
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
import { generateWorktreeBranch } from '@claudetools/shared';
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

const prompt = ref('');
const promptHasContent = ref(false); // Tracks if textarea has content (for button disabled state)
const textareaRef = ref(null);
let inputSyncTimer = null;
let debounceTimer = null;
const mode = ref('yolo');
const model = ref(null);
const providerId = ref(null);
const loading = ref(false);
const showSlashCommandWizard = ref(false);
const quickResponseSettingsOpen = ref(false);

// Rec 9: Responsive textarea min height
const textareaMinHeight = computed(() => window.innerWidth <= 480 ? 80 : 120);


// Track which fields are using project defaults
const usingDefaults = ref({
  mode: false,
  model: false,
  thinkingEnabled: false,
  startImmediately: false,
  quickGitMode: false,
  quickWorktreeBranch: false,
});

// Create keyboard shortcut handler for form submission
const handleKeydown = useSubmitShortcut(() => {
  // Read directly from textarea to avoid reactivity lag
  const currentValue = textareaRef.value?.value || prompt.value;
  if (!loading.value && currentValue.trim()) {
    handleSubmit();
  }
});
const gitStatus = ref(null);
const attachedFiles = ref([]);
const fileAttachment = ref(null);
const advancedOptionsRef = ref(null);
const selectedTemplateId = ref(null);
const startFromTemplateId = ref(null);
const parentSessionId = ref(null);
const startImmediately = ref(true);
const schedulingData = ref({
  scheduledAt: null,
  autoRescheduleEnabled: false,
  rescheduleDelayMinutes: 15,
  rescheduleOnTokenLimit: true,
  rescheduleOnServiceError: true,
  maxRescheduleCount: null,
  maxTotalTokens: null,
  rescheduleAtTokenCount: null,
});

const projectTemplates = computed(() => templatesStore.projectTemplates);
const globalTemplates = computed(() => templatesStore.globalTemplates);
const allTemplates = computed(() => [...projectTemplates.value, ...globalTemplates.value]);

const storageKey = computed(() => `new-session-draft-${route.params.id}`);

// Get working directory for slash commands
const workingDirectory = computed(() => {
  const project = projectsStore.getProjectById(route.params.id);
  return project?.workingDirectory || null;
});

// Get available sessions that can be parents (completed sessions only)
const availableSessions = computed(() => {
  return sessionsStore.sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
});

// Rec 4: Show advanced options only when there's content to show
const showAdvancedOptions = computed(() => {
  return !startImmediately.value || allTemplates.value.length > 0 || availableSessions.value.length > 0;
});

const loadingGit = ref(false);
const error = ref(null);
const thinkingEnabled = ref(true);
const effortLevel = ref(null);

// Quick git feature
const quickGitMode = ref('worktree'); // '', 'branch', or 'worktree'
const quickWorktreeBranch = ref('');
const editingBranch = ref(false);
let branchDebounceTimer = null;

// Store the branch name (debounced to avoid regenerating random ID on every keystroke)
const autoBranchName = ref('');

// Debounced function to update branch name from prompt
function updateBranchNameFromPrompt(promptValue) {
  if (branchDebounceTimer) clearTimeout(branchDebounceTimer);
  branchDebounceTimer = setTimeout(() => {
    autoBranchName.value = generateWorktreeBranch('', promptValue);
    // Also update the input field if user hasn't manually edited it
    if (!editingBranch.value) {
      quickWorktreeBranch.value = autoBranchName.value;
    }
  }, 300);
}

// Handle textarea input with debounced sync to reactive state
// This prevents Vue reactivity from firing on every keystroke
function handleInput(event) {
  const value = event.target.value;
  const hasContent = value.trim().length > 0;

  // Only update the reactive flag if it changed (minimizes re-renders)
  if (promptHasContent.value !== hasContent) {
    promptHasContent.value = hasContent;
  }

  // Debounce the sync to reactive state
  if (inputSyncTimer) clearTimeout(inputSyncTimer);
  inputSyncTimer = setTimeout(() => {
    // Sync to reactive state (for handleSubmit to access as fallback)
    prompt.value = value;
  }, 150);

  // Update branch name (already has its own debounce)
  if (gitStatus.value?.isGitRepo) {
    updateBranchNameFromPrompt(value);
  }
}

// Initialize quick worktree branch when git status loads
watch(
  () => gitStatus.value,
  (status) => {
    if (status?.isGitRepo && !autoBranchName.value) {
      // Generate initial branch name
      autoBranchName.value = generateWorktreeBranch('', prompt.value);
      quickWorktreeBranch.value = autoBranchName.value;
    }
  },
  { immediate: true }
);

// Track when fields are overridden by user
watch(mode, () => {
  usingDefaults.value.mode = false;
});

watch(model, () => {
  usingDefaults.value.model = false;
});

watch(thinkingEnabled, () => {
  usingDefaults.value.thinkingEnabled = false;
});

// Rec 3: Reset scheduling data when startImmediately is toggled on
// Also auto-scroll to the advanced options section when toggled off
watch(startImmediately, (newVal) => {
  usingDefaults.value.startImmediately = false;
  if (newVal) {
    // Clear any scheduling data when switching to start immediately
    schedulingData.value = {
      scheduledAt: null,
      autoRescheduleEnabled: false,
      rescheduleDelayMinutes: 15,
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: true,
      maxRescheduleCount: null,
      maxTotalTokens: null,
      rescheduleAtTokenCount: null,
    };
  } else {
    // Scroll the advanced options into view after Vue renders the section
    nextTick(() => {
      advancedOptionsRef.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }
});

watch(quickGitMode, () => {
  usingDefaults.value.quickGitMode = false;
});

watch(quickWorktreeBranch, () => {
  usingDefaults.value.quickWorktreeBranch = false;
});

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

  // Restore draft from localStorage if it exists
  const saved = localStorage.getItem(storageKey.value);
  if (saved) {
    prompt.value = saved;
    // Sync to textarea DOM element after Vue has rendered
    nextTick(() => {
      if (textareaRef.value) {
        textareaRef.value.value = saved;
        // Also update the promptHasContent flag
        promptHasContent.value = saved.trim().length > 0;
      }
    });
  }

  // Fetch project defaults FIRST to ensure model is set before ModelSelector renders
  try {
    await defaultsStore.fetchDefaults(projectId);
    const defaults = defaultsStore.getDefaultsForProject(projectId);

    if (defaults) {
      // Pre-fill form with project defaults
      if (defaults.mode) {
        mode.value = defaults.mode;
        usingDefaults.value.mode = true;
      }
      if (defaults.model) {
        model.value = defaults.model;
        usingDefaults.value.model = true;
      } else {
        // No project default set, use system default
        model.value = 'sonnet';
        usingDefaults.value.model = true;
      }
      if (defaults.thinkingEnabled !== null && defaults.thinkingEnabled !== undefined) {
        thinkingEnabled.value = defaults.thinkingEnabled;
        usingDefaults.value.thinkingEnabled = true;
      }
      if (defaults.effortLevel) {
        effortLevel.value = defaults.effortLevel;
      }
      if (defaults.startImmediately !== null && defaults.startImmediately !== undefined) {
        startImmediately.value = defaults.startImmediately;
        usingDefaults.value.startImmediately = true;
      }
      if (defaults.gitMode) {
        quickGitMode.value = defaults.gitMode;
        usingDefaults.value.quickGitMode = true;
      }
      if (defaults.gitBranch) {
        quickWorktreeBranch.value = defaults.gitBranch;
        usingDefaults.value.quickWorktreeBranch = true;
      }
    } else {
      // No defaults at all, use system default for model
      model.value = 'sonnet';
      usingDefaults.value.model = true;
    }
  } catch (err) {
    // Defaults fetching is optional, don't block on error
    console.warn('Failed to fetch project defaults:', err);
    // Ensure we still have a system default
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

  // Fetch templates for this project
  templatesStore.fetchProjectTemplates(projectId);

  // Fetch quick responses for this project
  const quickResponsesStore = useQuickResponsesStore();
  quickResponsesStore.fetchForProject(projectId);

  // Pre-populate parent session ID if provided in route query
  if (route.query.parentSessionId) {
    parentSessionId.value = route.query.parentSessionId;
  }
});

// Rec 1: Navigate back to sessions list
function goBack() {
  router.push(`/projects/${route.params.id}/sessions`);
}

function handleBranchEdit() {
  editingBranch.value = true;
}

function resetBranchName() {
  editingBranch.value = false;
  quickWorktreeBranch.value = autoBranchName.value;
}

function handleSlashCommandInsert({ text }) {
  // Insert the slash command text at the cursor position in the prompt field
  const textarea = textareaRef.value;
  if (textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    textarea.value = before + text + after;
    textarea.selectionStart = textarea.selectionEnd = start + text.length;

    // Trigger input event to update prompt ref and UI
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    textarea.focus();
  }
}

function handleQuickResponseInsert({ content, autoSubmit }) {
  const textarea = textareaRef.value;
  if (!textarea) return;

  const existingText = textarea.value.trim();
  const newContent = existingText
    ? `${existingText}\n\n${content}`
    : content;

  textarea.value = newContent;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));

  if (autoSubmit) {
    setTimeout(() => handleSubmit(), 0);
  } else {
    textarea.selectionStart = textarea.selectionEnd = newContent.length;
    textarea.focus();
  }
}

function handleStartFromTemplateChange() {
  if (!startFromTemplateId.value) return;

  const template = templatesStore.getTemplateById(startFromTemplateId.value);
  if (!template) return;

  // Populate prompt
  prompt.value = template.prompt;
  if (textareaRef.value) {
    textareaRef.value.value = template.prompt;
    textareaRef.value.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Populate other fields from template
  if (template.thinkingEnabled !== null && template.thinkingEnabled !== undefined) {
    thinkingEnabled.value = template.thinkingEnabled;
  }
  if (template.model) {
    model.value = template.model;
  }
  if (template.mode) {
    mode.value = template.mode;
  }
  if (template.gitBranch) {
    quickWorktreeBranch.value = template.gitBranch;
    editingBranch.value = true; // Mark as edited so it doesn't auto-regenerate
  }
  if (template.gitMode) {
    quickGitMode.value = template.gitMode;
  }
  if (template.effortLevel !== null && template.effortLevel !== undefined) {
    effortLevel.value = template.effortLevel;
  }

  // IMPORTANT: Also set the "Next Template" dropdown to the template's nextTemplateId
  if (template.nextTemplateId) {
    selectedTemplateId.value = template.nextTemplateId;
  }
}

async function handleSubmit() {
  // Read directly from textarea in case debounce timer hasn't fired
  const currentPrompt = textareaRef.value?.value || prompt.value;
  if (!currentPrompt.trim()) return;

  loading.value = true;
  error.value = null;

  try {
    // Determine git settings
    const submitGitMode = quickGitMode.value && gitStatus.value?.isGitRepo ? quickGitMode.value : undefined;
    const submitGitBranch = submitGitMode ? quickWorktreeBranch.value : undefined;

    const session = await sessionsStore.createSession(route.params.id, {
      prompt: currentPrompt,
      mode: mode.value,
      model: model.value,
      providerId: providerId.value,
      thinkingEnabled: thinkingEnabled.value,
      effortLevel: effortLevel.value,
      startImmediately: startImmediately.value,
      gitMode: submitGitMode,
      gitBranch: submitGitBranch,
      files: attachedFiles.value,
      templateId: selectedTemplateId.value,
      parentSessionId: parentSessionId.value || null,
      // Scheduling fields
      scheduledAt: schedulingData.value.scheduledAt,
      autoRescheduleEnabled: schedulingData.value.autoRescheduleEnabled,
      rescheduleDelayMinutes: schedulingData.value.rescheduleDelayMinutes,
      rescheduleOnTokenLimit: schedulingData.value.rescheduleOnTokenLimit,
      rescheduleOnServiceError: schedulingData.value.rescheduleOnServiceError,
      maxRescheduleCount: schedulingData.value.maxRescheduleCount,
      maxTotalTokens: schedulingData.value.maxTotalTokens,
      rescheduleAtTokenCount: schedulingData.value.rescheduleAtTokenCount,
    });
    fileAttachment.value?.clear();
    // Clear the draft from localStorage after successful submission
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

/* Rec 8: Constrain form width */
.form { width: 100%; max-width: 640px; margin: 0 auto; }

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

/* Rec 1: Form actions as flex row with Cancel + Submit */
.form-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-top: 1rem;
}

.btn-submit {
  flex: 1;
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

/* Advanced Options section */
.advanced-options {
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
}

@media (max-width: 480px) {
  h1 {
    margin-bottom: 0.5rem;
    font-size: 1.5rem;
  }

  /* Rec 10: Tighten card padding on mobile */
  .form.card {
    padding: 0.75rem;
  }
}

/* Rec 1: Sticky form actions on mobile */
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
