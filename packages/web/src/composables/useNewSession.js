import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useTemplatesStore } from '../stores/templates.js';
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';
import { useQuickResponsesStore } from '../stores/quickResponses.js';
import { useProjectsStore } from '../stores/projects.js';
import { api } from './useApi.js';
import { useSubmitShortcut } from './useSubmitShortcut.js';
import { generateWorktreeBranch } from '@claudetools/shared';

/**
 * Composable for session creation form state, validation, and submission.
 * Extracts business logic from NewSessionView.vue.
 *
 * @returns {Object} Form state, handlers, and computed properties
 */
export function useNewSession() {
  const route = useRoute();
  const router = useRouter();
  const sessionsStore = useSessionsStore();
  const uiStore = useUiStore();
  const templatesStore = useTemplatesStore();
  const defaultsStore = useProjectDefaultsStore();
  const quickResponsesStore = useQuickResponsesStore();
  const projectsStore = useProjectsStore();

  // Form state
  const prompt = ref('');
  const promptHasContent = ref(false);
  const textareaRef = ref(null);
  let inputSyncTimer = null;
  let debounceTimer = null;
  const mode = ref('yolo');
  const model = ref(null);
  const providerId = ref(null);
  const loading = ref(false);
  const quickResponseSettingsOpen = ref(false);
  const showSlashCommandWizard = ref(false);

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
    const currentValue = textareaRef.value?.value || prompt.value;
    if (!loading.value && currentValue.trim()) {
      handleSubmit();
    }
  });

  const gitStatus = ref(null);
  const attachedFiles = ref([]);
  const fileAttachment = ref(null);
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

  const loadingGit = ref(false);
  const error = ref(null);
  const thinkingEnabled = ref(true);

  // Quick git feature
  const quickGitMode = ref('worktree');
  const quickWorktreeBranch = ref('');
  const editingBranch = ref(false);
  let branchDebounceTimer = null;

  const autoBranchName = ref('');

  // Debounced function to update branch name from prompt
  function updateBranchNameFromPrompt(promptValue) {
    if (branchDebounceTimer) clearTimeout(branchDebounceTimer);
    branchDebounceTimer = setTimeout(() => {
      autoBranchName.value = generateWorktreeBranch('', promptValue);
      if (!editingBranch.value) {
        quickWorktreeBranch.value = autoBranchName.value;
      }
    }, 300);
  }

  // Handle textarea input with debounced sync to reactive state
  function handleInput(event) {
    const value = event.target.value;
    const hasContent = value.trim().length > 0;

    if (promptHasContent.value !== hasContent) {
      promptHasContent.value = hasContent;
    }

    if (inputSyncTimer) clearTimeout(inputSyncTimer);
    inputSyncTimer = setTimeout(() => {
      prompt.value = value;
    }, 150);

    if (gitStatus.value?.isGitRepo) {
      updateBranchNameFromPrompt(value);
    }
  }

  // Initialize quick worktree branch when git status loads
  watch(
    () => gitStatus.value,
    (status) => {
      if (status?.isGitRepo && !autoBranchName.value) {
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

  watch(startImmediately, () => {
    usingDefaults.value.startImmediately = false;
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
    }, 500);
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
      nextTick(() => {
        if (textareaRef.value) {
          textareaRef.value.value = saved;
          promptHasContent.value = saved.trim().length > 0;
        }
      });
    }

    // Fetch project defaults FIRST to ensure model is set before ModelSelector renders
    try {
      await defaultsStore.fetchDefaults(projectId);
      const defaults = defaultsStore.getDefaultsForProject(projectId);

      if (defaults) {
        if (defaults.mode) {
          mode.value = defaults.mode;
          usingDefaults.value.mode = true;
        }
        if (defaults.model) {
          model.value = defaults.model;
          usingDefaults.value.model = true;
        } else {
          model.value = 'sonnet';
          usingDefaults.value.model = true;
        }
        if (defaults.thinkingEnabled !== null && defaults.thinkingEnabled !== undefined) {
          thinkingEnabled.value = defaults.thinkingEnabled;
          usingDefaults.value.thinkingEnabled = true;
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

    // Fetch templates for this project
    templatesStore.fetchProjectTemplates(projectId);

    // Fetch quick responses for this project
    quickResponsesStore.fetchForProject(projectId);

    // Pre-populate parent session ID if provided in route query
    if (route.query.parentSessionId) {
      parentSessionId.value = route.query.parentSessionId;
    }
  });

  function handleBranchEdit() {
    editingBranch.value = true;
  }

  function resetBranchName() {
    editingBranch.value = false;
    quickWorktreeBranch.value = autoBranchName.value;
  }

  function handleSlashCommandInsert({ text }) {
    const textarea = textareaRef.value;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = textarea.value.substring(0, start);
      const after = textarea.value.substring(end);
      textarea.value = before + text + after;
      textarea.selectionStart = textarea.selectionEnd = start + text.length;

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
      setTimeout(() => {
        handleSubmit();
      }, 0);
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
      editingBranch.value = true;
    }
    if (template.gitMode) {
      quickGitMode.value = template.gitMode;
    }

    if (template.nextTemplateId) {
      selectedTemplateId.value = template.nextTemplateId;
    }
  }

  async function handleSubmit() {
    const currentPrompt = textareaRef.value?.value || prompt.value;
    if (!currentPrompt.trim()) return;

    loading.value = true;
    error.value = null;

    try {
      const submitGitMode = quickGitMode.value && gitStatus.value?.isGitRepo ? quickGitMode.value : undefined;
      const submitGitBranch = submitGitMode ? quickWorktreeBranch.value : undefined;

      const session = await sessionsStore.createSession(route.params.id, {
        prompt: currentPrompt,
        mode: mode.value,
        model: model.value,
        providerId: providerId.value,
        thinkingEnabled: thinkingEnabled.value,
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
      localStorage.removeItem(storageKey.value);
      router.push(`/sessions/${session.id}`);
    } catch (err) {
      error.value = err.message;
    } finally {
      loading.value = false;
    }
  }

  return {
    // Route
    route,

    // Form state
    prompt,
    promptHasContent,
    textareaRef,
    mode,
    model,
    providerId,
    loading,
    error,
    quickResponseSettingsOpen,
    showSlashCommandWizard,
    thinkingEnabled,
    startImmediately,
    schedulingData,
    attachedFiles,
    fileAttachment,
    selectedTemplateId,
    startFromTemplateId,
    parentSessionId,

    // Git state
    gitStatus,
    loadingGit,
    quickGitMode,
    quickWorktreeBranch,
    editingBranch,
    autoBranchName,

    // Defaults tracking
    usingDefaults,

    // Computed
    projectTemplates,
    globalTemplates,
    allTemplates,
    workingDirectory,
    availableSessions,

    // Handlers
    handleKeydown,
    handleInput,
    handleSubmit,
    handleBranchEdit,
    resetBranchName,
    handleSlashCommandInsert,
    handleQuickResponseInsert,
    handleStartFromTemplateChange,
  };
}
