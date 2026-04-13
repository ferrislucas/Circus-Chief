import { ref, nextTick } from 'vue';
import { generateWorktreeBranch } from '@circuschief/shared';

/**
 * Composable for managing new session form state and defaults.
 * Extracts form initialization, defaults application, and draft persistence logic.
 */
export function useNewSessionForm(storageKey) {
  const prompt = ref('');
  const promptHasContent = ref(false);
  const mode = ref('yolo');
  const model = ref(null);
  const providerId = ref(null);
  const thinkingEnabled = ref(true);
  const effortLevel = ref(null);
  const startImmediately = ref(true);
  const quickGitMode = ref('worktree');
  const quickWorktreeBranch = ref('');
  const editingBranch = ref(false);
  const autoBranchName = ref('');
  const selectedTemplateId = ref(null);
  const startFromTemplateId = ref(null);
  const parentSessionId = ref(null);
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

  // Track which fields are using project defaults
  const usingDefaults = ref({
    mode: false,
    model: false,
    thinkingEnabled: false,
    startImmediately: false,
    quickGitMode: false,
    quickWorktreeBranch: false,
  });

  /**
   * Apply project defaults to form fields.
   * @param {object} defaults - The project defaults object
   */
  function applyProjectDefaults(defaults) {
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
    if (defaults.effortLevel) effortLevel.value = defaults.effortLevel;
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
  }

  /**
   * Restore draft from localStorage and sync to textarea.
   * @param {Ref} textareaRef - Reference to the textarea element
   */
  function restoreDraftFromStorage(textareaRef) {
    const saved = localStorage.getItem(storageKey.value);
    if (!saved) return;
    prompt.value = saved;
    nextTick(() => {
      if (textareaRef.value) {
        textareaRef.value.value = saved;
        promptHasContent.value = saved.trim().length > 0;
      }
    });
  }

  /**
   * Reset scheduling data to defaults.
   */
  function resetSchedulingData() {
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
  }

  function handleBranchEdit() {
    editingBranch.value = true;
  }

  function resetBranchName() {
    editingBranch.value = false;
    quickWorktreeBranch.value = autoBranchName.value;
  }

  /**
   * Update branch name from prompt text.
   * @param {string} promptValue - The current prompt value
   */
  function updateAutoBranchName(promptValue) {
    autoBranchName.value = generateWorktreeBranch('', promptValue);
    if (!editingBranch.value) {
      quickWorktreeBranch.value = autoBranchName.value;
    }
  }

  return {
    // State
    prompt,
    promptHasContent,
    mode,
    model,
    providerId,
    thinkingEnabled,
    effortLevel,
    startImmediately,
    quickGitMode,
    quickWorktreeBranch,
    editingBranch,
    autoBranchName,
    selectedTemplateId,
    startFromTemplateId,
    parentSessionId,
    schedulingData,
    usingDefaults,
    // Methods
    applyProjectDefaults,
    restoreDraftFromStorage,
    resetSchedulingData,
    handleBranchEdit,
    resetBranchName,
    updateAutoBranchName,
  };
}

/**
 * Handle text insertion into a textarea at cursor position.
 * @param {HTMLElement} textarea - The textarea element
 * @param {string} text - The text to insert
 */
export function insertTextAtCursor(textarea, text) {
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const before = textarea.value.substring(0, start);
  const after = textarea.value.substring(end);
  textarea.value = before + text + after;
  textarea.selectionStart = textarea.selectionEnd = start + text.length;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

/**
 * Handle quick response insertion into textarea.
 * @param {HTMLElement} textarea - The textarea element
 * @param {string} content - The content to insert
 * @returns {void}
 */
export function insertQuickResponse(textarea, content) {
  if (!textarea) return;
  const existingText = textarea.value.trim();
  const newContent = existingText ? `${existingText}\n\n${content}` : content;
  textarea.value = newContent;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Apply template values to form state.
 * @param {Object} template - The template object
 * @param {Object} formState - The form state object with refs
 * @param {Ref} textareaRef - Reference to the textarea element
 */
export function applyTemplateToForm(template, formState, textareaRef) {
  if (!template) return;

  formState.prompt.value = template.prompt;
  if (textareaRef.value) {
    textareaRef.value.value = template.prompt;
    textareaRef.value.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (template.thinkingEnabled != null) formState.thinkingEnabled.value = template.thinkingEnabled;
  if (template.model) formState.model.value = template.model;
  if (template.mode) formState.mode.value = template.mode;
  if (template.gitBranch) {
    formState.quickWorktreeBranch.value = template.gitBranch;
    formState.editingBranch.value = true;
  }
  if (template.gitMode) formState.quickGitMode.value = template.gitMode;
  if (template.effortLevel != null) formState.effortLevel.value = template.effortLevel;
  if (template.nextTemplateId) formState.selectedTemplateId.value = template.nextTemplateId;
}

/**
 * Build the session creation payload from form state.
 * @param {Object} formState - The form state object with refs
 * @param {Object} options - Additional options (prompt, gitStatus, files)
 * @returns {Object} The session creation payload
 */
export function buildSessionPayload(formState, options) {
  const { currentPrompt, gitStatus, files } = options;
  const submitGitMode = formState.quickGitMode.value && gitStatus?.isGitRepo
    ? formState.quickGitMode.value : undefined;

  return {
    prompt: currentPrompt,
    mode: formState.mode.value,
    model: formState.model.value,
    providerId: formState.providerId.value,
    thinkingEnabled: formState.thinkingEnabled.value,
    effortLevel: formState.effortLevel.value,
    startImmediately: formState.startImmediately.value,
    gitMode: submitGitMode,
    gitBranch: submitGitMode ? formState.quickWorktreeBranch.value : undefined,
    files,
    templateId: formState.selectedTemplateId.value,
    parentSessionId: formState.parentSessionId.value || null,
    scheduledAt: formState.schedulingData.value.scheduledAt,
    autoRescheduleEnabled: formState.schedulingData.value.autoRescheduleEnabled,
    rescheduleDelayMinutes: formState.schedulingData.value.rescheduleDelayMinutes,
    rescheduleOnTokenLimit: formState.schedulingData.value.rescheduleOnTokenLimit,
    rescheduleOnServiceError: formState.schedulingData.value.rescheduleOnServiceError,
    maxRescheduleCount: formState.schedulingData.value.maxRescheduleCount,
    maxTotalTokens: formState.schedulingData.value.maxTotalTokens,
    rescheduleAtTokenCount: formState.schedulingData.value.rescheduleAtTokenCount,
  };
}
