import { ref, watch, onUnmounted } from 'vue';
import { generateWorktreeBranch } from '@claudetools/shared';

export function useGitBranch(prompt, gitStatus) {
  const quickGitMode = ref('worktree');
  const quickWorktreeBranch = ref('');
  const editingBranch = ref(false);
  const autoBranchName = ref('');
  let branchDebounceTimer = null;

  function updateBranchNameFromPrompt(promptValue) {
    if (branchDebounceTimer) clearTimeout(branchDebounceTimer);
    branchDebounceTimer = setTimeout(() => {
      autoBranchName.value = generateWorktreeBranch('', promptValue);
      if (!editingBranch.value) {
        quickWorktreeBranch.value = autoBranchName.value;
      }
    }, 300);
  }

  function handleBranchEdit() {
    editingBranch.value = true;
  }

  function resetBranchName() {
    editingBranch.value = false;
    quickWorktreeBranch.value = autoBranchName.value;
  }

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

  onUnmounted(() => {
    if (branchDebounceTimer) clearTimeout(branchDebounceTimer);
  });

  return {
    quickGitMode,
    quickWorktreeBranch,
    editingBranch,
    autoBranchName,
    updateBranchNameFromPrompt,
    handleBranchEdit,
    resetBranchName,
  };
}

export function useTextareaSync(prompt, textareaRef, gitStatus, updateBranchNameFromPrompt) {
  const promptHasContent = ref(false);
  let inputSyncTimer = null;

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

  onUnmounted(() => {
    if (inputSyncTimer) clearTimeout(inputSyncTimer);
  });

  return { promptHasContent, handleInput };
}

export function useTemplateApply(props) {
  const { mode, model, thinkingEnabled, startImmediately, quickGitMode, quickWorktreeBranch, editingBranch, effortLevel, usingDefaults } = props;

  function applyProjectDefaults(defaults) {
    const fieldMappings = [
      ['mode', mode, 'mode', false],
      ['thinkingEnabled', thinkingEnabled, 'thinkingEnabled', true],
      ['startImmediately', startImmediately, 'startImmediately', true],
      ['gitMode', quickGitMode, 'quickGitMode', false],
      ['gitBranch', quickWorktreeBranch, 'quickWorktreeBranch', false],
    ];
    for (const [key, target, trackKey, useNullCheck] of fieldMappings) {
      const val = defaults[key];
      const hasValue = useNullCheck ? (val !== null && val !== undefined) : !!val;
      if (hasValue) {
        target.value = val;
        usingDefaults.value[trackKey] = true;
      }
    }
    model.value = defaults.model || 'sonnet';
    usingDefaults.value.model = true;
    if (defaults.effortLevel) {
      effortLevel.value = defaults.effortLevel;
    }
  }

  return { applyProjectDefaults };
}
